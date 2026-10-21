/**
 * Read-side queries for the transactions module. Every query is scoped to the
 * caller's workspace; users without TRANSACTION_VIEW only ever see their own
 * transactions.
 */
import { Prisma, type TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { isoDate, parseISODate, todayInTimeZone } from "@/lib/dates";
import { txnRef } from "@/lib/ids";
import { dec, Decimal, money2 } from "@/lib/money";
import { missingForPosting } from "@/lib/accounting/transactions";
import { resolveDateRange, type TransactionFilters } from "./filters";
import {
  PAGE_SIZE,
  type ApprovalQueue,
  type ApprovalQueueItem,
  type MemberOption,
  type TransactionListResult,
  type TransactionRow,
} from "./types";

const MAX_INT = 2_147_483_647;

/** Builds the Prisma filter. `mineOnly` (or a missing TRANSACTION_VIEW) pins the creator to the caller. */
export function buildTransactionWhere(ctx: WorkspaceContext, f: TransactionFilters, mineOnly: boolean): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { workspaceId: ctx.workspace.id };
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");

  if (mineOnly || !canViewAll) where.createdById = ctx.user.id;
  else if (f.by) where.createdById = f.by;

  const today = todayInTimeZone(ctx.workspace.timeZone);
  const range = resolveDateRange(f, today, ctx.workspace.fyStartMonth);
  if (range.from || range.to) {
    where.date = {
      ...(range.from ? { gte: parseISODate(range.from) } : {}),
      ...(range.to ? { lte: parseISODate(range.to) } : {}),
    };
  }
  if (f.category) where.categoryId = f.category;
  if (f.min || f.max) {
    where.amount = {
      ...(f.min ? { gte: new Prisma.Decimal(money2(f.min)) } : {}),
      ...(f.max ? { lte: new Prisma.Decimal(money2(f.max)) } : {}),
    };
  }
  if (f.type) where.type = f.type;
  if (f.source) where.source = f.source;
  if (f.status) where.status = f.status;
  if (f.q) {
    const q = f.q;
    const or: Prisma.TransactionWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
    ];
    const m = /^(?:TXN-?)?(\d{1,10})$/i.exec(q);
    if (m && Number(m[1]) <= MAX_INT) or.push({ number: Number(m[1]) });
    where.OR = or;
  }
  return where;
}

function orderBy(sort: TransactionFilters["sort"]): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case "date_asc":
      return [{ date: "asc" }, { number: "asc" }];
    case "amount_desc":
      return [{ amount: "desc" }, { number: "desc" }];
    case "amount_asc":
      return [{ amount: "asc" }, { number: "asc" }];
    case "created_desc":
      return [{ createdAt: "desc" }];
    default:
      return [{ date: "desc" }, { number: "desc" }];
  }
}

const rowSelect = (workspaceId: string) =>
  ({
    id: true,
    number: true,
    date: true,
    description: true,
    amount: true,
    currency: true,
    type: true,
    status: true,
    source: true,
    reference: true,
    aiConfidence: true,
    createdById: true,
    createdByName: true,
    category: { select: { name: true } },
    customer: { select: { name: true } },
    vendor: { select: { name: true } },
    createdBy: { select: { status: true, memberships: { where: { workspaceId }, select: { status: true } } } },
  }) satisfies Prisma.TransactionSelect;

type RowRecord = Prisma.TransactionGetPayload<{ select: ReturnType<typeof rowSelect> }>;

export function serializeRow(t: RowRecord): TransactionRow {
  const membership = t.createdBy.memberships[0];
  return {
    id: t.id,
    number: t.number,
    ref: txnRef(t.number),
    date: isoDate(t.date),
    description: t.description,
    amount: money2(t.amount),
    currency: t.currency,
    type: t.type,
    status: t.status,
    source: t.source,
    reference: t.reference,
    categoryName: t.category?.name ?? null,
    counterparty: t.customer?.name ?? t.vendor?.name ?? null,
    enteredBy: t.createdByName,
    createdById: t.createdById,
    enteredByDisabled: t.createdBy.status === "DISABLED" || membership?.status === "DISABLED" || !membership,
    aiConfidence: t.aiConfidence,
  };
}

/**
 * Paginated, filtered transaction list with totals (in the workspace base
 * currency) and the "Entered By" member options.
 */
export async function listTransactions(ctx: WorkspaceContext, filters: TransactionFilters, opts: { mineOnly?: boolean } = {}): Promise<TransactionListResult> {
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");
  const mineOnly = Boolean(opts.mineOnly) || !canViewAll;
  const where = buildTransactionWhere(ctx, filters, mineOnly);

  // Totals leave out reversed and rejected entries unless a status was chosen explicitly.
  const excludesInactive = !filters.status;
  const totalsWhere: Prisma.TransactionWhereInput = excludesInactive
    ? { AND: [where, { status: { notIn: ["REVERSED", "REJECTED"] as TransactionStatus[] } }] }
    : where;

  const total = await prisma.transaction.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const [records, groups, members] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: orderBy(filters.sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: rowSelect(ctx.workspace.id),
    }),
    prisma.transaction.groupBy({
      by: ["type", "exchangeRate"],
      where: totalsWhere,
      _sum: { amount: true },
      orderBy: { type: "asc" },
    }),
    canViewAll && !opts.mineOnly ? listEnteredByOptions(ctx) : Promise.resolve([] as MemberOption[]),
  ]);

  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const g of groups) {
    const base = dec(g._sum.amount).times(dec(g.exchangeRate));
    if (g.type === "INCOME") income = income.plus(base);
    else if (g.type === "EXPENSE") expense = expense.plus(base);
  }

  return {
    rows: records.map(serializeRow),
    totals: {
      currency: ctx.workspace.defaultCurrency,
      income: money2(income),
      expense: money2(expense),
      net: money2(income.minus(expense)),
      count: total,
      excludesInactive,
    },
    page,
    pageSize: PAGE_SIZE,
    pageCount,
    total,
    members,
  };
}

/** Members (and former members) who can appear as "Entered By", with their current status. */
export async function listEnteredByOptions(ctx: WorkspaceContext): Promise<MemberOption[]> {
  const wsId = ctx.workspace.id;
  const [memberships, creators] = await Promise.all([
    prisma.workspaceMembership.findMany({
      where: { workspaceId: wsId, status: { in: ["ACTIVE", "DISABLED"] } },
      select: { status: true, user: { select: { id: true, name: true, status: true } } },
    }),
    prisma.transaction.groupBy({ by: ["createdById"], where: { workspaceId: wsId }, orderBy: { createdById: "asc" } }),
  ]);
  const byId = new Map<string, MemberOption>();
  for (const m of memberships) {
    byId.set(m.user.id, { id: m.user.id, name: m.user.name, disabled: m.status === "DISABLED" || m.user.status === "DISABLED" });
  }
  const unknown = creators.map((c) => c.createdById).filter((id) => !byId.has(id));
  if (unknown.length) {
    const users = await prisma.user.findMany({ where: { id: { in: unknown } }, select: { id: true, name: true } });
    for (const u of users) byId.set(u.id, { id: u.id, name: u.name, disabled: true });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Pending approvals plus approved transactions waiting to be posted. */
export async function listApprovalQueue(ctx: WorkspaceContext): Promise<ApprovalQueue> {
  const wsId = ctx.workspace.id;
  const records = await prisma.transaction.findMany({
    where: { workspaceId: wsId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
    orderBy: [{ updatedAt: "asc" }],
    take: 300,
    select: {
      id: true,
      number: true,
      date: true,
      type: true,
      status: true,
      description: true,
      amount: true,
      currency: true,
      createdById: true,
      createdByName: true,
      debitAccountId: true,
      creditAccountId: true,
      draftLines: true,
      approvedAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      debitAccount: { select: { name: true } },
      creditAccount: { select: { name: true } },
      customer: { select: { name: true } },
      vendor: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  const ids = records.map((r) => r.id);
  const events = ids.length
    ? await prisma.auditEvent.findMany({
        where: { workspaceId: wsId, transactionId: { in: ids }, action: { in: ["SUBMITTED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
        select: { transactionId: true, action: true, actorName: true, createdAt: true },
      })
    : [];
  const latest = new Map<string, { actorName: string; createdAt: Date }>();
  for (const e of events) {
    const key = `${e.transactionId}:${e.action}`;
    if (!latest.has(key)) latest.set(key, { actorName: e.actorName, createdAt: e.createdAt });
  }
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");

  const toItem = (r: (typeof records)[number]): ApprovalQueueItem => {
    const pending = r.status === "PENDING_APPROVAL";
    const ev = latest.get(`${r.id}:${pending ? "SUBMITTED" : "APPROVED"}`);
    return {
      id: r.id,
      ref: txnRef(r.number),
      date: isoDate(r.date),
      type: r.type,
      status: r.status,
      description: r.description,
      amount: money2(r.amount),
      currency: r.currency,
      categoryName: r.category?.name ?? null,
      debitAccountName: r.debitAccount?.name ?? null,
      creditAccountName: r.creditAccount?.name ?? null,
      counterparty: r.customer?.name ?? r.vendor?.name ?? null,
      enteredBy: r.createdByName,
      createdById: r.createdById,
      isOwn: r.createdById === ctx.user.id,
      canView: canViewAll || r.createdById === ctx.user.id,
      actorName: ev?.actorName ?? (pending ? null : (r.approvedBy?.name ?? null)),
      actorAt: (ev?.createdAt ?? (pending ? r.updatedAt : r.approvedAt) ?? r.updatedAt).toISOString(),
      missing: missingForPosting({ type: r.type, debitAccountId: r.debitAccountId, creditAccountId: r.creditAccountId, draftLines: r.draftLines, amount: r.amount }),
    };
  };

  return {
    pending: records.filter((r) => r.status === "PENDING_APPROVAL").map(toItem),
    approved: records.filter((r) => r.status === "APPROVED").map(toItem),
  };
}

/** Categories for the list filter (inactive ones included so history stays filterable). */
export async function listCategoryFilterOptions(ctx: WorkspaceContext) {
  const rows = await prisma.accountCategory.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, name: true, kind: true, isActive: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, isActive: c.isActive }));
}

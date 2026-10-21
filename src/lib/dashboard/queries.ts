/**
 * Dashboard data loaders. Everything is computed from the workspace ledger
 * (posted journal lines) or from workspace-scoped records, and returned as
 * plain JSON (amounts as 2-dp strings, dates as ISO strings).
 */
import { Prisma, type TransactionStatus, type TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { financialYearFor, financialYearRange, formatDate, isoDate, parseISODate, todayInTimeZone } from "@/lib/dates";
import { Decimal, dec, money2 } from "@/lib/money";
import { CASH_SUBTYPES } from "@/lib/accounting/coa-template";
import { cashAndBankBalances, expenseBreakdown, incomeExpenseTotals, profitAndLoss } from "@/lib/accounting/reports";
import { ADAPTER_CATALOG } from "@/lib/export/adapter-keys";
import { minIso, pctChange, rangeLabel, sameDayLastYear } from "./periods";
import { monthlyIncomeExpense } from "./trend";

export type RecentTxn = {
  id: string;
  number: number;
  date: string;
  description: string;
  amount: string;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  createdByName: string;
};

const recentSelect = {
  id: true,
  number: true,
  date: true,
  description: true,
  amount: true,
  currency: true,
  type: true,
  status: true,
  createdByName: true,
} satisfies Prisma.TransactionSelect;

function serializeTxn(t: Prisma.TransactionGetPayload<{ select: typeof recentSelect }>): RecentTxn {
  return { ...t, date: isoDate(t.date), amount: money2(t.amount) };
}

function fyContext(ctx: WorkspaceContext) {
  const ws = ctx.workspace;
  const today = todayInTimeZone(ws.timeZone);
  const fy = financialYearFor(today, ws.fyStartMonth);
  return { today, fy, fyRangeLabel: rangeLabel(fy.from, fy.to) };
}

// ───────────────────────────── Workspace (finance) view ─────────────────────────────

export type UserActivityRow = { userId: string; name: string; count: number; posted: number; income: string; expenses: string };

/**
 * Per-creator totals for a period: transaction counts from the register and
 * posted income/expense from the ledger (entries linked to the creator's
 * transactions, including their reversals so reversed items net to zero).
 */
export async function transactionsByUser(workspaceId: string, from: string, to: string): Promise<UserActivityRow[]> {
  // Validate, then bind as text + ::date so the comparison is independent of the DB session time zone.
  const f = isoDate(parseISODate(from));
  const t = isoDate(parseISODate(to));
  const [counts, sums] = await Promise.all([
    prisma.$queryRaw<{ userId: string; name: string; count: number; posted: number }[]>`
      SELECT "createdById" AS "userId",
             (array_agg("createdByName" ORDER BY "createdAt" DESC))[1] AS name,
             COUNT(*)::int AS count,
             (COUNT(*) FILTER (WHERE "status" IN ('POSTED', 'REVERSED')))::int AS posted
      FROM transactions
      WHERE "workspaceId" = ${workspaceId} AND "date" >= ${f}::date AND "date" <= ${t}::date
      GROUP BY "createdById"`,
    prisma.$queryRaw<{ userId: string; name: string; income: Prisma.Decimal; expenses: Prisma.Decimal }[]>`
      WITH links AS (
        SELECT "journalEntryId" AS "entryId", "createdById", "createdByName" FROM transactions
        WHERE "workspaceId" = ${workspaceId} AND "journalEntryId" IS NOT NULL
        UNION ALL
        SELECT "reversalEntryId" AS "entryId", "createdById", "createdByName" FROM transactions
        WHERE "workspaceId" = ${workspaceId} AND "reversalEntryId" IS NOT NULL
      )
      SELECT k."createdById" AS "userId", MAX(k."createdByName") AS name,
             COALESCE(SUM(CASE WHEN a."type" = 'INCOME' THEN l."credit" - l."debit" ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN a."type" = 'EXPENSE' THEN l."debit" - l."credit" ELSE 0 END), 0) AS expenses
      FROM journal_lines l
      JOIN journal_entries e ON e."id" = l."journalEntryId"
      JOIN accounts a ON a."id" = l."accountId"
      JOIN links k ON k."entryId" = e."id"
      WHERE l."workspaceId" = ${workspaceId} AND e."date" >= ${f}::date AND e."date" <= ${t}::date
        AND a."type" IN ('INCOME', 'EXPENSE')
      GROUP BY k."createdById"`,
  ]);
  const rows = new Map<string, UserActivityRow>();
  for (const c of counts) rows.set(c.userId, { userId: c.userId, name: c.name, count: c.count, posted: c.posted, income: "0.00", expenses: "0.00" });
  for (const s of sums) {
    const row = rows.get(s.userId) ?? { userId: s.userId, name: s.name, count: 0, posted: 0, income: "0.00", expenses: "0.00" };
    row.income = money2(s.income);
    row.expenses = money2(s.expenses);
    rows.set(s.userId, row);
  }
  return [...rows.values()].sort(
    (a, b) => dec(b.income).plus(dec(b.expenses)).cmp(dec(a.income).plus(dec(a.expenses))) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

/** Top `limit` categories, with the remainder folded into "Other". */
export function foldCategories(rows: { name: string; amount: number }[], limit = 6) {
  const positive = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = positive.reduce((s, r) => s.plus(r.amount), new Decimal(0));
  const head = positive.slice(0, limit);
  const tail = positive.slice(limit);
  const out = head.map((r) => ({ name: r.name, amount: money2(r.amount), share: total.isZero() ? 0 : dec(r.amount).div(total).times(100).toNumber(), isOther: false, count: 1 }));
  if (tail.length) {
    const rest = tail.reduce((s, r) => s.plus(r.amount), new Decimal(0));
    out.push({ name: "Other", amount: money2(rest), share: total.isZero() ? 0 : rest.div(total).times(100).toNumber(), isOther: true, count: tail.length });
  }
  return { items: out, total: money2(total) };
}

export async function loadWorkspaceDashboard(ctx: WorkspaceContext) {
  const ws = ctx.workspace;
  const { today, fy, fyRangeLabel } = fyContext(ctx);
  const prevFy = financialYearRange(fy.startYear - 1, ws.fyStartMonth);
  const fytdTo = minIso(today, fy.to);
  const prevFytdTo = minIso(sameDayLastYear(fytdTo), prevFy.to);
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");
  const canApprove = ctx.permissions.has("TRANSACTION_APPROVE");
  const canExport = ctx.permissions.has("DATA_EXPORT");

  const [pl, plFytd, plPrev, balances, trend, breakdown, recent, byUser, pendingCount, pendingItems, exports, postedCount] = await Promise.all([
    profitAndLoss(ws.id, fy.from, fy.to),
    profitAndLoss(ws.id, fy.from, fytdTo),
    profitAndLoss(ws.id, prevFy.from, prevFytdTo),
    cashAndBankBalances(ws.id, today),
    monthlyIncomeExpense(ws.id, today, 12),
    expenseBreakdown(ws.id, fy.from, fy.to),
    prisma.transaction.findMany({
      where: { workspaceId: ws.id, ...(canViewAll ? {} : { createdById: ctx.user.id }) },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 8,
      select: recentSelect,
    }),
    transactionsByUser(ws.id, fy.from, fy.to),
    prisma.transaction.count({ where: { workspaceId: ws.id, status: "PENDING_APPROVAL" } }),
    canApprove
      ? prisma.transaction.findMany({
          where: { workspaceId: ws.id, status: "PENDING_APPROVAL" },
          orderBy: [{ createdAt: "asc" }],
          take: 5,
          select: recentSelect,
        })
      : Promise.resolve([]),
    canExport
      ? prisma.exportJob.findMany({
          where: { workspaceId: ws.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, adapterKey: true, format: true, status: true, recordCount: true, fileName: true, createdByName: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.journalEntry.count({ where: { workspaceId: ws.id } }),
  ]);

  const kpi = (cur: string, curFytd: string, prev: string) => ({
    value: cur,
    change: pctChange(Number(curFytd), Number(prev)),
  });

  const visibleBalances = balances.filter((b) => b.isActive || !dec(b.balance).isZero());
  const cashTotal = visibleBalances
    .filter((b) => (CASH_SUBTYPES as readonly string[]).includes(b.subtype ?? ""))
    .reduce((s, b) => s.plus(dec(b.balance)), new Decimal(0));
  const cardTotal = visibleBalances.filter((b) => b.subtype === "CREDIT_CARD").reduce((s, b) => s.plus(dec(b.balance)), new Decimal(0));
  const adapterName = (key: string) => ADAPTER_CATALOG.find((a) => a.key === key)?.name ?? key;

  return {
    today,
    fy: { label: fy.label, from: fy.from, to: fy.to, rangeLabel: fyRangeLabel },
    comparison: { from: prevFy.from, to: prevFytdTo, currentTo: fytdTo, prevLabel: prevFy.label, label: `${prevFy.label} (to ${formatDate(prevFytdTo)})` },
    hasPostings: postedCount > 0,
    kpis: {
      income: kpi(pl.totalIncome, plFytd.totalIncome, plPrev.totalIncome),
      expenses: kpi(pl.totalExpenses, plFytd.totalExpenses, plPrev.totalExpenses),
      netProfit: kpi(pl.netProfit, plFytd.netProfit, plPrev.netProfit),
    },
    balances: {
      accounts: visibleBalances,
      cashTotal: money2(cashTotal),
      cardTotal: money2(cardTotal),
      hasCards: visibleBalances.some((b) => b.subtype === "CREDIT_CARD"),
    },
    trend,
    breakdown: foldCategories(breakdown, 6),
    recent: { scope: canViewAll ? ("workspace" as const) : ("mine" as const), items: recent.map(serializeTxn) },
    byUser,
    pending: { count: pendingCount, items: pendingItems.map(serializeTxn), canApprove },
    exports: canExport
      ? exports.map((e) => ({ ...e, adapterName: adapterName(e.adapterKey), createdAt: e.createdAt.toISOString() }))
      : null,
  };
}

export type WorkspaceDashboardData = Awaited<ReturnType<typeof loadWorkspaceDashboard>>;

// ───────────────────────────── Personal view ─────────────────────────────

export type ActivityItem = {
  id: string;
  action: string;
  entityType: string;
  actorName: string;
  isMe: boolean;
  reason: string | null;
  createdAt: string;
  transaction: { id: string; number: number; description: string } | null;
};

/** Latest audit events in this workspace by the user, or on transactions the user created. */
export async function recentActivityFor(workspaceId: string, userId: string, limit = 10): Promise<ActivityItem[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      action: string;
      entityType: string;
      actorUserId: string | null;
      actorName: string;
      reason: string | null;
      createdAt: Date;
      txnId: string | null;
      txnNumber: number | null;
      txnDescription: string | null;
    }[]
  >`
    SELECT a."id", a."action", a."entityType", a."actorUserId", a."actorName", a."reason", a."createdAt",
           t."id" AS "txnId", t."number" AS "txnNumber", t."description" AS "txnDescription"
    FROM audit_events a
    LEFT JOIN transactions t ON t."id" = a."transactionId" AND t."workspaceId" = ${workspaceId}
    WHERE a."workspaceId" = ${workspaceId}
      AND (a."actorUserId" = ${userId} OR t."createdById" = ${userId})
    ORDER BY a."createdAt" DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    actorName: r.actorName,
    isMe: r.actorUserId === userId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    transaction: r.txnId && r.txnNumber !== null ? { id: r.txnId, number: r.txnNumber, description: r.txnDescription ?? "" } : null,
  }));
}

export async function loadPersonalDashboard(ctx: WorkspaceContext) {
  const ws = ctx.workspace;
  const me = ctx.user.id;
  const { today, fy, fyRangeLabel } = fyContext(ctx);
  const [totals, recent, statusGroups, activity] = await Promise.all([
    incomeExpenseTotals(ws.id, { from: fy.from, to: fy.to }, me),
    prisma.transaction.findMany({
      where: { workspaceId: ws.id, createdById: me },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 8,
      select: recentSelect,
    }),
    prisma.transaction.groupBy({ by: ["status"], where: { workspaceId: ws.id, createdById: me }, _count: true }),
    recentActivityFor(ws.id, me, 10),
  ]);
  const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count])) as Partial<Record<TransactionStatus, number>>;
  return {
    today,
    fy: { label: fy.label, from: fy.from, to: fy.to, rangeLabel: fyRangeLabel },
    totals,
    counts: {
      total: statusGroups.reduce((s, g) => s + g._count, 0),
      draft: byStatus.DRAFT ?? 0,
      pending: byStatus.PENDING_APPROVAL ?? 0,
      approved: byStatus.APPROVED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      posted: byStatus.POSTED ?? 0,
      reversed: byStatus.REVERSED ?? 0,
    },
    recent: recent.map(serializeTxn),
    activity,
  };
}

export type PersonalDashboardData = Awaited<ReturnType<typeof loadPersonalDashboard>>;

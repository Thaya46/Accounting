import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { getTransactionDetail, missingForPosting } from "@/lib/accounting/transactions";
import { simpleLines, toBaseAmount, type JournalLineInput } from "@/lib/accounting/journal";
import { formatDate, isoDate } from "@/lib/dates";
import { journalRef, txnRef, userRef, workspaceRef } from "@/lib/ids";
import { dec, formatMoney, money2, sumDec } from "@/lib/money";
import { transactionAbilities } from "./access";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  type AuditChange,
  type AuditEventView,
  type FormInitial,
  type JournalLineView,
  type JournalView,
  type TransactionAbilities,
  type TransactionDetailView,
} from "./types";

type Names = {
  accounts: Map<string, { code: string; name: string }>;
  categories: Map<string, string>;
  customers: Map<string, string>;
  vendors: Map<string, string>;
};

const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  type: "Type",
  amount: "Amount",
  currency: "Currency",
  exchangeRate: "Exchange rate",
  description: "Description",
  categoryId: "Category",
  debitAccountId: "Debit account",
  creditAccountId: "Credit account",
  draftLines: "Journal lines",
  paymentMethod: "Payment method",
  reference: "Reference",
  notes: "Notes",
  customerId: "Customer",
  vendorId: "Vendor",
  status: "Status",
  isAdjustment: "Adjustment entry",
  source: "Entry source",
  aiConfidence: "AI confidence",
  journalNumber: "Journal entry",
  reversalNumber: "Reversal entry",
  reversalDate: "Reversal date",
};

/** Keys that are internal ids or shown elsewhere (journal section). */
const HIDDEN_KEYS = new Set(["journalEntryId", "reversalEntryId", "lines"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function humanize(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function collectIds(value: unknown, names: { accounts: Set<string>; categories: Set<string>; customers: Set<string>; vendors: Set<string> }) {
  if (!isRecord(value)) return;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  for (const k of ["debitAccountId", "creditAccountId"]) {
    const id = str(value[k]);
    if (id) names.accounts.add(id);
  }
  const cat = str(value.categoryId);
  if (cat) names.categories.add(cat);
  const cust = str(value.customerId);
  if (cust) names.customers.add(cust);
  const vend = str(value.vendorId);
  if (vend) names.vendors.add(vend);
  for (const k of ["draftLines", "lines"]) {
    const arr = value[k];
    if (Array.isArray(arr)) for (const l of arr) if (isRecord(l) && typeof l.accountId === "string") names.accounts.add(l.accountId);
  }
}

function formatValue(key: string, value: unknown, currency: string, names: Names): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (key) {
    case "categoryId":
      return names.categories.get(String(value)) ?? "(removed category)";
    case "debitAccountId":
    case "creditAccountId": {
      const a = names.accounts.get(String(value));
      return a ? `${a.code} · ${a.name}` : "(unknown account)";
    }
    case "customerId":
      return names.customers.get(String(value)) ?? "(removed customer)";
    case "vendorId":
      return names.vendors.get(String(value)) ?? "(removed vendor)";
    case "status":
      return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? String(value);
    case "type":
      return TYPE_LABELS[value as keyof typeof TYPE_LABELS] ?? String(value);
    case "source":
      return SOURCE_LABELS[value as keyof typeof SOURCE_LABELS] ?? String(value);
    case "amount":
      return formatMoney(String(value), currency, { decimals: true });
    case "aiConfidence":
      return typeof value === "number" ? `${Math.round(value * 100)}%` : String(value);
    case "isAdjustment":
      return value ? "Yes" : "No";
    case "journalNumber":
    case "reversalNumber":
      return typeof value === "number" ? journalRef(value) : String(value);
    case "date":
    case "reversalDate":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : String(value);
    case "draftLines": {
      if (!Array.isArray(value)) return null;
      const lines = value.filter(isRecord);
      const dr = sumDec(lines.map((l) => String(l.debit ?? "0")));
      const parts = lines.map((l) => {
        const a = names.accounts.get(String(l.accountId));
        const side = dec(String(l.debit ?? "0")).gt(0) ? `Dr ${money2(String(l.debit))}` : `Cr ${money2(String(l.credit ?? "0"))}`;
        return `${a?.name ?? "?"} ${side}`;
      });
      return `${lines.length} lines (total ${money2(dr)}): ${parts.join("; ")}`;
    }
    default: {
      if (typeof value === "object") {
        const s = JSON.stringify(value);
        return s.length > 200 ? `${s.slice(0, 197)}…` : s;
      }
      const s = String(value);
      return s.length > 300 ? `${s.slice(0, 297)}…` : s;
    }
  }
}

function auditView(e: { id: string; action: string; actorName: string; actorUserId: string | null; createdAt: Date; reason: string | null; approvalId: string | null; reversalId: string | null; before: unknown; after: unknown }, currency: string, names: Names): AuditEventView {
  const before = isRecord(e.before) ? e.before : {};
  const after = isRecord(e.after) ? e.after : {};
  const changes: AuditChange[] = [];
  let summary: string | null = null;

  if (e.action === "CREATED") {
    const order = ["type", "date", "amount", "currency", "description", "categoryId", "debitAccountId", "creditAccountId", "draftLines", "paymentMethod", "customerId", "vendorId", "reference", "status", "source", "aiConfidence"];
    for (const k of order) {
      const v = formatValue(k, after[k], String(after.currency ?? currency), names);
      if (v !== null && !(k === "currency" && after[k] === currency)) changes.push({ field: k, label: FIELD_LABELS[k] ?? humanize(k), before: null, after: v });
    }
    summary = "Transaction recorded";
  } else {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN_KEYS.has(k));
    for (const k of keys) {
      const cur = String(after.currency ?? before.currency ?? currency);
      const b = formatValue(k, before[k], cur, names);
      const a = formatValue(k, after[k], cur, names);
      if (b === a) continue;
      changes.push({ field: k, label: FIELD_LABELS[k] ?? humanize(k), before: b, after: a });
    }
    if (e.action === "POSTED") {
      const lines = Array.isArray(after.lines) ? after.lines.length : 0;
      summary = `Posted to the general ledger${lines ? ` with ${lines} balanced journal lines` : ""}`;
    } else if (e.action === "REVERSED") summary = "Reversed with a mirror-image journal entry";
    else if (e.action === "UPDATED") summary = changes.length ? `${changes.length} field${changes.length === 1 ? "" : "s"} changed` : "Saved without field changes";
    else if (e.action === "SUBMITTED") summary = "Submitted for approval";
    else if (e.action === "APPROVED") summary = "Approved";
    else if (e.action === "REJECTED") summary = "Rejected";
    else if (e.action === "EXPORTED") summary = "Included in an export";
    else if (e.action === "IMPORTED") summary = "Imported from a file";
  }

  return {
    id: e.id,
    action: e.action,
    actorName: e.actorName,
    actorUserId: e.actorUserId,
    createdAt: e.createdAt.toISOString(),
    reason: e.reason,
    approvalId: e.approvalId,
    reversalId: e.reversalId,
    changes,
    summary,
  };
}

type EntryWithLines = {
  id: string;
  number: number;
  type: string;
  date: Date;
  postedByName: string;
  postedAt: Date;
  totalDebit: { toString(): string };
  totalCredit: { toString(): string };
  lines: { lineNo: number; accountId: string; debit: { toString(): string }; credit: { toString(): string }; description: string | null; account: { code: string; name: string } }[];
};

function journalView(e: EntryWithLines): JournalView {
  return {
    id: e.id,
    ref: journalRef(e.number),
    type: e.type,
    date: isoDate(e.date),
    postedByName: e.postedByName,
    postedAt: e.postedAt.toISOString(),
    lines: e.lines.map((l) => ({
      lineNo: l.lineNo,
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      debit: money2(l.debit),
      credit: money2(l.credit),
      description: l.description,
    })),
    totalDebit: money2(e.totalDebit),
    totalCredit: money2(e.totalCredit),
    proposed: false,
  };
}

function proposedView(lines: JournalLineInput[], date: Date, isAdjustment: boolean, names: Names): JournalView {
  const view: JournalLineView[] = lines.map((l, i) => {
    const a = names.accounts.get(l.accountId);
    return {
      lineNo: i + 1,
      accountId: l.accountId,
      accountCode: a?.code ?? "—",
      accountName: a?.name ?? "Unknown account",
      debit: money2(l.debit || "0"),
      credit: money2(l.credit || "0"),
      description: l.description ?? null,
    };
  });
  return {
    id: null,
    ref: null,
    type: isAdjustment ? "ADJUSTMENT" : "STANDARD",
    date: isoDate(date),
    postedByName: null,
    postedAt: null,
    lines: view,
    totalDebit: money2(sumDec(view.map((l) => l.debit))),
    totalCredit: money2(sumDec(view.map((l) => l.credit))),
    proposed: true,
  };
}

/** Full, serializable detail view plus the caller's allowed actions; null when not visible. */
export async function loadTransactionDetail(ctx: WorkspaceContext, id: string): Promise<{ view: TransactionDetailView; abilities: TransactionAbilities; initial: FormInitial } | null> {
  if (!id || id.length > 64) return null;
  const detail = await getTransactionDetail(ctx, id);
  if (!detail) return null;
  const { txn, auditEvents } = detail;
  const wsId = ctx.workspace.id;

  const ids = { accounts: new Set<string>(), categories: new Set<string>(), customers: new Set<string>(), vendors: new Set<string>() };
  collectIds({ draftLines: txn.draftLines, debitAccountId: txn.debitAccountId, creditAccountId: txn.creditAccountId, categoryId: txn.categoryId }, ids);
  for (const e of auditEvents) {
    collectIds(e.before, ids);
    collectIds(e.after, ids);
  }

  const [membership, accounts, categories, customers, vendors] = await Promise.all([
    prisma.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: wsId, userId: txn.createdById } }, select: { status: true } }),
    ids.accounts.size ? prisma.account.findMany({ where: { workspaceId: wsId, id: { in: [...ids.accounts] } }, select: { id: true, code: true, name: true } }) : [],
    ids.categories.size ? prisma.accountCategory.findMany({ where: { workspaceId: wsId, id: { in: [...ids.categories] } }, select: { id: true, name: true, accountId: true } }) : [],
    ids.customers.size ? prisma.customer.findMany({ where: { workspaceId: wsId, id: { in: [...ids.customers] } }, select: { id: true, name: true } }) : [],
    ids.vendors.size ? prisma.vendor.findMany({ where: { workspaceId: wsId, id: { in: [...ids.vendors] } }, select: { id: true, name: true } }) : [],
  ]);
  const names: Names = {
    accounts: new Map(accounts.map((a) => [a.id, { code: a.code, name: a.name }])),
    categories: new Map(categories.map((c) => [c.id, c.name])),
    customers: new Map(customers.map((c) => [c.id, c.name])),
    vendors: new Map(vendors.map((v) => [v.id, v.name])),
  };

  const draftLines = Array.isArray(txn.draftLines) ? (txn.draftLines as unknown as JournalLineInput[]) : [];
  const missing = txn.status === "POSTED" || txn.status === "REVERSED" ? [] : missingForPosting(txn);

  let journal: JournalView | null = null;
  if (txn.journalEntry) journal = journalView(txn.journalEntry);
  else if (txn.type === "JOURNAL" && draftLines.length) journal = proposedView(draftLines, txn.date, txn.isAdjustment, names);
  else if (txn.type !== "JOURNAL" && (txn.debitAccountId || txn.creditAccountId)) {
    const base = toBaseAmount(txn.amount, txn.exchangeRate);
    const lines = txn.debitAccountId && txn.creditAccountId
      ? simpleLines(txn.debitAccountId, txn.creditAccountId, base, txn.description)
      : txn.debitAccountId
        ? [{ accountId: txn.debitAccountId, debit: base, credit: "0.00", description: txn.description }]
        : [{ accountId: txn.creditAccountId!, debit: "0.00", credit: base, description: txn.description }];
    journal = proposedView(lines, txn.date, false, names);
  }

  const lastApproval = [...txn.approvals].reverse().find((a) => a.decision === "APPROVED");
  const createdDisabled = txn.createdBy.status === "DISABLED" || membership?.status === "DISABLED" || !membership;

  const view: TransactionDetailView = {
    id: txn.id,
    number: txn.number,
    ref: txnRef(txn.number),
    workspace: {
      id: ctx.workspace.id,
      ref: workspaceRef(ctx.workspace.seq),
      name: ctx.workspace.name,
      code: ctx.workspace.code,
      currency: ctx.workspace.defaultCurrency,
      timeZone: ctx.workspace.timeZone,
    },
    date: isoDate(txn.date),
    type: txn.type,
    status: txn.status,
    source: txn.source,
    amount: money2(txn.amount),
    currency: txn.currency,
    exchangeRate: txn.exchangeRate.toString(),
    baseAmount: toBaseAmount(txn.amount, txn.exchangeRate),
    description: txn.description,
    category: txn.category,
    debitAccount: txn.debitAccount,
    creditAccount: txn.creditAccount,
    paymentMethod: txn.paymentMethod,
    reference: txn.reference,
    notes: txn.notes,
    customer: txn.customer?.name ?? null,
    vendor: txn.vendor?.name ?? null,
    isAdjustment: txn.isAdjustment,
    aiConfidence: txn.aiConfidence,
    rawInput: txn.rawInput,
    createdBy: {
      id: txn.createdBy.id,
      ref: userRef(txn.createdBy.seq),
      nameSnapshot: txn.createdByName,
      currentName: txn.createdBy.name,
      email: txn.createdBy.email,
      userStatus: txn.createdBy.status,
      membershipStatus: membership?.status ?? null,
      disabled: createdDisabled,
    },
    createdAt: txn.createdAt.toISOString(),
    updated: { id: txn.updatedById, name: txn.updatedByName ?? txn.updatedBy?.name ?? null, at: txn.updatedById ? txn.updatedAt.toISOString() : null },
    approved: { id: txn.approvedById, name: lastApproval?.decidedByName ?? txn.approvedBy?.name ?? null, at: txn.approvedAt?.toISOString() ?? null },
    posted: { id: txn.postedById, name: txn.journalEntry?.postedByName ?? txn.postedBy?.name ?? null, at: txn.postedAt?.toISOString() ?? null },
    reversed: {
      id: txn.reversedById,
      name: txn.reversalEntry?.postedByName ?? txn.reversedBy?.name ?? null,
      at: txn.reversedAt?.toISOString() ?? null,
      reason: txn.reversalReason,
    },
    importInfo:
      txn.source === "IMPORT" || txn.importJobId || txn.externalCreatorName || txn.externalRef
        ? {
            jobId: txn.importJob?.id ?? txn.importJobId,
            fileName: txn.importJob?.fileName ?? null,
            externalRef: txn.externalRef,
            externalCreatorId: txn.externalCreatorId,
            externalCreatorName: txn.externalCreatorName,
          }
        : null,
    journal,
    reversal: txn.reversalEntry ? journalView(txn.reversalEntry) : null,
    missingForPosting: missing,
    approvals: txn.approvals.map((a) => ({ id: a.id, decision: a.decision, comment: a.comment, decidedByName: a.decidedByName, createdAt: a.createdAt.toISOString() })),
    audit: auditEvents.map((e) => auditView(e, txn.currency, names)),
    isOwn: txn.createdById === ctx.user.id,
  };

  const categoryAccountId = categories.find((c) => c.id === txn.categoryId)?.accountId ?? null;
  const overrideSide = txn.type === "EXPENSE" ? txn.debitAccountId : txn.type === "INCOME" ? txn.creditAccountId : null;
  const initial: FormInitial = {
    type: txn.type,
    date: isoDate(txn.date),
    amount: txn.type === "JOURNAL" ? "" : money2(txn.amount),
    currency: txn.currency,
    exchangeRate: txn.exchangeRate.toString(),
    description: txn.description,
    categoryId: txn.categoryId ?? "",
    debitAccountId: txn.debitAccountId ?? "",
    creditAccountId: txn.creditAccountId ?? "",
    accountOverrideId: overrideSide && overrideSide !== categoryAccountId ? overrideSide : "",
    lines: draftLines.map((l) => ({
      accountId: l.accountId,
      debit: dec(l.debit || "0").gt(0) ? money2(l.debit) : "",
      credit: dec(l.credit || "0").gt(0) ? money2(l.credit) : "",
      description: l.description ?? "",
    })),
    isAdjustment: txn.isAdjustment,
    paymentMethod: txn.paymentMethod ?? "",
    reference: txn.reference ?? "",
    notes: txn.notes ?? "",
    customerName: txn.customer?.name ?? "",
    vendorName: txn.vendor?.name ?? "",
  };

  const abilities = transactionAbilities(ctx, { createdById: txn.createdById, status: txn.status, amount: txn.amount, exchangeRate: txn.exchangeRate, missing });
  return { view, abilities, initial };
}

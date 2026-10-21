/**
 * Builds the canonical export (schema 1.0) for one workspace. Server-only:
 * every query is scoped to `ctx.workspace.id`, so a workspace can only ever
 * export its own data. Journal balances are re-validated here before anything
 * is handed to an adapter.
 */
import { Prisma, type AccountType, type TransactionStatus, type TransactionType } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { isoDate, parseISODate } from "@/lib/dates";
import { journalRef, txnRef, userRef, workspaceRef } from "@/lib/ids";
import { Decimal, dec, money2 } from "@/lib/money";
import { isDebitNormal, toBaseAmount, type JournalLineInput } from "@/lib/accounting/journal";
import type { AdapterKey } from "./adapter-keys";
import {
  CANONICAL_SCHEMA_VERSION,
  type ActorRef,
  type CanonicalAccount,
  type CanonicalAuditEvent,
  type CanonicalExport,
  type CanonicalJournalEntry,
  type CanonicalJournalLine,
  type CanonicalLedger,
  type CanonicalTransaction,
  type ExportType,
} from "./canonical-schema";
import { sha256Hex, transactionsChecksum } from "./checksum";
import { MAX_EXPORT_TRANSACTIONS } from "./filters";
import type { ValidationIssue } from "./types";

export type CanonicalFilters = {
  exportType: ExportType;
  from: string;
  to: string;
  financialYearLabel?: string | null;
  /** Empty = all types. */
  types: TransactionType[];
  statuses: TransactionStatus[];
  createdById?: string | null;
  categoryIds: string[];
  accountIds: string[];
  /** Duplicate-export prevention: skip transactions already exported to this adapter. */
  excludeAlreadyExportedTo?: AdapterKey | null;
  includeAuditTrail: boolean;
};

export type AccountUsed = { id: string; code: string; name: string; type: AccountType; subtype: string | null; isActive: boolean };

export type CanonicalBuild = {
  data: CanonicalExport;
  issues: ValidationIssue[];
  meta: {
    /** Database ids of transactions included in this export (recorded as ExportJobItems). */
    exportTransactionIds: string[];
    excludedAlreadyExported: number;
    reversalOnly: number;
    unlinkedJournalEntries: number;
    accountsUsed: AccountUsed[];
  };
};

const lineInclude = { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" as const } } satisfies Prisma.JournalEntry$linesArgs;
const userPick = { select: { seq: true, name: true } } as const;

const txnInclude = {
  category: { select: { name: true } },
  customer: { select: { name: true } },
  vendor: { select: { name: true } },
  createdBy: userPick,
  updatedBy: userPick,
  approvedBy: userPick,
  postedBy: userPick,
  reversedBy: userPick,
  journalEntry: { include: { lines: lineInclude } },
  reversalEntry: { include: { lines: lineInclude } },
} satisfies Prisma.TransactionInclude;

type TxnRow = Prisma.TransactionGetPayload<{ include: typeof txnInclude }>;
type EntryRow = NonNullable<TxnRow["journalEntry"]>;

export { sha256Hex, transactionsChecksum };

function chunk<T>(arr: T[], size = 5000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const lower = <T extends string>(s: T) => s.toLowerCase();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function actor(u: { seq: number; name: string } | null | undefined, snapshotName?: string | null): ActorRef | null {
  if (!u) return null;
  return { userId: userRef(u.seq), name: snapshotName || u.name };
}

function entryLines(e: EntryRow): CanonicalJournalLine[] {
  return e.lines.map((l) => ({
    lineNo: l.lineNo,
    accountCode: l.account.code,
    accountName: l.account.name,
    debit: money2(l.debit),
    credit: money2(l.credit),
    description: l.description ?? null,
  }));
}

/** Verifies a posted entry: lines balance, are positive, and agree with the stored totals. */
function checkEntry(e: { number: number; totalDebit: Prisma.Decimal; totalCredit: Prisma.Decimal; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }, txnId?: string): ValidationIssue | null {
  let dr = new Decimal(0);
  let cr = new Decimal(0);
  for (const l of e.lines) {
    dr = dr.plus(dec(l.debit));
    cr = cr.plus(dec(l.credit));
  }
  const ok = e.lines.length >= 2 && dr.eq(cr) && dr.gt(0) && dr.eq(dec(e.totalDebit)) && cr.eq(dec(e.totalCredit));
  if (ok) return null;
  return {
    level: "error",
    code: "UNBALANCED_ENTRY",
    transactionId: txnId,
    message: `${journalRef(e.number)}${txnId ? ` (${txnId})` : ""} does not balance: lines debit ${money2(dr)} / credit ${money2(cr)}, header ${money2(e.totalDebit)} / ${money2(e.totalCredit)}.`,
  };
}

export async function buildCanonicalExport(ctx: WorkspaceContext, filters: CanonicalFilters, opts: { db?: Tx; now?: Date } = {}): Promise<CanonicalBuild> {
  const db = opts.db ?? prisma;
  const ws = ctx.workspace;
  const wsId = ws.id;
  const now = opts.now ?? new Date();
  const issues: ValidationIssue[] = [];
  const fromDate = parseISODate(filters.from);
  const toDate = parseISODate(filters.to);

  const accounts = await db.account.findMany({
    where: { workspaceId: wsId },
    select: { id: true, code: true, name: true, type: true, subtype: true, isActive: true },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));
  const accountIdSet = new Set(filters.accountIds.filter((id) => accountById.has(id)));
  if (filters.accountIds.length && !accountIdSet.size) {
    issues.push({ level: "error", code: "INVALID_FILTER", message: "None of the selected accounts belong to this workspace." });
  }
  const accountIds = [...accountIdSet];

  // ── Transactions ──
  const where: Prisma.TransactionWhereInput = {
    workspaceId: wsId,
    date: { gte: fromDate, lte: toDate },
    status: { in: filters.statuses },
    ...(filters.types.length ? { type: { in: filters.types } } : {}),
    ...(filters.createdById ? { createdById: filters.createdById } : {}),
    ...(filters.categoryIds.length ? { categoryId: { in: filters.categoryIds } } : {}),
    ...(accountIds.length
      ? {
          OR: [
            { debitAccountId: { in: accountIds } },
            { creditAccountId: { in: accountIds } },
            { journalEntry: { lines: { some: { accountId: { in: accountIds } } } } },
            { type: "JOURNAL", journalEntryId: null },
          ],
        }
      : {}),
  };
  const count = await db.transaction.count({ where });
  if (count > MAX_EXPORT_TRANSACTIONS) {
    issues.push({ level: "error", code: "TOO_MANY", message: `${count.toLocaleString("en-US")} transactions match — narrow the date range or filters to at most ${MAX_EXPORT_TRANSACTIONS.toLocaleString("en-US")} per export.` });
    return emptyBuild(ctx, filters, issues, now);
  }
  let rows: TxnRow[] = await db.transaction.findMany({ where, include: txnInclude, orderBy: [{ date: "asc" }, { number: "asc" }] });
  if (accountIds.length) {
    // Unposted journals keep their proposed lines in JSON — filter those in memory.
    rows = rows.filter((t) => {
      if (t.type !== "JOURNAL" || t.journalEntryId) return true;
      const lines = (t.draftLines as JournalLineInput[] | null) ?? [];
      return lines.some((l) => accountIdSet.has(l.accountId));
    });
  }

  // ── Duplicate-export prevention ──
  let excludedAlreadyExported = 0;
  let reversalOnly = 0;
  const scope = new Map<string, "full" | "reversal_only">();
  if (filters.excludeAlreadyExportedTo && rows.length) {
    const last = new Map<string, Date>();
    for (const ids of chunk(rows.map((r) => r.id))) {
      const items = await db.exportJobItem.findMany({
        where: { workspaceId: wsId, adapterKey: filters.excludeAlreadyExportedTo, transactionId: { in: ids } },
        select: { transactionId: true, createdAt: true },
      });
      for (const it of items) {
        const prev = last.get(it.transactionId);
        if (!prev || it.createdAt > prev) last.set(it.transactionId, it.createdAt);
      }
    }
    rows = rows.filter((t) => {
      const exportedAt = last.get(t.id);
      if (!exportedAt) return true;
      const postedSince = t.postedAt && t.postedAt > exportedAt;
      if (t.status === "REVERSED" && t.reversedAt && t.reversedAt > exportedAt) {
        if (!postedSince) {
          scope.set(t.id, "reversal_only");
          reversalOnly++;
        }
        return true;
      }
      if (postedSince) return true;
      if (!["POSTED", "REVERSED"].includes(t.status) && t.updatedAt > exportedAt) return true;
      excludedAlreadyExported++;
      return false;
    });
  }

  // ── Audit trail ──
  const eventsByTxn = new Map<string, CanonicalAuditEvent[]>();
  const userSeq = new Map<string, number>();
  const rememberUsers = async (ids: (string | null | undefined)[]) => {
    const missing = [...new Set(ids.filter((x): x is string => Boolean(x) && !userSeq.has(x!)))];
    for (const part of chunk(missing)) {
      const users = await db.user.findMany({ where: { id: { in: part } }, select: { id: true, seq: true } });
      for (const u of users) userSeq.set(u.id, u.seq);
    }
  };
  const refFor = (id: string | null | undefined) => (id && userSeq.has(id) ? userRef(userSeq.get(id)!) : "SYSTEM");

  const reversalRefById = new Map<string, string>();
  for (const t of rows) if (t.reversalEntry) reversalRefById.set(t.reversalEntry.id, journalRef(t.reversalEntry.number));

  if (filters.includeAuditTrail && rows.length) {
    const events: { transactionId: string | null; action: string; actorUserId: string | null; actorName: string; createdAt: Date; reason: string | null; approvalId: string | null; reversalId: string | null }[] = [];
    for (const ids of chunk(rows.map((r) => r.id))) {
      events.push(
        ...(await db.auditEvent.findMany({
          where: { workspaceId: wsId, transactionId: { in: ids } },
          select: { transactionId: true, action: true, actorUserId: true, actorName: true, createdAt: true, reason: true, approvalId: true, reversalId: true },
          orderBy: { createdAt: "asc" },
        })),
      );
    }
    await rememberUsers(events.map((e) => e.actorUserId));
    for (const e of events) {
      if (!e.transactionId) continue;
      const list = eventsByTxn.get(e.transactionId) ?? [];
      list.push({
        action: e.action,
        actor: { userId: refFor(e.actorUserId), name: e.actorName },
        timestamp: e.createdAt.toISOString(),
        reason: e.reason ?? null,
        approvalId: e.approvalId ?? null,
        reversalJournalEntryId: e.reversalId ? (reversalRefById.get(e.reversalId) ?? null) : null,
      });
      eventsByTxn.set(e.transactionId, list);
    }
  }

  // ── Canonical transactions ──
  const usedAccountIds = new Set<string>();
  const exportTransactionIds: string[] = [];
  const transactions: CanonicalTransaction[] = [];
  let integrityDebit = new Decimal(0);
  let integrityCredit = new Decimal(0);
  let allBalanced = true;
  const byType = { income: new Decimal(0), expense: new Decimal(0), transfer: new Decimal(0), journal: new Decimal(0) };

  for (const t of rows) {
    const ref = txnRef(t.number);
    const posted = t.status === "POSTED" || t.status === "REVERSED";
    let journalLines: CanonicalJournalLine[] = [];
    if (posted) {
      if (!t.journalEntry) {
        issues.push({ level: "error", code: "MISSING_JOURNAL", transactionId: ref, message: `${ref} is ${lower(t.status)} but has no journal entry.` });
        allBalanced = false;
      } else {
        const problem = checkEntry(t.journalEntry, ref);
        if (problem) {
          issues.push(problem);
          allBalanced = false;
        }
        journalLines = entryLines(t.journalEntry);
        for (const l of t.journalEntry.lines) usedAccountIds.add(l.accountId);
        if (scope.get(t.id) !== "reversal_only") {
          integrityDebit = integrityDebit.plus(dec(t.journalEntry.totalDebit));
          integrityCredit = integrityCredit.plus(dec(t.journalEntry.totalCredit));
        }
      }
    } else {
      journalLines = proposedLines(t, accountById, usedAccountIds);
      const complete = t.type === "JOURNAL" ? journalLines.length >= 2 : Boolean(t.debitAccountId && t.creditAccountId);
      if (!complete) {
        issues.push({ level: "warning", code: "INCOMPLETE_DRAFT", transactionId: ref, message: `${ref} (${lower(t.status).replace("_", " ")}) has incomplete proposed journal lines.` });
      }
    }

    let reversal: CanonicalTransaction["reversal"] = null;
    if (t.status === "REVERSED") {
      if (!t.reversalEntry) {
        issues.push({ level: "error", code: "MISSING_JOURNAL", transactionId: ref, message: `${ref} is reversed but its reversal entry is missing.` });
        allBalanced = false;
      } else {
        const problem = checkEntry(t.reversalEntry, ref);
        if (problem) {
          issues.push(problem);
          allBalanced = false;
        }
        for (const l of t.reversalEntry.lines) usedAccountIds.add(l.accountId);
        integrityDebit = integrityDebit.plus(dec(t.reversalEntry.totalDebit));
        integrityCredit = integrityCredit.plus(dec(t.reversalEntry.totalCredit));
        reversal = {
          journalEntryId: journalRef(t.reversalEntry.number),
          date: isoDate(t.reversalEntry.date),
          reason: t.reversalReason ?? null,
          reversedBy: actor(t.reversedBy),
          reversedAt: iso(t.reversedAt),
          journalLines: entryLines(t.reversalEntry),
        };
      }
    }

    const baseAmount = t.type === "JOURNAL" ? money2(t.amount) : toBaseAmount(t.amount, t.exchangeRate);
    byType[lower(t.type) as keyof typeof byType] = byType[lower(t.type) as keyof typeof byType].plus(dec(baseAmount));

    const createdBy = actor(t.createdBy, t.createdByName);
    if (!createdBy) {
      issues.push({ level: "error", code: "MISSING_CREATOR", transactionId: ref, message: `${ref} has no Created By information.` });
    }
    const imported = t.importJobId || t.externalCreatorId || t.externalCreatorName || t.externalRef;
    transactions.push({
      transactionId: ref,
      transactionDate: isoDate(t.date),
      type: lower(t.type) as CanonicalTransaction["type"],
      description: t.description,
      amount: money2(t.amount),
      currency: t.currency,
      category: t.category?.name ?? null,
      paymentMethod: t.paymentMethod ?? null,
      journalLines,
      audit: {
        createdBy: createdBy ?? { userId: "UNKNOWN", name: t.createdByName || "Unknown" },
        createdAt: t.createdAt.toISOString(),
        source: lower(t.source) as CanonicalTransaction["audit"]["source"],
        lastModifiedBy: t.updatedById ? actor(t.updatedBy, t.updatedByName) : null,
        lastModifiedAt: t.updatedById ? t.updatedAt.toISOString() : null,
        approvedBy: actor(t.approvedBy),
        approvedAt: iso(t.approvedAt),
        postedBy: actor(t.postedBy),
        postedAt: iso(t.postedAt),
        importedFrom: imported
          ? {
              externalCreatorId: t.externalCreatorId ?? null,
              externalCreatorName: t.externalCreatorName ?? null,
              externalRef: t.externalRef ?? null,
              verified: false,
              note: "Identity supplied by an imported file; it is not a verified VLedger user. createdBy is the user who performed the import.",
            }
          : null,
        ...(filters.includeAuditTrail ? { events: eventsByTxn.get(t.id) ?? [] } : {}),
      },
      status: lower(t.status) as CanonicalTransaction["status"],
      posted,
      exchangeRate: t.exchangeRate.toString(),
      baseAmount,
      reference: t.reference ?? null,
      notes: t.notes ?? null,
      counterparty: t.customer ? { type: "customer", name: t.customer.name } : t.vendor ? { type: "vendor", name: t.vendor.name } : null,
      isAdjustment: t.type === "JOURNAL" ? t.isAdjustment : undefined,
      journalEntryId: t.journalEntry ? journalRef(t.journalEntry.number) : null,
      reversal,
      exportScope: scope.get(t.id) ?? "full",
    });
    exportTransactionIds.push(t.id);
  }

  // ── Journal entries (journal_entries exports) ──
  let journalEntries: CanonicalJournalEntry[] | undefined;
  let unlinkedJournalEntries = 0;
  if (filters.exportType === "journal_entries") {
    await rememberUsers(rows.flatMap((t) => [t.journalEntry?.postedById, t.reversalEntry?.postedById]));
    const items: (CanonicalJournalEntry & { _sort: string })[] = [];
    const pushEntry = (e: EntryRow, txn: { ref: string; createdBy: ActorRef } | null, reversesNumber: number | null) => {
      const problem = checkEntry(e, txn?.ref);
      if (problem && !issues.some((i) => i.message === problem.message)) {
        issues.push(problem);
        allBalanced = false;
      }
      for (const l of e.lines) usedAccountIds.add(l.accountId);
      const postedBy = { userId: refFor(e.postedById), name: e.postedByName };
      items.push({
        _sort: `${isoDate(e.date)}|${String(e.number).padStart(10, "0")}`,
        journalEntryId: journalRef(e.number),
        entryDate: isoDate(e.date),
        entryType: lower(e.type) as CanonicalJournalEntry["entryType"],
        description: e.description,
        reference: e.reference && !e.reference.startsWith("OPENING:") ? e.reference : null,
        transactionId: txn?.ref ?? null,
        reversesJournalEntryId: reversesNumber ? journalRef(reversesNumber) : null,
        totalDebit: money2(e.totalDebit),
        totalCredit: money2(e.totalCredit),
        lines: entryLines(e),
        createdBy: txn?.createdBy ?? postedBy,
        postedBy,
        postedAt: e.postedAt.toISOString(),
      });
    };
    rows.forEach((t, i) => {
      const c = transactions[i];
      const txn = { ref: c.transactionId, createdBy: c.audit.createdBy };
      if (t.journalEntry && c.exportScope !== "reversal_only") pushEntry(t.journalEntry, txn, null);
      if (t.status === "REVERSED" && t.reversalEntry) pushEntry(t.reversalEntry, txn, t.journalEntry?.number ?? null);
    });

    const txnFiltered = (filters.types.length > 0 && filters.types.length < 4) || Boolean(filters.createdById) || filters.categoryIds.length > 0;
    if (!txnFiltered) {
      const standalone = await db.journalEntry.findMany({
        where: {
          workspaceId: wsId,
          date: { gte: fromDate, lte: toDate },
          transaction: { is: null },
          reversalOfTxn: { is: null },
          ...(accountIds.length ? { lines: { some: { accountId: { in: accountIds } } } } : {}),
        },
        include: { lines: lineInclude, reverses: { select: { number: true } } },
        orderBy: [{ date: "asc" }, { number: "asc" }],
      });
      await rememberUsers(standalone.map((e) => e.postedById));
      for (const e of standalone) pushEntry(e, null, e.reverses?.number ?? null);
      unlinkedJournalEntries = standalone.length;
      if (standalone.length && filters.excludeAlreadyExportedTo) {
        issues.push({
          level: "warning",
          code: "UNTRACKED_ENTRIES",
          message: `${standalone.length} opening/stand-alone journal entr${standalone.length === 1 ? "y is" : "ies are"} not linked to a transaction, so duplicate-export prevention cannot track ${standalone.length === 1 ? "it" : "them"} — they are included every time.`,
        });
      }
    }
    items.sort((a, b) => a._sort.localeCompare(b._sort));
    journalEntries = items.map(({ _sort, ...e }) => e);
  }

  // ── Account ledgers (account_ledger exports) ──
  let ledgers: CanonicalLedger[] | undefined;
  if (filters.exportType === "account_ledger") {
    ledgers = await buildLedgers(db, wsId, filters, accountIds, accountById, rememberUsers, refFor);
    for (const g of ledgers) {
      const a = accountByCode.get(g.accountCode);
      if (a) usedAccountIds.add(a.id);
    }
  }

  if (excludedAlreadyExported) {
    issues.push({ level: "warning", code: "ALREADY_EXPORTED", message: `${excludedAlreadyExported} transaction${excludedAlreadyExported === 1 ? " was" : "s were"} already exported to this target and ${excludedAlreadyExported === 1 ? "is" : "are"} excluded.` });
  }
  if (reversalOnly) {
    issues.push({ level: "warning", code: "REVERSAL_ONLY", message: `${reversalOnly} transaction${reversalOnly === 1 ? " was" : "s were"} reversed after the last export to this target — only the reversal entr${reversalOnly === 1 ? "y is" : "ies are"} included.` });
  }
  const recordCount = transactions.length + (journalEntries?.length ?? 0) + (ledgers?.length ?? 0);
  if (!recordCount) issues.push({ level: "error", code: "EMPTY", message: "Nothing matches these filters — there is nothing to export." });

  const accountsUsed = [...usedAccountIds].map((id) => accountById.get(id)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
  const canonicalAccounts: CanonicalAccount[] = accountsUsed.map((a) => ({
    accountCode: a.code,
    accountName: a.name,
    accountType: lower(a.type) as CanonicalAccount["accountType"],
    subtype: a.subtype ?? null,
    isActive: a.isActive,
  }));

  const lineCount = transactions.reduce((n, t) => n + t.journalLines.length + (t.reversal?.journalLines.length ?? 0), 0);
  const filtersEcho = await echoFilters(db, ctx, filters, accountById);

  const data: CanonicalExport = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    exportType: filters.exportType,
    generatedAt: now.toISOString(),
    generatedBy: { userId: userRef(ctx.user.seq), name: ctx.actor.name },
    workspace: workspaceBlock(ctx),
    filters: filtersEcho,
    accounts: canonicalAccounts,
    transactions,
    ...(journalEntries ? { journalEntries } : {}),
    ...(ledgers ? { ledgers } : {}),
    totals: {
      transactionCount: transactions.length,
      journalEntryCount: journalEntries ? journalEntries.length : transactions.reduce((n, t) => n + (t.journalEntryId ? 1 : 0) + (t.reversal ? 1 : 0), 0),
      lineCount,
      totalDebit: money2(integrityDebit),
      totalCredit: money2(integrityCredit),
      byType: { income: money2(byType.income), expense: money2(byType.expense), transfer: money2(byType.transfer), journal: money2(byType.journal) },
    },
    integrity: {
      balanced: allBalanced && integrityDebit.eq(integrityCredit),
      transactionCount: transactions.length,
      totalDebit: money2(integrityDebit),
      totalCredit: money2(integrityCredit),
      checksum: transactionsChecksum(transactions),
      checksumAlgorithm: "sha256",
      checksumScope: "transactions",
    },
  };

  return { data, issues, meta: { exportTransactionIds, excludedAlreadyExported, reversalOnly, unlinkedJournalEntries, accountsUsed } };
}

function workspaceBlock(ctx: WorkspaceContext): CanonicalExport["workspace"] {
  const ws = ctx.workspace;
  return {
    workspaceId: workspaceRef(ws.seq),
    workspaceName: ws.name,
    currency: ws.defaultCurrency,
    workspaceCode: ws.code,
    companyName: ws.companyName,
    financialYearStartMonth: ws.fyStartMonth,
    timeZone: ws.timeZone,
  };
}

function emptyBuild(ctx: WorkspaceContext, filters: CanonicalFilters, issues: ValidationIssue[], now: Date): CanonicalBuild {
  return {
    data: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      exportType: filters.exportType,
      generatedAt: now.toISOString(),
      generatedBy: { userId: userRef(ctx.user.seq), name: ctx.actor.name },
      workspace: workspaceBlock(ctx),
      transactions: [],
    },
    issues,
    meta: { exportTransactionIds: [], excludedAlreadyExported: 0, reversalOnly: 0, unlinkedJournalEntries: 0, accountsUsed: [] },
  };
}

/** Proposed lines of an unposted transaction (canonical exports of drafts only). */
function proposedLines(t: TxnRow, accountById: Map<string, AccountUsed>, used: Set<string>): CanonicalJournalLine[] {
  const line = (accountId: string, debit: string, credit: string, description: string | null, n: number): CanonicalJournalLine | null => {
    const a = accountById.get(accountId);
    if (!a) return null;
    used.add(a.id);
    return { lineNo: n, accountCode: a.code, accountName: a.name, debit: money2(debit), credit: money2(credit), description };
  };
  if (t.type === "JOURNAL") {
    const lines = (t.draftLines as JournalLineInput[] | null) ?? [];
    return lines.map((l, i) => line(l.accountId, l.debit || "0", l.credit || "0", l.description ?? null, i + 1)).filter((l): l is CanonicalJournalLine => Boolean(l));
  }
  const base = toBaseAmount(t.amount, t.exchangeRate);
  const out: CanonicalJournalLine[] = [];
  if (t.debitAccountId) {
    const l = line(t.debitAccountId, base, "0", t.description, 1);
    if (l) out.push(l);
  }
  if (t.creditAccountId) {
    const l = line(t.creditAccountId, "0", base, t.description, out.length + 1);
    if (l) out.push(l);
  }
  return out;
}

async function echoFilters(db: Tx, ctx: WorkspaceContext, f: CanonicalFilters, accountById: Map<string, AccountUsed>): Promise<CanonicalExport["filters"]> {
  const [categories, creator] = await Promise.all([
    f.categoryIds.length ? db.accountCategory.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: f.categoryIds } }, select: { name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    f.createdById
      ? db.user.findFirst({ where: { id: f.createdById, memberships: { some: { workspaceId: ctx.workspace.id } } }, select: { seq: true, name: true } })
      : Promise.resolve(null),
  ]);
  return {
    from: f.from,
    to: f.to,
    financialYear: f.financialYearLabel ?? null,
    types: f.types.length ? f.types.map((t) => t.toLowerCase()) : ["income", "expense", "transfer", "journal"],
    statuses: f.statuses.map((s) => s.toLowerCase()),
    createdBy: creator ? { userId: userRef(creator.seq), name: creator.name } : null,
    categories: categories.map((c) => c.name),
    accounts: f.accountIds.map((id) => accountById.get(id)?.code).filter((c): c is string => Boolean(c)),
    excludeAlreadyExportedTo: f.excludeAlreadyExportedTo ?? null,
  };
}

async function buildLedgers(
  db: Tx,
  wsId: string,
  f: CanonicalFilters,
  accountIds: string[],
  accountById: Map<string, AccountUsed>,
  rememberUsers: (ids: (string | null | undefined)[]) => Promise<void>,
  refFor: (id: string | null | undefined) => string,
): Promise<CanonicalLedger[]> {
  const accountFilter = accountIds.length ? { accountId: { in: accountIds } } : {};
  const [openingSums, lines] = await Promise.all([
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { workspaceId: wsId, ...accountFilter, journalEntry: { date: { lt: parseISODate(f.from) } } },
      _sum: { debit: true, credit: true },
    }),
    db.journalLine.findMany({
      where: { workspaceId: wsId, ...accountFilter, journalEntry: { date: { gte: parseISODate(f.from), lte: parseISODate(f.to) } } },
      select: {
        accountId: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            number: true,
            date: true,
            type: true,
            description: true,
            postedById: true,
            postedByName: true,
            transaction: { select: { number: true, createdByName: true, createdBy: { select: { seq: true } } } },
            reversalOfTxn: { select: { number: true, createdByName: true, createdBy: { select: { seq: true } } } },
          },
        },
      },
      orderBy: [{ journalEntry: { date: "asc" } }, { journalEntry: { number: "asc" } }, { lineNo: "asc" }],
    }),
  ]);
  await rememberUsers(lines.map((l) => l.journalEntry.postedById));

  const opening = new Map(openingSums.map((s) => [s.accountId, { debit: dec(s._sum.debit), credit: dec(s._sum.credit) }]));
  const byAccount = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byAccount.get(l.accountId) ?? [];
    list.push(l);
    byAccount.set(l.accountId, list);
  }
  const ids = accountIds.length
    ? accountIds
    : [...new Set([...byAccount.keys(), ...[...opening.entries()].filter(([, s]) => !s.debit.minus(s.credit).isZero()).map(([id]) => id)])];

  const ledgers: CanonicalLedger[] = [];
  for (const id of ids) {
    const a = accountById.get(id);
    if (!a) continue;
    const debitNormal = isDebitNormal(a.type);
    const o = opening.get(id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    let running = debitNormal ? o.debit.minus(o.credit) : o.credit.minus(o.debit);
    const openingBalance = money2(running);
    let td = new Decimal(0);
    let tc = new Decimal(0);
    const entries = (byAccount.get(id) ?? []).map((l) => {
      const dr = dec(l.debit);
      const cr = dec(l.credit);
      td = td.plus(dr);
      tc = tc.plus(cr);
      running = running.plus(debitNormal ? dr.minus(cr) : cr.minus(dr));
      const e = l.journalEntry;
      const txn = e.transaction ?? e.reversalOfTxn;
      const postedBy = { userId: refFor(e.postedById), name: e.postedByName };
      return {
        date: isoDate(e.date),
        journalEntryId: journalRef(e.number),
        entryType: lower(e.type) as CanonicalLedger["entries"][number]["entryType"],
        transactionId: txn ? txnRef(txn.number) : null,
        description: l.description ?? e.description,
        debit: money2(dr),
        credit: money2(cr),
        balance: money2(running),
        createdBy: txn ? { userId: userRef(txn.createdBy.seq), name: txn.createdByName } : postedBy,
        postedBy,
      };
    });
    ledgers.push({
      accountCode: a.code,
      accountName: a.name,
      accountType: lower(a.type) as CanonicalLedger["accountType"],
      normalBalance: debitNormal ? "debit" : "credit",
      openingBalance,
      totalDebit: money2(td),
      totalCredit: money2(tc),
      closingBalance: money2(running),
      entries,
    });
  }
  return ledgers.sort((x, y) => x.accountCode.localeCompare(y.accountCode));
}

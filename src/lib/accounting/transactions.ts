import { Prisma, type Transaction, type TransactionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { sha256 } from "@/lib/auth/crypto";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { addDays, isoDate, parseISODate, todayInTimeZone } from "@/lib/dates";
import { dec, money2 } from "@/lib/money";
import { CASH_SUBTYPES, PAYMENT_SUBTYPES } from "./coa-template";
import { reverseLines, simpleLines, toBaseAmount, validateJournalLines, type JournalLineInput } from "./journal";

export type ServiceCtx = WorkspaceContext & { meta?: { ip?: string; userAgent?: string } };

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

// ───────────────────────────── Input schema ─────────────────────────────

const amountString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with at most 2 decimals")
  .refine((v) => dec(v).gt(0), "Amount must be greater than zero");

export const journalLineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.string().trim().default("0"),
  credit: z.string().trim().default("0"),
  description: z.string().max(300).nullish(),
});

export const transactionInputSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE", "TRANSFER", "JOURNAL"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    amount: amountString.optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    exchangeRate: z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/)
      .refine((v) => dec(v).gt(0), "Exchange rate must be positive")
      .optional(),
    description: z.string().trim().min(1, "Description is required").max(500),
    categoryId: z.string().nullish(),
    debitAccountId: z.string().nullish(),
    creditAccountId: z.string().nullish(),
    lines: z.array(journalLineSchema).max(200).optional(),
    isAdjustment: z.boolean().optional(),
    paymentMethod: z.string().max(60).nullish(),
    reference: z.string().max(120).nullish(),
    notes: z.string().max(2000).nullish(),
    customerName: z.string().trim().max(160).nullish(),
    vendorName: z.string().trim().max(160).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "JOURNAL" && !v.amount) ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount is required" });
    if (v.type === "JOURNAL" && (!v.lines || v.lines.length < 2)) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "A journal needs at least two lines" });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const intentSchema = z.enum(["draft", "submit", "post", "auto"]).default("draft");
export type Intent = z.infer<typeof intentSchema>;

// ───────────────────────────── Helpers ─────────────────────────────

export function snapshot(t: Transaction) {
  return {
    date: isoDate(t.date),
    type: t.type,
    amount: money2(t.amount),
    currency: t.currency,
    exchangeRate: t.exchangeRate.toString(),
    description: t.description,
    categoryId: t.categoryId,
    debitAccountId: t.debitAccountId,
    creditAccountId: t.creditAccountId,
    draftLines: t.draftLines,
    paymentMethod: t.paymentMethod,
    reference: t.reference,
    notes: t.notes,
    customerId: t.customerId,
    vendorId: t.vendorId,
    status: t.status,
    isAdjustment: t.isAdjustment,
  };
}

export async function allocateNumber(tx: Tx, workspaceId: string, kind: "transaction" | "journal"): Promise<number> {
  const col = Prisma.raw(kind === "transaction" ? `"nextTransactionNumber"` : `"nextJournalNumber"`);
  const rows = await tx.$queryRaw<{ n: number }[]>`
    UPDATE workspace_settings SET ${col} = ${col} + 1 WHERE "workspaceId" = ${workspaceId} RETURNING (${col} - 1)::int AS n`;
  if (!rows.length) throw new Error("Workspace settings missing");
  return rows[0].n;
}

async function lockTransaction(tx: Tx, ctx: ServiceCtx, id: string) {
  await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND "workspaceId" = ${ctx.workspace.id} FOR UPDATE`;
  const txn = await tx.transaction.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!txn) throw notFound("Transaction not found");
  return txn;
}

export function canViewTransaction(ctx: WorkspaceContext, txn: Pick<Transaction, "createdById" | "workspaceId">) {
  if (txn.workspaceId !== ctx.workspace.id) return false;
  return txn.createdById === ctx.user.id || ctx.permissions.has("TRANSACTION_VIEW");
}

function assertCanEditDraft(ctx: WorkspaceContext, txn: Transaction) {
  if (!["DRAFT", "REJECTED"].includes(txn.status)) {
    throw conflict("Only draft or rejected transactions can be edited. Posted entries are corrected by reversal.");
  }
  const own = txn.createdById === ctx.user.id;
  if (!ctx.permissions.has("TRANSACTION_EDIT_DRAFT")) throw forbidden("Missing permission: TRANSACTION_EDIT_DRAFT");
  if (!own && !ctx.permissions.has("TRANSACTION_VIEW")) throw forbidden("You can only edit your own drafts");
}

/** Approval policy. The threshold is in the workspace base currency, so foreign amounts are converted first. */
export function needsApproval(ctx: WorkspaceContext, amount: Prisma.Decimal | string, exchangeRate: Prisma.Decimal | string = "1") {
  const s = ctx.workspace.settings;
  if (!s) return false;
  if (s.requireApproval) return true;
  if (s.approvalThreshold && dec(toBaseAmount(amount, exchangeRate)).gte(dec(s.approvalThreshold))) return true;
  return false;
}

export function duplicateHash(input: { type: string; amount: string; date: string; description: string }) {
  const norm = input.description.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return sha256(`${input.type}|${money2(input.amount)}|${input.date}|${norm}`);
}

function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "for", "and", "from", "with", "paid", "received"].includes(w)),
  );
}

function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Possible duplicates: same type & amount within the workspace's duplicate window, similar description. */
export async function findPossibleDuplicates(
  db: Tx,
  ctx: WorkspaceContext,
  input: { type: string; amount: string; date: string; description: string },
  excludeId?: string,
) {
  const window = ctx.workspace.settings?.duplicateWindowDays ?? 3;
  const candidates = await db.transaction.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      type: input.type as Transaction["type"],
      amount: new Prisma.Decimal(money2(input.amount)),
      status: { notIn: ["REVERSED", "REJECTED"] },
      date: { gte: parseISODate(addDays(input.date, -window)), lte: parseISODate(addDays(input.date, window)) },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, number: true, date: true, description: true, amount: true, currency: true, createdById: true, createdByName: true, status: true },
    take: 20,
  });
  const exact = duplicateHash(input);
  return candidates
    .map((c) => {
      const score =
        duplicateHash({ type: input.type, amount: c.amount.toString(), date: isoDate(c.date), description: c.description }) === exact
          ? 1
          : similarity(c.description, input.description);
      return { ...c, amount: money2(c.amount), date: isoDate(c.date), score };
    })
    .filter((c) => c.score >= 0.34)
    .sort((a, b) => b.score - a.score);
}

type Resolved = {
  amount: string;
  currency: string;
  exchangeRate: string;
  categoryId: string | null;
  debitAccountId: string | null;
  creditAccountId: string | null;
  draftLines: JournalLineInput[] | null;
  customerId: string | null;
  vendorId: string | null;
};

/**
 * Validates every referenced record against the caller's workspace (no
 * cross-workspace references) and derives debit/credit accounts.
 */
async function resolveInput(db: Tx, ctx: WorkspaceContext, input: TransactionInput): Promise<Resolved> {
  const wsId = ctx.workspace.id;
  const currency = (input.currency ?? ctx.workspace.defaultCurrency).toUpperCase();
  const exchangeRate = currency === ctx.workspace.defaultCurrency ? "1" : (input.exchangeRate ?? "");
  if (!exchangeRate) throw badRequest(`Enter the exchange rate from ${currency} to ${ctx.workspace.defaultCurrency}.`);

  const category = input.categoryId
    ? await db.accountCategory.findFirst({ where: { id: input.categoryId, workspaceId: wsId, isActive: true } })
    : null;
  if (input.categoryId && !category) throw badRequest("Category not found in this workspace");

  let debitAccountId = input.debitAccountId ?? null;
  let creditAccountId = input.creditAccountId ?? null;
  let draftLines: JournalLineInput[] | null = null;
  let amount = input.amount ?? "0";

  if (input.type === "EXPENSE") {
    if (category && category.kind !== "EXPENSE") throw badRequest("Choose an expense category");
    debitAccountId = debitAccountId ?? category?.accountId ?? null;
  } else if (input.type === "INCOME") {
    if (category && category.kind !== "INCOME") throw badRequest("Choose an income category");
    creditAccountId = creditAccountId ?? category?.accountId ?? null;
  } else if (input.type === "TRANSFER") {
    if (debitAccountId && creditAccountId && debitAccountId === creditAccountId) {
      throw badRequest("Transfer accounts must be different");
    }
  } else {
    debitAccountId = null;
    creditAccountId = null;
    draftLines = (input.lines ?? []).map((l) => ({
      accountId: l.accountId,
      debit: money2(l.debit || "0"),
      credit: money2(l.credit || "0"),
      description: l.description ?? null,
    }));
    const v = validateJournalLines(draftLines);
    if (!v.ok) throw badRequest(v.errors[0], v.errors);
    amount = v.totalDebit;
  }

  const ids = [debitAccountId, creditAccountId, ...(draftLines ?? []).map((l) => l.accountId)].filter(Boolean) as string[];
  if (ids.length) {
    const found = await db.account.findMany({ where: { id: { in: ids }, workspaceId: wsId }, select: { id: true, isActive: true, type: true, subtype: true } });
    const byId = new Map(found.map((a) => [a.id, a]));
    for (const id of ids) {
      const a = byId.get(id);
      if (!a) throw badRequest("Account not found in this workspace");
      if (!a.isActive) throw badRequest("One of the selected accounts is inactive");
    }
    if (input.type === "TRANSFER") {
      for (const id of [debitAccountId, creditAccountId]) {
        const a = id ? byId.get(id) : null;
        if (a && !(PAYMENT_SUBTYPES as readonly string[]).includes(a.subtype ?? "")) {
          throw badRequest("Transfers move money between bank, cash, wallet or card accounts");
        }
      }
    }
  }

  let customerId: string | null = null;
  let vendorId: string | null = null;
  if (input.customerName) {
    const c = await db.customer.upsert({
      where: { workspaceId_name: { workspaceId: wsId, name: input.customerName } },
      create: { workspaceId: wsId, name: input.customerName },
      update: {},
    });
    customerId = c.id;
  }
  if (input.vendorName) {
    const v = await db.vendor.upsert({
      where: { workspaceId_name: { workspaceId: wsId, name: input.vendorName } },
      create: { workspaceId: wsId, name: input.vendorName },
      update: {},
    });
    vendorId = v.id;
  }

  return { amount: money2(amount), currency, exchangeRate, categoryId: category?.id ?? null, debitAccountId, creditAccountId, draftLines, customerId, vendorId };
}

/** Fields still needed before a transaction can be posted (empty = complete). */
export function missingForPosting(t: Pick<Transaction, "type" | "debitAccountId" | "creditAccountId" | "draftLines" | "amount">) {
  const missing: string[] = [];
  if (t.type === "JOURNAL") {
    const lines = (t.draftLines as JournalLineInput[] | null) ?? [];
    if (!validateJournalLines(lines).ok) missing.push("balanced journal lines");
    return missing;
  }
  if (!dec(t.amount).gt(0)) missing.push("amount");
  if (!t.debitAccountId) missing.push(t.type === "INCOME" ? "receiving account" : t.type === "EXPENSE" ? "expense category/account" : "destination account");
  if (!t.creditAccountId) missing.push(t.type === "EXPENSE" ? "payment account" : t.type === "INCOME" ? "income category/account" : "source account");
  return missing;
}

// ───────────────────────────── Commands ─────────────────────────────

export async function createTransaction(
  ctx: ServiceCtx,
  input: TransactionInput,
  opts: { source: "VOICE" | "TEXT" | "MANUAL" | "IMPORT"; intent?: Intent; rawInput?: string | null; aiConfidence?: number | null; db?: Tx; extra?: Partial<Prisma.TransactionUncheckedCreateInput> },
) {
  if (!ctx.permissions.has("TRANSACTION_CREATE") && opts.source !== "IMPORT") throw forbidden("Missing permission: TRANSACTION_CREATE");
  parseISODate(input.date);

  const run = async (tx: Tx) => {
    const r = await resolveInput(tx, ctx, input);
    const number = await allocateNumber(tx, ctx.workspace.id, "transaction");
    const txn = await tx.transaction.create({
      data: {
        workspaceId: ctx.workspace.id,
        number,
        date: parseISODate(input.date),
        type: input.type,
        amount: r.amount,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        description: input.description,
        categoryId: r.categoryId,
        debitAccountId: r.debitAccountId,
        creditAccountId: r.creditAccountId,
        draftLines: r.draftLines ?? Prisma.DbNull,
        isAdjustment: input.type === "JOURNAL" ? Boolean(input.isAdjustment) : false,
        paymentMethod: input.paymentMethod ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        customerId: r.customerId,
        vendorId: r.vendorId,
        source: opts.source,
        rawInput: opts.rawInput ?? null,
        aiConfidence: opts.aiConfidence ?? null,
        duplicateHash: duplicateHash({ type: input.type, amount: r.amount, date: input.date, description: input.description }),
        // Attribution always comes from the authenticated session.
        createdById: ctx.actor.id,
        createdByName: ctx.actor.name,
        ...(opts.extra ?? {}),
      },
    });
    await audit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      entityType: "TRANSACTION",
      entityId: txn.id,
      transactionId: txn.id,
      action: "CREATED",
      after: { ...snapshot(txn), source: txn.source, aiConfidence: txn.aiConfidence },
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });

    const intent = opts.intent ?? "draft";
    if (intent === "submit") return submitInTx(tx, ctx, txn.id);
    if (intent === "post") return postInTx(tx, ctx, txn.id);
    if (intent === "auto") {
      const eligible =
        ctx.workspace.settings?.autoPostEnabled &&
        (opts.aiConfidence ?? 0) >= (ctx.workspace.settings?.autoPostMinConfidence ?? 0.9) &&
        missingForPosting(txn).length === 0 &&
        ctx.permissions.has("TRANSACTION_POST") &&
        !needsApproval(ctx, txn.amount, txn.exchangeRate) &&
        (await findPossibleDuplicates(tx, ctx, { type: txn.type, amount: r.amount, date: input.date, description: input.description }, txn.id)).length === 0;
      if (eligible) return postInTx(tx, ctx, txn.id, { autoPosted: true });
    }
    return txn;
  };

  return opts.db ? run(opts.db) : prisma.$transaction(run, TX_OPTIONS);
}

export async function updateDraft(ctx: ServiceCtx, id: string, input: TransactionInput, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await lockTransaction(tx, ctx, id);
    assertCanEditDraft(ctx, before);
    parseISODate(input.date);
    const r = await resolveInput(tx, ctx, input);
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        date: parseISODate(input.date),
        type: input.type,
        amount: r.amount,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        description: input.description,
        categoryId: r.categoryId,
        debitAccountId: r.debitAccountId,
        creditAccountId: r.creditAccountId,
        draftLines: r.draftLines ?? Prisma.DbNull,
        isAdjustment: input.type === "JOURNAL" ? Boolean(input.isAdjustment) : false,
        paymentMethod: input.paymentMethod ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        customerId: r.customerId,
        vendorId: r.vendorId,
        status: "DRAFT",
        duplicateHash: duplicateHash({ type: input.type, amount: r.amount, date: input.date, description: input.description }),
        updatedById: ctx.actor.id,
        updatedByName: ctx.actor.name,
      },
    });
    const d = diff(snapshot(before), snapshot(updated));
    await audit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      entityType: "TRANSACTION",
      entityId: id,
      transactionId: id,
      action: "UPDATED",
      reason: reason ?? null,
      before: d.before,
      after: d.after,
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });
    return updated;
  }, TX_OPTIONS);
}

async function submitInTx(tx: Tx, ctx: ServiceCtx, id: string) {
  const txn = await lockTransaction(tx, ctx, id);
  if (!["DRAFT", "REJECTED"].includes(txn.status)) throw conflict("Only drafts can be submitted for approval");
  const own = txn.createdById === ctx.user.id;
  if (!own && !(ctx.permissions.has("TRANSACTION_EDIT_DRAFT") && ctx.permissions.has("TRANSACTION_VIEW"))) {
    throw forbidden("You can only submit your own drafts");
  }
  const missing = missingForPosting(txn);
  if (missing.length) throw badRequest(`Complete these fields before submitting: ${missing.join(", ")}`, { missing });
  const updated = await tx.transaction.update({
    where: { id },
    data: { status: "PENDING_APPROVAL", updatedById: ctx.actor.id, updatedByName: ctx.actor.name },
  });
  await audit(tx, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    entityType: "TRANSACTION",
    entityId: id,
    transactionId: id,
    action: "SUBMITTED",
    before: { status: txn.status },
    after: { status: updated.status },
    ip: ctx.meta?.ip,
    userAgent: ctx.meta?.userAgent,
  });
  return updated;
}

export function submitTransaction(ctx: ServiceCtx, id: string) {
  return prisma.$transaction((tx) => submitInTx(tx, ctx, id), TX_OPTIONS);
}

export async function decideApproval(ctx: ServiceCtx, id: string, decision: "APPROVED" | "REJECTED", comment?: string | null, postAfter = false) {
  if (!ctx.permissions.has("TRANSACTION_APPROVE")) throw forbidden("Missing permission: TRANSACTION_APPROVE");
  if (decision === "REJECTED" && !comment?.trim()) throw badRequest("Give a reason for rejecting");
  return prisma.$transaction(async (tx) => {
    const txn = await lockTransaction(tx, ctx, id);
    if (txn.status !== "PENDING_APPROVAL") throw conflict("Only submitted transactions can be approved or rejected");
    if (txn.createdById === ctx.user.id && !ctx.membership.isAdmin) {
      throw forbidden("You cannot approve or reject your own transaction");
    }
    const approval = await tx.approval.create({
      data: {
        workspaceId: ctx.workspace.id,
        transactionId: id,
        decision,
        comment: comment?.trim() || null,
        decidedById: ctx.actor.id,
        decidedByName: ctx.actor.name,
      },
    });
    const updated = await tx.transaction.update({
      where: { id },
      data:
        decision === "APPROVED"
          ? { status: "APPROVED", approvedById: ctx.actor.id, approvedAt: new Date(), updatedById: ctx.actor.id, updatedByName: ctx.actor.name }
          : { status: "REJECTED", updatedById: ctx.actor.id, updatedByName: ctx.actor.name },
    });
    await audit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      entityType: "TRANSACTION",
      entityId: id,
      transactionId: id,
      action: decision,
      reason: comment ?? null,
      approvalId: approval.id,
      before: { status: txn.status },
      after: { status: updated.status },
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });
    if (decision === "APPROVED" && postAfter && ctx.permissions.has("TRANSACTION_POST")) {
      return postInTx(tx, ctx, id);
    }
    return updated;
  }, TX_OPTIONS);
}

async function postInTx(tx: Tx, ctx: ServiceCtx, id: string, opts: { autoPosted?: boolean } = {}) {
  if (!ctx.permissions.has("TRANSACTION_POST")) throw forbidden("Missing permission: TRANSACTION_POST");
  const txn = await lockTransaction(tx, ctx, id);
  const postable: TransactionStatus[] = ["DRAFT", "APPROVED"];
  if (!postable.includes(txn.status)) {
    throw conflict(txn.status === "POSTED" ? "This transaction is already posted" : `A ${txn.status.toLowerCase().replace("_", " ")} transaction cannot be posted`);
  }
  if (txn.status !== "APPROVED" && needsApproval(ctx, txn.amount, txn.exchangeRate)) {
    throw new ApiError(409, "This transaction needs approval before it can be posted. Submit it for approval.", "APPROVAL_REQUIRED");
  }
  const missing = missingForPosting(txn);
  if (missing.length) throw badRequest(`Complete these fields before posting: ${missing.join(", ")}`, { missing });

  const lines: JournalLineInput[] =
    txn.type === "JOURNAL"
      ? (txn.draftLines as JournalLineInput[])
      : simpleLines(txn.debitAccountId!, txn.creditAccountId!, toBaseAmount(txn.amount, txn.exchangeRate), txn.description);
  const v = validateJournalLines(lines);
  if (!v.ok) throw badRequest(v.errors[0], v.errors);

  const accounts = await tx.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) }, workspaceId: ctx.workspace.id, isActive: true }, select: { id: true } });
  if (new Set(accounts.map((a) => a.id)).size !== new Set(lines.map((l) => l.accountId)).size) {
    throw badRequest("All journal accounts must be active accounts in this workspace");
  }

  const number = await allocateNumber(tx, ctx.workspace.id, "journal");
  const entry = await tx.journalEntry.create({
    data: {
      workspaceId: ctx.workspace.id,
      number,
      date: txn.date,
      type: txn.type === "JOURNAL" && txn.isAdjustment ? "ADJUSTMENT" : "STANDARD",
      description: txn.description,
      reference: txn.reference,
      totalDebit: v.totalDebit,
      totalCredit: v.totalCredit,
      postedById: ctx.actor.id,
      postedByName: ctx.actor.name,
      lines: {
        create: lines.map((l, i) => ({
          workspaceId: ctx.workspace.id,
          accountId: l.accountId,
          lineNo: i + 1,
          debit: l.debit,
          credit: l.credit,
          description: l.description ?? null,
        })),
      },
    },
  });
  const updated = await tx.transaction.update({
    where: { id },
    data: {
      status: "POSTED",
      postedById: ctx.actor.id,
      postedAt: new Date(),
      journalEntryId: entry.id,
      updatedById: ctx.actor.id,
      updatedByName: ctx.actor.name,
    },
  });
  await audit(tx, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    entityType: "TRANSACTION",
    entityId: id,
    transactionId: id,
    action: "POSTED",
    reason: opts.autoPosted ? "Auto-posted: high-confidence AI entry with complete account mapping" : null,
    before: { status: txn.status },
    after: { status: "POSTED", journalEntryId: entry.id, journalNumber: number, lines },
    ip: ctx.meta?.ip,
    userAgent: ctx.meta?.userAgent,
  });
  return updated;
}

export function postTransaction(ctx: ServiceCtx, id: string) {
  return prisma.$transaction((tx) => postInTx(tx, ctx, id), TX_OPTIONS);
}

/**
 * Reverses a posted transaction with a mirror-image journal entry. The original
 * entry and its attribution stay untouched.
 */
export async function reverseTransaction(ctx: ServiceCtx, id: string, reason: string, date?: string | null) {
  if (!ctx.permissions.has("TRANSACTION_REVERSE")) throw forbidden("Missing permission: TRANSACTION_REVERSE");
  if (!reason?.trim()) throw badRequest("A reason is required to reverse a transaction");
  return prisma.$transaction(async (tx) => {
    const txn = await lockTransaction(tx, ctx, id);
    if (txn.status !== "POSTED" || !txn.journalEntryId) throw conflict("Only posted transactions can be reversed");
    const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: txn.journalEntryId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    const reversalDate = date ?? todayInTimeZone(ctx.workspace.timeZone);
    if (parseISODate(reversalDate) < original.date) throw badRequest("The reversal date cannot be before the original entry date");

    const lines = reverseLines(original.lines);
    const v = validateJournalLines(lines);
    if (!v.ok) throw badRequest(v.errors[0]);
    const number = await allocateNumber(tx, ctx.workspace.id, "journal");
    const reversal = await tx.journalEntry.create({
      data: {
        workspaceId: ctx.workspace.id,
        number,
        date: parseISODate(reversalDate),
        type: "REVERSAL",
        description: `Reversal of ${original.description}`,
        reference: txn.reference,
        reversesEntryId: original.id,
        totalDebit: v.totalDebit,
        totalCredit: v.totalCredit,
        postedById: ctx.actor.id,
        postedByName: ctx.actor.name,
        lines: {
          create: lines.map((l, i) => ({
            workspaceId: ctx.workspace.id,
            accountId: l.accountId,
            lineNo: i + 1,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })),
        },
      },
    });
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        status: "REVERSED",
        reversedById: ctx.actor.id,
        reversedAt: new Date(),
        reversalEntryId: reversal.id,
        reversalReason: reason.trim(),
        updatedById: ctx.actor.id,
        updatedByName: ctx.actor.name,
      },
    });
    await audit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      entityType: "TRANSACTION",
      entityId: id,
      transactionId: id,
      action: "REVERSED",
      reason: reason.trim(),
      reversalId: reversal.id,
      before: { status: "POSTED", journalEntryId: original.id },
      after: { status: "REVERSED", reversalEntryId: reversal.id, reversalNumber: number, reversalDate },
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });
    return updated;
  }, TX_OPTIONS);
}

/** Loads one transaction with everything the detail page needs, enforcing visibility. */
export async function getTransactionDetail(ctx: WorkspaceContext, id: string) {
  const txn = await prisma.transaction.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: {
      category: { select: { id: true, name: true } },
      debitAccount: { select: { id: true, code: true, name: true } },
      creditAccount: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      createdBy: { select: { id: true, seq: true, name: true, email: true, status: true } },
      updatedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      postedBy: { select: { id: true, name: true } },
      reversedBy: { select: { id: true, name: true } },
      journalEntry: { include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" } } } },
      reversalEntry: { include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" } } } },
      approvals: { orderBy: { createdAt: "asc" } },
      importJob: { select: { id: true, fileName: true } },
    },
  });
  if (!txn || !canViewTransaction(ctx, txn)) return null;
  const auditEvents = await prisma.auditEvent.findMany({
    where: { workspaceId: ctx.workspace.id, transactionId: id },
    orderBy: { createdAt: "asc" },
  });
  return { txn, auditEvents };
}

export { CASH_SUBTYPES, PAYMENT_SUBTYPES };

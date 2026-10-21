/**
 * Pure analysis of an uploaded canonical JSON file: schema validation, workspace
 * check, per-record journal checks, conversion plan and in-file duplicates.
 * No database access — the import service adds workspace lookups on top.
 */
import { z } from "zod";
import { Decimal } from "@/lib/money";
import { canonicalExportSchema, formatZodIssues, type CanonicalExport, type CanonicalTxnType } from "@/lib/export/canonical-schema";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 5000;

export type FileIssue = { level: "error" | "warning"; message: string };

import { isTallyXml, parseTallyXml } from "./tally-xml";

export type ParseResult = { ok: true; data: CanonicalExport } | { ok: false; errors: { path: string; message: string }[] };

/** Parses and schema-validates file text (supports Canonical JSON and native Tally XML). */
export function parseImportFile(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, errors: [{ path: "(file)", message: "The file is empty." }] };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, errors: [{ path: "(file)", message: "The file is larger than 5 MB. Split the export into smaller date ranges." }] };

  if (isTallyXml(trimmed)) {
    try {
      const data = parseTallyXml(trimmed);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, errors: [{ path: "(file)", message: `Failed to parse Tally XML: ${e instanceof Error ? e.message : "XML error"}` }] };
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, errors: [{ path: "(file)", message: `Not valid JSON or Tally XML: ${e instanceof Error ? e.message : "parse error"}` }] };
  }
  const parsed = canonicalExportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatZodIssues(parsed.error, 200) };
  return { ok: true, data: parsed.data };
}

export type PlannedLine = { accountCode: string; accountName: string | null; debit: string; credit: string; description: string | null };

export type ImportRecord = {
  index: number;
  transactionId: string;
  date: string;
  /** Type in the file. */
  fileType: CanonicalTxnType;
  /** Type that will be created in VLedger. */
  importType: "INCOME" | "EXPENSE" | "TRANSFER" | "JOURNAL";
  description: string;
  /** Amount stored on the new transaction (journal total for JOURNAL imports). */
  amount: string;
  currency: string;
  exchangeRate: string | null;
  category: string | null;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  counterparty: { type: "customer" | "vendor"; name: string } | null;
  isAdjustment: boolean;
  lines: PlannedLine[];
  externalCreator: { userId: string; name: string };
  externalCreatedAt: string;
  externalSource: string;
  fileStatus: string | null;
  balanced: boolean;
  /** Blocking problems — the record will not be imported. */
  issues: string[];
  warnings: string[];
  duplicate: { reason: string; existingRef?: string | null } | null;
  hash: string;
};

export type HashFn = (input: { type: string; amount: string; date: string; description: string }) => string;

const d = (v: string | null | undefined) => new Decimal(v || "0");
const fmt = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function workspaceMatches(file: CanonicalExport["workspace"], ws: { ref: string; code: string }): boolean {
  if (file.workspaceCode) return file.workspaceCode.toUpperCase() === ws.code.toUpperCase() && file.workspaceId === ws.ref;
  return file.workspaceId === ws.ref;
}

/** File-level checks that apply to every record. */
export function fileIssues(data: CanonicalExport, ws: { ref: string; code: string; currency: string }): FileIssue[] {
  const out: FileIssue[] = [];
  if (data.exportType === "account_ledger") out.push({ level: "error", message: "Account ledger exports cannot be imported. Export accounting transactions or journal entries instead." });
  if (!data.transactions.length) out.push({ level: "error", message: "The file contains no transactions." });
  if (data.transactions.length > MAX_IMPORT_RECORDS) out.push({ level: "error", message: `The file has ${data.transactions.length} transactions; import at most ${MAX_IMPORT_RECORDS} at a time.` });
  if (data.workspace.currency !== ws.currency) {
    out.push({ level: "error", message: `The file's base currency (${data.workspace.currency}) differs from this workspace's currency (${ws.currency}). Journal amounts are base-currency amounts and cannot be imported without conversion.` });
  }
  if (!workspaceMatches(data.workspace, ws)) {
    out.push({ level: "warning", message: `This file was exported from “${data.workspace.workspaceName}” (${data.workspace.workspaceId}${data.workspace.workspaceCode ? `, ${data.workspace.workspaceCode}` : ""}), not this workspace (${ws.ref}, ${ws.code}). Confirm before importing.` });
  }
  const standalone = (data.journalEntries ?? []).filter((e) => !e.transactionId).length;
  if (standalone) out.push({ level: "warning", message: `${standalone} stand-alone journal entr${standalone === 1 ? "y" : "ies"} (opening balances or manual ledger entries) ${standalone === 1 ? "is" : "are"} not imported. Set opening balances in the Chart of Accounts.` });
  if (data.integrity && !data.integrity.balanced) out.push({ level: "warning", message: "The file's integrity block reports unbalanced entries; affected records are rejected individually." });
  return out;
}

/**
 * Plans each record: balance check, conversion to a VLedger transaction type,
 * amount consistency and duplicates within the file.
 */
export function planRecords(data: CanonicalExport, ws: { currency: string }, hash: HashFn): ImportRecord[] {
  const seenIds = new Map<string, number>();
  const seenHashes = new Map<string, number>();
  return data.transactions.map((t, index) => {
    const issues: string[] = [];
    const warnings: string[] = [];
    const lines: PlannedLine[] = t.journalLines.map((l) => ({
      accountCode: l.accountCode.trim(),
      accountName: l.accountName ?? null,
      debit: fmt(d(l.debit)),
      credit: fmt(d(l.credit)),
      description: l.description ?? null,
    }));

    let dr = new Decimal(0);
    let cr = new Decimal(0);
    lines.forEach((l, i) => {
      const ld = d(l.debit);
      const lc = d(l.credit);
      if (ld.gt(0) && lc.gt(0)) issues.push(`Line ${i + 1} has both a debit and a credit.`);
      if (ld.isZero() && lc.isZero()) issues.push(`Line ${i + 1} has no amount.`);
      dr = dr.plus(ld);
      cr = cr.plus(lc);
    });
    if (lines.length < 2) issues.push("A transaction needs at least two journal lines.");
    const balanced = lines.length >= 2 && dr.eq(cr) && dr.gt(0);
    if (lines.length >= 2 && !dr.eq(cr)) issues.push(`Journal lines do not balance (debits ${fmt(dr)}, credits ${fmt(cr)}).`);

    const status = t.status ?? (t.posted === false ? "draft" : "posted");
    if (status === "reversed") issues.push("Reversed in the source — skipped so a cancelled entry is not imported.");
    if (status === "rejected") issues.push("Rejected in the source — skipped.");
    if (t.exportScope === "reversal_only") issues.push("The file carries only the reversal of this transaction — skipped.");
    if (["draft", "pending_approval", "approved"].includes(status)) warnings.push(`${status.replace("_", " ")} in the source — imported as a draft.`);

    // Conversion plan.
    let importType: ImportRecord["importType"] = t.type.toUpperCase() as ImportRecord["importType"];
    const debitLines = lines.filter((l) => d(l.debit).gt(0));
    const creditLines = lines.filter((l) => d(l.credit).gt(0));
    const simpleShape = lines.length === 2 && debitLines.length === 1 && creditLines.length === 1;
    if (importType !== "JOURNAL" && !simpleShape) {
      importType = "JOURNAL";
      warnings.push(`Imported as a journal because it has ${lines.length} lines.`);
    }
    let amount = t.amount;
    const currency = importType === "JOURNAL" ? ws.currency : t.currency;
    let exchangeRate: string | null = null;
    if (importType === "JOURNAL") {
      amount = fmt(dr);
      if (t.currency !== ws.currency) warnings.push(`Original currency ${t.currency} ${t.amount}; imported as a ${ws.currency} journal from the base-currency lines.`);
    } else if (balanced) {
      if (t.currency === ws.currency) {
        if (!d(t.amount).eq(dr)) issues.push(`Amount ${t.amount} does not match the journal lines (${fmt(dr)}).`);
      } else {
        exchangeRate = t.exchangeRate ?? null;
        if (!exchangeRate || !d(exchangeRate).gt(0)) issues.push(`Foreign-currency (${t.currency}) transaction without an exchange rate.`);
        else if (!d(t.amount).times(d(exchangeRate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(dr)) {
          issues.push(`${t.currency} ${t.amount} × ${exchangeRate} does not equal the base-currency lines (${fmt(dr)}).`);
        }
      }
    }
    if (!d(amount).gt(0)) issues.push("Amount must be greater than zero.");

    const h = hash({ type: importType, amount, date: t.transactionDate, description: t.description });
    let duplicate: ImportRecord["duplicate"] = null;
    const prevId = seenIds.get(t.transactionId);
    if (prevId !== undefined) duplicate = { reason: `Repeats ${t.transactionId} (record ${prevId + 1}) in this file.` };
    else {
      const prevHash = seenHashes.get(h);
      if (prevHash !== undefined) duplicate = { reason: `Same type, amount, date and description as record ${prevHash + 1} in this file.` };
    }
    if (!seenIds.has(t.transactionId)) seenIds.set(t.transactionId, index);
    if (!seenHashes.has(h)) seenHashes.set(h, index);

    return {
      index,
      transactionId: t.transactionId,
      date: t.transactionDate,
      fileType: t.type,
      importType,
      description: t.description,
      amount,
      currency,
      exchangeRate,
      category: t.category?.trim() || null,
      paymentMethod: t.paymentMethod ?? null,
      reference: t.reference ?? null,
      notes: t.notes ?? null,
      counterparty: t.counterparty ?? null,
      isAdjustment: Boolean(t.isAdjustment),
      lines,
      externalCreator: { userId: t.audit.createdBy.userId, name: t.audit.createdBy.name },
      externalCreatedAt: t.audit.createdAt,
      externalSource: t.audit.source,
      fileStatus: status,
      balanced,
      issues,
      warnings,
      duplicate,
      hash: h,
    };
  });
}

/** Distinct account codes referenced by importable records, with the file's names and line counts. */
export function accountCodesOf(records: ImportRecord[]) {
  const map = new Map<string, { code: string; name: string | null; lines: number }>();
  for (const r of records) {
    for (const l of r.lines) {
      const e = map.get(l.accountCode) ?? { code: l.accountCode, name: l.accountName, lines: 0 };
      e.lines++;
      if (!e.name && l.accountName) e.name = l.accountName;
      map.set(l.accountCode, e);
    }
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Key used in category maps: "INCOME:Service Revenue". */
export const categoryKey = (kind: "INCOME" | "EXPENSE", name: string) => `${kind}:${name}`;

/** Distinct categories referenced by income/expense records (kind-aware). */
export function categoriesOf(records: ImportRecord[]) {
  const map = new Map<string, { key: string; kind: "INCOME" | "EXPENSE"; name: string; records: number }>();
  for (const r of records) {
    if (!r.category || (r.importType !== "INCOME" && r.importType !== "EXPENSE")) continue;
    const key = categoryKey(r.importType, r.category);
    const e = map.get(key) ?? { key, kind: r.importType, name: r.category, records: 0 };
    e.records++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const confirmImportSchema = z.object({
  /** File account code → workspace account id. */
  accountMap: z.record(z.string().max(64), z.string().max(64)).default({}),
  /** "KIND:Category name" → workspace category id, or null to leave blank. */
  categoryMap: z.record(z.string().max(220), z.string().max(64).nullable()).default({}),
  skipDuplicates: z.boolean().default(true),
  postBalanced: z.boolean().default(false),
  acknowledgeWorkspaceMismatch: z.boolean().default(false),
});
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;

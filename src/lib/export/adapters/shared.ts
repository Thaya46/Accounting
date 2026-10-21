/** Helpers shared by the export adapters. Pure — no database or Node-only imports. */
import { Decimal } from "@/lib/money";
import type { CanonicalExport, CanonicalJournalLine, CanonicalTransaction } from "../canonical-schema";
import { clip, shortTimestamp } from "../formats";
import type { AccountMapping, AdapterConfig, AdapterInput, AdapterSpec, CustomColumn, ValidationIssue } from "../types";

export type DocKind = "transaction" | "reversal" | "journal_entry";

/** A balanced posting (voucher / journal) that a native adapter turns into one target document. */
export type PostingDoc = {
  /** Unique, human-readable document reference, e.g. TXN-0001, TXN-0001-REV, JE-0042. */
  ref: string;
  kind: DocKind;
  transactionId: string | null;
  journalEntryId: string | null;
  date: string;
  /** Business type of the source transaction, or the journal entry type for stand-alone entries. */
  type: "income" | "expense" | "transfer" | "journal" | "opening" | "adjustment" | "reversal";
  isReversal: boolean;
  isAdjustment: boolean;
  description: string;
  reference: string | null;
  lines: CanonicalJournalLine[];
  createdBy: { userId: string; name: string };
  createdAt: string | null;
  source: string | null;
  postedBy: { userId: string; name: string } | null;
  reversedBy: { userId: string; name: string } | null;
  reversalReason: string | null;
};

const d = (v: string | null | undefined) => new Decimal(v || "0");
export const fmt2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

function txnDoc(t: CanonicalTransaction): PostingDoc {
  return {
    ref: t.transactionId,
    kind: "transaction",
    transactionId: t.transactionId,
    journalEntryId: t.journalEntryId ?? null,
    date: t.transactionDate,
    type: t.type,
    isReversal: false,
    isAdjustment: Boolean(t.isAdjustment),
    description: t.description,
    reference: t.reference ?? null,
    lines: t.journalLines,
    createdBy: t.audit.createdBy,
    createdAt: t.audit.createdAt,
    source: t.audit.source,
    postedBy: t.audit.postedBy ?? null,
    reversedBy: null,
    reversalReason: null,
  };
}

function reversalDoc(t: CanonicalTransaction): PostingDoc | null {
  if (!t.reversal) return null;
  return {
    ref: `${t.transactionId}-REV`,
    kind: "reversal",
    transactionId: t.transactionId,
    journalEntryId: t.reversal.journalEntryId,
    date: t.reversal.date,
    type: t.type,
    isReversal: true,
    isAdjustment: false,
    description: `Reversal of ${t.description}`,
    reference: t.reference ?? null,
    lines: t.reversal.journalLines,
    createdBy: t.audit.createdBy,
    createdAt: t.audit.createdAt,
    source: t.audit.source,
    postedBy: t.reversal.reversedBy ?? null,
    reversedBy: t.reversal.reversedBy ?? null,
    reversalReason: t.reversal.reason ?? null,
  };
}

/**
 * Documents a native adapter must emit. Transaction exports produce one
 * document per posted transaction plus one per reversal; journal-entry exports
 * produce one per posted journal entry (including opening and adjustment
 * entries that are not tied to a transaction). Unposted transactions are never
 * returned here — adapters reject them in validation.
 */
export function postingDocuments(c: CanonicalExport): PostingDoc[] {
  if (c.exportType === "journal_entries" && c.journalEntries) {
    const byTxn = new Map(c.transactions.map((t) => [t.transactionId, t]));
    return c.journalEntries.map((e) => {
      const t = e.transactionId ? byTxn.get(e.transactionId) : undefined;
      const isReversal = e.entryType === "reversal";
      return {
        ref: e.journalEntryId,
        kind: "journal_entry" as const,
        transactionId: e.transactionId ?? null,
        journalEntryId: e.journalEntryId,
        date: e.entryDate,
        type: t && !isReversal ? t.type : e.entryType === "standard" ? "journal" : e.entryType,
        isReversal,
        isAdjustment: e.entryType === "adjustment",
        description: e.description,
        reference: e.reference ?? null,
        lines: e.lines,
        createdBy: e.createdBy,
        createdAt: t?.audit.createdAt ?? null,
        source: t?.audit.source ?? null,
        postedBy: e.postedBy,
        reversedBy: isReversal ? e.postedBy : null,
        reversalReason: isReversal ? (t?.reversal?.reason ?? null) : null,
      };
    });
  }
  const docs: PostingDoc[] = [];
  for (const t of c.transactions) {
    if (!isPostedTxn(t)) continue;
    if (t.exportScope !== "reversal_only") docs.push(txnDoc(t));
    const rev = t.status === "reversed" ? reversalDoc(t) : null;
    if (rev) docs.push(rev);
  }
  return docs;
}

export function isPostedTxn(t: CanonicalTransaction) {
  if (t.posted === false) return false;
  return !t.status || t.status === "posted" || t.status === "reversed";
}

/** "Created by User A (USR-002) · 2026-10-15 05:00 UTC · voice" — the provenance summary placed in narration/memo fields. */
export function createdBySummary(doc: PostingDoc): string {
  const parts = [`Created by ${doc.createdBy.name} (${doc.createdBy.userId})`];
  if (doc.createdAt) parts.push(shortTimestamp(doc.createdAt));
  if (doc.source) parts.push(`via ${doc.source}`);
  if (doc.isReversal && doc.reversedBy) parts.push(`reversed by ${doc.reversedBy.name} (${doc.reversedBy.userId})`);
  return parts.join(" · ");
}

/** "VLedger TXN-0001 / JE-0001" */
export function vledgerRef(doc: PostingDoc): string {
  const refs = [doc.transactionId, doc.journalEntryId].filter((r, i, a) => r && a.indexOf(r) === i);
  return `VLedger ${refs.join(" / ")}`;
}

/** Narration text: description, provenance and VLedger references, clipped to `max`. */
export function narration(doc: PostingDoc, max: number): string {
  const tail = ` | ${createdBySummary(doc)} | ${vledgerRef(doc)}`;
  const reason = doc.isReversal && doc.reversalReason ? ` (reason: ${doc.reversalReason})` : "";
  const head = clip(`${doc.description}${reason}`, Math.max(20, max - tail.length));
  return clip(`${head}${tail}`, max);
}

export function linesBalance(lines: { debit: string; credit: string }[]) {
  let dr = new Decimal(0);
  let cr = new Decimal(0);
  for (const l of lines) {
    dr = dr.plus(d(l.debit));
    cr = cr.plus(d(l.credit));
  }
  return { debit: dr, credit: cr, balanced: dr.eq(cr) && dr.gt(0) };
}

// ───────────────────────────── Common validation ─────────────────────────────

export function validateCommon(spec: Pick<AdapterSpec, "name" | "allowsDrafts" | "supportedExportTypes">, input: AdapterInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const c = input.canonical;
  if (!spec.supportedExportTypes.includes(c.exportType)) {
    issues.push({ level: "error", code: "UNSUPPORTED_EXPORT_TYPE", message: `${spec.name} does not support ${c.exportType.replace(/_/g, " ")} exports.` });
  }
  if (!spec.allowsDrafts) {
    for (const t of c.transactions) {
      if (!isPostedTxn(t)) {
        issues.push({
          level: "error",
          code: "UNPOSTED_TRANSACTION",
          transactionId: t.transactionId,
          message: `${t.transactionId} is ${t.status?.replace(/_/g, " ") ?? "not posted"}. Only posted entries can be exported to ${spec.name}.`,
        });
      }
    }
  }
  for (const t of c.transactions) {
    if (!t.audit?.createdBy?.name || !t.audit?.createdBy?.userId) {
      issues.push({ level: "error", code: "MISSING_CREATOR", transactionId: t.transactionId, message: `${t.transactionId} has no Created By information.` });
    }
  }
  return issues;
}

/** Every document must balance (debits = credits > 0). */
export function validateBalanced(docs: PostingDoc[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const doc of docs) {
    const b = linesBalance(doc.lines);
    if (doc.lines.length < 2 || !b.balanced) {
      issues.push({
        level: "error",
        code: "UNBALANCED_ENTRY",
        transactionId: doc.transactionId ?? undefined,
        message: `${doc.ref} is not balanced (debits ${fmt2(b.debit)}, credits ${fmt2(b.credit)}, ${doc.lines.length} lines).`,
      });
    }
    for (const l of doc.lines) {
      if (d(l.debit).gt(0) && d(l.credit).gt(0)) {
        issues.push({ level: "error", code: "INVALID_LINE", transactionId: doc.transactionId ?? undefined, message: `${doc.ref}: a line on ${l.accountCode} has both a debit and a credit.` });
      }
    }
  }
  return issues;
}

/** One error per unmapped account code (not per line). */
export function validateMappings(docs: PostingDoc[], mappings: Record<string, AccountMapping>, targetName: string, accountNames: Map<string, string>): ValidationIssue[] {
  const missing = new Map<string, string[]>();
  for (const doc of docs) {
    for (const l of doc.lines) {
      const m = mappings[l.accountCode];
      if (!m || !m.externalCode.trim()) {
        const refs = missing.get(l.accountCode) ?? [];
        if (refs.length < 3 && !refs.includes(doc.ref)) refs.push(doc.ref);
        missing.set(l.accountCode, refs);
      }
    }
  }
  return [...missing.entries()].map(([code, refs]) => ({
    level: "error" as const,
    code: "MISSING_MAPPING",
    accountCode: code,
    message: `Account ${code}${accountNames.get(code) ? ` (${accountNames.get(code)})` : ""} is not mapped to a ${targetName} account — used by ${refs.join(", ")}${refs.length >= 3 ? " and others" : ""}.`,
  }));
}

export function accountNameMap(c: CanonicalExport): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of c.accounts ?? []) m.set(a.accountCode, a.accountName);
  for (const t of c.transactions) for (const l of t.journalLines) if (l.accountName && !m.has(l.accountCode)) m.set(l.accountCode, l.accountName);
  return m;
}

export function accountSubtypeMap(c: CanonicalExport): Map<string, string | null> {
  return new Map((c.accounts ?? []).map((a) => [a.accountCode, a.subtype ?? null]));
}

export function hasErrors(issues: ValidationIssue[]) {
  return issues.some((i) => i.level === "error");
}

export function assertValid(adapterName: string, issues: ValidationIssue[]) {
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`${adapterName} export blocked by ${errors.length} validation error(s): ${errors.slice(0, 3).map((e) => e.message).join(" ")}`);
  }
}

// ───────────────────────────── Configuration ─────────────────────────────

/** Applies field defaults and drops unknown keys. */
export function resolveConfig(spec: Pick<AdapterSpec, "configFields">, raw: unknown): AdapterConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: AdapterConfig = {};
  for (const f of spec.configFields) {
    const v = src[f.key];
    if (f.type === "boolean") out[f.key] = typeof v === "boolean" ? v : Boolean(f.default ?? false);
    else if (f.type === "columns") out[f.key] = Array.isArray(v) ? (v as CustomColumn[]).filter((c) => c && typeof c.field === "string" && typeof c.header === "string") : [];
    else if (f.type === "select") {
      const allowed = (f.options ?? []).map((o) => o.value);
      out[f.key] = typeof v === "string" && allowed.includes(v) ? v : String(f.default ?? allowed[0] ?? "");
    } else out[f.key] = typeof v === "string" && v.trim() ? v.trim() : typeof f.default === "string" ? f.default : "";
  }
  return out;
}

/** Labels of required configuration fields that are still empty. */
export function missingConfig(spec: Pick<AdapterSpec, "configFields">, config: AdapterConfig): string[] {
  return spec.configFields
    .filter((f) => f.required)
    .filter((f) => {
      const v = config[f.key];
      if (f.type === "columns") return !Array.isArray(v) || v.length === 0;
      return typeof v !== "string" || !v.trim();
    })
    .map((f) => f.label);
}

export function configString(config: AdapterConfig, key: string, fallback = ""): string {
  const v = config[key];
  return typeof v === "string" && v ? v : fallback;
}

/** Account codes referenced by the documents. */
export function usedAccountCodes(docs: PostingDoc[]): Set<string> {
  const s = new Set<string>();
  for (const doc of docs) for (const l of doc.lines) s.add(l.accountCode);
  return s;
}

/** Errors for mapped external codes (of used accounts) that fail the target's id format. */
export function validateMappingFormat(docs: PostingDoc[], mappings: Record<string, AccountMapping>, pattern: RegExp, message: (code: string, external: string) => string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const code of usedAccountCodes(docs)) {
    const m = mappings[code];
    if (m?.externalCode?.trim() && !pattern.test(m.externalCode.trim())) {
      issues.push({ level: "error", code: "INVALID_MAPPING", accountCode: code, message: message(code, m.externalCode) });
    }
  }
  return issues;
}

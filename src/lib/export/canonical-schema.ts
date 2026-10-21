/**
 * VLedger canonical accounting JSON — schema version 1.0.
 *
 * One canonical model is produced for every export; native adapters convert it
 * into each target's documented import format. The same schema validates JSON
 * files uploaded to the Import module. Pure module (no server imports).
 */
import { z } from "zod";

export const CANONICAL_SCHEMA_VERSION = "1.0" as const;

export const EXPORT_TYPES = ["accounting_transactions", "journal_entries", "account_ledger"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_TYPE_LABEL: Record<ExportType, string> = {
  accounting_transactions: "Accounting transactions",
  journal_entries: "Journal entries",
  account_ledger: "Account ledgers",
};

export const CANONICAL_TXN_TYPES = ["income", "expense", "transfer", "journal"] as const;
export type CanonicalTxnType = (typeof CANONICAL_TXN_TYPES)[number];

export const CANONICAL_SOURCES = ["voice", "text", "manual", "import"] as const;
export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

export const CANONICAL_STATUSES = ["draft", "pending_approval", "approved", "posted", "reversed", "rejected"] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

export const JOURNAL_ENTRY_TYPES = ["standard", "opening", "adjustment", "reversal"] as const;
export type CanonicalJournalEntryType = (typeof JOURNAL_ENTRY_TYPES)[number];

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

// ───────────────────────────── Primitives ─────────────────────────────

const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;
const SIGNED_AMOUNT_RE = /^-?\d{1,16}(\.\d{1,2})?$/;

/** Non-negative decimal string with at most 2 decimals. Exports always emit exactly 2 ("2500.00"). */
export const amountString = z.string().regex(AMOUNT_RE, 'Use a non-negative amount string with at most 2 decimals, e.g. "2500.00"');
export const signedAmountString = z.string().regex(SIGNED_AMOUNT_RE, 'Use an amount string with at most 2 decimals, e.g. "-150.00"');

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD format")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a valid calendar date");

export const isoDateTime = z.string().datetime({ offset: true, message: "Use an ISO 8601 timestamp, e.g. 2026-10-15T05:00:00Z" });

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO 4217 currency code, e.g. INR");

/** A person reference. `userId` is a VLedger USR- reference (or an external system's id inside `importedFrom`). */
export const actorRefSchema = z.object({
  userId: z.string().trim().min(1, "userId is required").max(64),
  name: z.string().trim().min(1, "name is required").max(200),
});
export type ActorRef = z.infer<typeof actorRefSchema>;

const optionalActor = actorRefSchema.nullish();
const optionalText = (max: number) => z.string().max(max).nullish();

// ───────────────────────────── Building blocks ─────────────────────────────

export const journalLineSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  accountCode: z.string().trim().min(1, "accountCode is required").max(64),
  accountName: optionalText(200),
  debit: amountString,
  credit: amountString,
  description: optionalText(500),
});
export type CanonicalJournalLine = z.infer<typeof journalLineSchema>;

export const auditEventSchema = z.object({
  action: z.string().min(1).max(64),
  actor: actorRefSchema,
  timestamp: isoDateTime,
  reason: optionalText(2000),
  approvalId: optionalText(64),
  reversalJournalEntryId: optionalText(64),
});
export type CanonicalAuditEvent = z.infer<typeof auditEventSchema>;

/** Creator identity carried over from another system. Recorded for provenance only — never trusted as an internal user. */
export const importedFromSchema = z.object({
  externalCreatorId: optionalText(120),
  externalCreatorName: optionalText(200),
  externalRef: optionalText(120),
  verified: z.literal(false).optional(),
  note: optionalText(500),
});

export const transactionAuditSchema = z.object({
  createdBy: actorRefSchema,
  createdAt: isoDateTime,
  source: z.enum(CANONICAL_SOURCES),
  lastModifiedBy: optionalActor,
  lastModifiedAt: isoDateTime.nullish(),
  approvedBy: optionalActor,
  approvedAt: isoDateTime.nullish(),
  postedBy: optionalActor,
  postedAt: isoDateTime.nullish(),
  importedFrom: importedFromSchema.nullish(),
  events: z.array(auditEventSchema).max(5000).optional(),
});
export type CanonicalTransactionAudit = z.infer<typeof transactionAuditSchema>;

export const reversalSchema = z.object({
  journalEntryId: z.string().min(1).max(64),
  date: isoDay,
  reason: optionalText(2000),
  reversedBy: optionalActor,
  reversedAt: isoDateTime.nullish(),
  journalLines: z.array(journalLineSchema).max(500),
});
export type CanonicalReversal = z.infer<typeof reversalSchema>;

export const counterpartySchema = z.object({
  type: z.enum(["customer", "vendor"]),
  name: z.string().trim().min(1).max(160),
});

export const transactionSchema = z.object({
  transactionId: z.string().trim().min(1, "transactionId is required").max(64),
  transactionDate: isoDay,
  type: z.enum(CANONICAL_TXN_TYPES),
  description: z.string().trim().min(1, "description is required").max(500),
  amount: amountString,
  currency: currencyCode,
  category: optionalText(120),
  paymentMethod: optionalText(60),
  journalLines: z.array(journalLineSchema).max(500),
  audit: transactionAuditSchema,
  // ── Extended (optional) ──
  status: z.enum(CANONICAL_STATUSES).optional(),
  posted: z.boolean().optional(),
  exchangeRate: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "exchangeRate must be a positive decimal string").optional(),
  baseAmount: amountString.optional(),
  reference: optionalText(120),
  notes: optionalText(2000),
  counterparty: counterpartySchema.nullish(),
  isAdjustment: z.boolean().optional(),
  journalEntryId: optionalText(64),
  reversal: reversalSchema.nullish(),
  /** "reversal_only" when the original entry was exported to this target earlier and only the reversal is new. */
  exportScope: z.enum(["full", "reversal_only"]).optional(),
});
export type CanonicalTransaction = z.infer<typeof transactionSchema>;

export const accountRefSchema = z.object({
  accountCode: z.string().min(1).max(64),
  accountName: z.string().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  subtype: optionalText(64),
  isActive: z.boolean().optional(),
});
export type CanonicalAccount = z.infer<typeof accountRefSchema>;

export const journalEntrySchema = z.object({
  journalEntryId: z.string().min(1).max(64),
  entryDate: isoDay,
  entryType: z.enum(JOURNAL_ENTRY_TYPES),
  description: z.string().max(500),
  reference: optionalText(120),
  transactionId: optionalText(64),
  reversesJournalEntryId: optionalText(64),
  totalDebit: amountString,
  totalCredit: amountString,
  lines: z.array(journalLineSchema).max(500),
  createdBy: actorRefSchema,
  postedBy: actorRefSchema,
  postedAt: isoDateTime,
});
export type CanonicalJournalEntry = z.infer<typeof journalEntrySchema>;

export const ledgerEntrySchema = z.object({
  date: isoDay,
  journalEntryId: z.string().min(1).max(64),
  entryType: z.enum(JOURNAL_ENTRY_TYPES),
  transactionId: optionalText(64),
  description: z.string().max(500),
  debit: amountString,
  credit: amountString,
  balance: signedAmountString,
  createdBy: actorRefSchema,
  postedBy: actorRefSchema,
});

export const ledgerSchema = z.object({
  accountCode: z.string().min(1).max(64),
  accountName: z.string().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  normalBalance: z.enum(["debit", "credit"]),
  openingBalance: signedAmountString,
  totalDebit: amountString,
  totalCredit: amountString,
  closingBalance: signedAmountString,
  entries: z.array(ledgerEntrySchema).max(100_000),
});
export type CanonicalLedger = z.infer<typeof ledgerSchema>;

export const workspaceRefSchema = z.object({
  workspaceId: z.string().trim().min(1, "workspaceId is required").max(64),
  workspaceName: z.string().trim().min(1, "workspaceName is required").max(200),
  currency: currencyCode,
  workspaceCode: optionalText(32),
  companyName: optionalText(200),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  timeZone: optionalText(64),
});

export const totalsSchema = z.object({
  transactionCount: z.number().int().nonnegative(),
  journalEntryCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  totalDebit: amountString,
  totalCredit: amountString,
  byType: z.object({ income: amountString, expense: amountString, transfer: amountString, journal: amountString }),
});

export const integritySchema = z.object({
  balanced: z.boolean(),
  transactionCount: z.number().int().nonnegative(),
  totalDebit: amountString,
  totalCredit: amountString,
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "checksum must be a sha256 hex digest"),
  checksumAlgorithm: z.literal("sha256").optional(),
  checksumScope: z.literal("transactions").optional(),
});

export const exportFiltersEchoSchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    financialYear: z.string().max(40).nullish(),
    types: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    createdBy: actorRefSchema.nullish(),
    categories: z.array(z.string()).optional(),
    accounts: z.array(z.string()).optional(),
    excludeAlreadyExportedTo: z.string().nullish(),
  })
  .passthrough();

export const canonicalExportSchema = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION, { errorMap: () => ({ message: 'schemaVersion must be "1.0"' }) }),
  exportType: z.enum(EXPORT_TYPES),
  generatedAt: isoDateTime.optional(),
  generatedBy: actorRefSchema.optional(),
  workspace: workspaceRefSchema,
  filters: exportFiltersEchoSchema.optional(),
  accounts: z.array(accountRefSchema).max(10_000).optional(),
  transactions: z.array(transactionSchema).max(50_000),
  journalEntries: z.array(journalEntrySchema).max(100_000).optional(),
  ledgers: z.array(ledgerSchema).max(10_000).optional(),
  totals: totalsSchema.optional(),
  integrity: integritySchema.optional(),
});

export type CanonicalExport = z.infer<typeof canonicalExportSchema>;

/** Readable `path: message` list for a Zod error (used by the import preview). */
export function formatZodIssues(error: z.ZodError, limit = 100): { path: string; message: string }[] {
  return error.issues.slice(0, limit).map((i) => ({
    path: i.path.length ? i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`)).join("").replace(/^\./, "") : "(root)",
    message: i.message,
  }));
}

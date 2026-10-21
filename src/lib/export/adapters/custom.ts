import type { CanonicalExport } from "../canonical-schema";
import { csvSafeText, formatDay, toCsv } from "../formats";
import type { AdapterInput, AdapterSpec, CustomColumn, ExportAdapter, ValidationIssue } from "../types";
import { assertValid, configString, fmt2, missingConfig, postingDocuments, validateBalanced, validateCommon, type PostingDoc } from "./shared";
import { delimiterOf } from "./generic-csv";
import { Decimal } from "@/lib/money";

type LineCtx = {
  c: CanonicalExport;
  doc: PostingDoc;
  line: PostingDoc["lines"][number];
  index: number;
  input: AdapterInput;
  dateLayout: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  txnById: Map<string, CanonicalExport["transactions"][number]>;
};

/** Whitelisted canonical fields a custom layout may use (one row per journal line). */
export const CUSTOM_FIELDS: { field: string; label: string; text?: boolean; get: (x: LineCtx) => string }[] = [
  { field: "date", label: "Entry date", get: (x) => formatDay(x.doc.date, x.dateLayout) },
  { field: "transactionId", label: "Transaction ID (TXN-)", get: (x) => x.doc.transactionId ?? "" },
  { field: "journalEntryId", label: "Journal entry ID (JE-)", get: (x) => x.doc.journalEntryId ?? "" },
  { field: "documentRef", label: "Document reference (TXN-/TXN-…-REV/JE-)", get: (x) => x.doc.ref },
  { field: "entryType", label: "Entry type (standard / reversal / opening / adjustment)", get: (x) => (x.doc.isReversal ? "reversal" : x.doc.type === "opening" ? "opening" : x.doc.isAdjustment ? "adjustment" : "standard") },
  { field: "transactionType", label: "Transaction type", get: (x) => txn(x)?.type ?? x.doc.type },
  { field: "status", label: "Status", get: (x) => txn(x)?.status ?? "posted" },
  { field: "description", label: "Description", text: true, get: (x) => x.doc.description },
  { field: "transactionAmount", label: "Transaction amount", get: (x) => txn(x)?.amount ?? "" },
  { field: "transactionCurrency", label: "Transaction currency", get: (x) => txn(x)?.currency ?? x.c.workspace.currency },
  { field: "exchangeRate", label: "Exchange rate", get: (x) => txn(x)?.exchangeRate ?? "1" },
  { field: "baseCurrency", label: "Base currency", get: (x) => x.c.workspace.currency },
  { field: "category", label: "Category", text: true, get: (x) => txn(x)?.category ?? "" },
  { field: "paymentMethod", label: "Payment method", text: true, get: (x) => txn(x)?.paymentMethod ?? "" },
  { field: "reference", label: "Reference", text: true, get: (x) => x.doc.reference ?? "" },
  { field: "counterparty", label: "Customer / vendor", text: true, get: (x) => txn(x)?.counterparty?.name ?? "" },
  { field: "lineNo", label: "Line number", get: (x) => String(x.line.lineNo ?? x.index + 1) },
  { field: "accountCode", label: "Account code (VLedger)", get: (x) => x.line.accountCode },
  { field: "accountName", label: "Account name (VLedger)", text: true, get: (x) => x.line.accountName ?? "" },
  { field: "externalAccountCode", label: "Mapped external account code", get: (x) => x.input.mappings[x.line.accountCode]?.externalCode ?? "" },
  { field: "externalAccountName", label: "Mapped external account name", text: true, get: (x) => x.input.mappings[x.line.accountCode]?.externalName ?? "" },
  { field: "debit", label: "Debit", get: (x) => x.line.debit },
  { field: "credit", label: "Credit", get: (x) => x.line.credit },
  { field: "signedAmount", label: "Signed amount (debit +, credit −)", get: (x) => fmt2(new Decimal(x.line.debit || "0").minus(new Decimal(x.line.credit || "0"))) },
  { field: "lineDescription", label: "Line description", text: true, get: (x) => x.line.description ?? "" },
  { field: "createdByName", label: "Created by (name)", text: true, get: (x) => x.doc.createdBy.name },
  { field: "createdById", label: "Created by (USR- id)", get: (x) => x.doc.createdBy.userId },
  { field: "createdAt", label: "Created at", get: (x) => x.doc.createdAt ?? "" },
  { field: "source", label: "Entry source", get: (x) => x.doc.source ?? "" },
  { field: "postedByName", label: "Posted by (name)", text: true, get: (x) => x.doc.postedBy?.name ?? "" },
  { field: "postedById", label: "Posted by (USR- id)", get: (x) => x.doc.postedBy?.userId ?? "" },
  { field: "postedAt", label: "Posted at", get: (x) => txn(x)?.audit.postedAt ?? "" },
  { field: "approvedByName", label: "Approved by (name)", text: true, get: (x) => txn(x)?.audit.approvedBy?.name ?? "" },
  { field: "approvedAt", label: "Approved at", get: (x) => txn(x)?.audit.approvedAt ?? "" },
];

const FIELD_BY_KEY = new Map(CUSTOM_FIELDS.map((f) => [f.field, f]));
const PROVENANCE_FIELDS = new Set(["createdByName", "createdById"]);

function txn(x: LineCtx) {
  return x.doc.transactionId ? x.txnById.get(x.doc.transactionId) : undefined;
}

const spec: AdapterSpec = {
  key: "custom",
  name: "Custom accounting software",
  vendor: "Any",
  product: "In-house or unsupported accounting systems with a CSV importer",
  supportedVersions: ["Configurable CSV layout"],
  category: "generic",
  importMechanism: "CSV file whose columns, headings, order, delimiter and date format are defined per workspace from a whitelist of canonical fields.",
  fileType: "CSV (configurable layout)",
  fileExtension: "csv",
  contentType: "text/csv; charset=utf-8",
  implemented: true,
  verificationNote: "The layout is defined by your workspace. VLedger guarantees balanced journals and RFC 4180 quoting; confirm the layout with a test import in the target system.",
  specReferences: [{ label: "RFC 4180 — Common Format and MIME Type for CSV Files", url: "https://www.rfc-editor.org/rfc/rfc4180" }],
  requiredFields: ["At least one configured column"],
  accountMappingRules: "Optional: if accounts are mapped for this target, the externalAccountCode / externalAccountName fields carry the mapping.",
  taxMappingRules: "Tax travels as lines on tax accounts.",
  currencyMapping: "Debit/Credit are base-currency amounts; transactionAmount / transactionCurrency / exchangeRate are available as columns.",
  contactMapping: "The counterparty field carries the customer/vendor name.",
  referenceRules: "transactionId, journalEntryId and documentRef carry VLedger references.",
  limitations: ["Only whitelisted fields can be exported.", "Audit history beyond the selected columns is available in the audit metadata file."],
  provenance: {
    createdByTransfer: "custom-field",
    description: "Include the “Created by” columns in your layout to carry attribution into the target system.",
    fullAuditTransfer: false,
  },
  configFields: [
    { key: "columns", label: "Columns", type: "columns", required: true, help: "Pick fields, set the heading for each and arrange the order." },
    {
      key: "delimiter",
      label: "Delimiter",
      type: "select",
      default: "comma",
      options: [
        { value: "comma", label: "Comma (,)" },
        { value: "semicolon", label: "Semicolon (;)" },
        { value: "tab", label: "Tab" },
      ],
    },
    {
      key: "dateFormat",
      label: "Date format",
      type: "select",
      default: "YYYY-MM-DD",
      options: [
        { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
        { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
        { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
      ],
    },
    { key: "includeHeader", label: "Include heading row", type: "boolean", default: true },
  ],
  requiresAccountMapping: false,
  mapping: { codeLabel: "External account code", codeHint: "Code used by the target system (optional).", nameLabel: "External account name", codeMaxLength: 64 },
  supportedExportTypes: ["accounting_transactions", "journal_entries"],
  allowsDrafts: false,
  defaultExcludeExported: true,
  apiTransfer: { status: "not_applicable", note: "File download." },
};

/** Validates a custom column layout (also used when saving configuration). */
export function validateCustomColumns(columns: CustomColumn[]): string[] {
  const errors: string[] = [];
  if (!columns.length) errors.push("Add at least one column.");
  if (columns.length > 60) errors.push("Use at most 60 columns.");
  columns.forEach((c, i) => {
    if (!FIELD_BY_KEY.has(c.field)) errors.push(`Column ${i + 1}: “${c.field}” is not an allowed field.`);
    if (!c.header.trim()) errors.push(`Column ${i + 1}: enter a heading.`);
    if (c.header.length > 80) errors.push(`Column ${i + 1}: heading is too long.`);
  });
  return errors;
}

function columnsOf(input: AdapterInput): CustomColumn[] {
  const v = input.config.columns;
  return Array.isArray(v) ? v : [];
}

function validate(input: AdapterInput): ValidationIssue[] {
  const issues = validateCommon(spec, input);
  for (const label of missingConfig(spec, input.config)) issues.push({ level: "error", code: "MISSING_CONFIG", message: `Set “${label}” in Integrations › Custom accounting software.` });
  const columns = columnsOf(input);
  if (columns.length) for (const e of validateCustomColumns(columns)) issues.push({ level: "error", code: "INVALID_CONFIG", message: e });
  issues.push(...validateBalanced(postingDocuments(input.canonical)));
  if (columns.length && !columns.some((c) => PROVENANCE_FIELDS.has(c.field))) {
    issues.push({ level: "warning", code: "NO_PROVENANCE_COLUMN", message: "The layout has no Created By column — attribution will only be in the audit metadata file." });
  }
  return issues;
}

function generate(input: AdapterInput) {
  assertValid(spec.name, validate(input));
  const c = input.canonical;
  const columns = columnsOf(input);
  const fmt = configString(input.config, "dateFormat", "YYYY-MM-DD");
  const dateLayout = (fmt === "DD/MM/YYYY" || fmt === "MM/DD/YYYY" ? fmt : "YYYY-MM-DD") as LineCtx["dateLayout"];
  const txnById = new Map(c.transactions.map((t) => [t.transactionId, t]));
  const rows: string[][] = [];
  for (const doc of postingDocuments(c)) {
    doc.lines.forEach((line, index) => {
      const x: LineCtx = { c, doc, line, index, input, dateLayout, txnById };
      rows.push(
        columns.map((col) => {
          const f = FIELD_BY_KEY.get(col.field)!;
          const v = f.get(x);
          return f.text ? csvSafeText(v) : v;
        }),
      );
    });
  }
  const header = input.config.includeHeader === false ? null : columns.map((col) => col.header);
  return {
    files: [{ fileName: `${input.fileBaseName}.csv`, contentType: spec.contentType, content: toCsv(header, rows, delimiterOf(input.config)) }],
    warnings: [],
  };
}

export const customAdapter: ExportAdapter = { ...spec, validate, generate };

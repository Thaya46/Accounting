import type { CanonicalExport } from "../canonical-schema";
import { csvSafeText, toCsv } from "../formats";
import type { AdapterConfig, AdapterSpec, ExportAdapter } from "../types";
import { configString, postingDocuments, validateBalanced, validateCommon } from "./shared";

export const GENERIC_CSV_JOURNAL_HEADER = [
  "Date",
  "Transaction ID",
  "Journal Entry ID",
  "Entry Type",
  "Line No",
  "Account Code",
  "Account Name",
  "Debit",
  "Credit",
  "Line Description",
  "Description",
  "Transaction Type",
  "Status",
  "Category",
  "Payment Method",
  "Reference",
  "Currency",
  "Created By Name",
  "Created By ID",
  "Created At",
  "Source",
] as const;

export const GENERIC_CSV_LEDGER_HEADER = [
  "Account Code",
  "Account Name",
  "Account Type",
  "Date",
  "Journal Entry ID",
  "Entry Type",
  "Transaction ID",
  "Description",
  "Debit",
  "Credit",
  "Balance",
  "Created By Name",
  "Created By ID",
  "Posted By Name",
] as const;

export function delimiterOf(config: AdapterConfig): string {
  const v = configString(config, "delimiter", "comma");
  return v === "semicolon" ? ";" : v === "tab" ? "\t" : ",";
}

const spec: AdapterSpec = {
  key: "generic-csv",
  name: "Generic CSV (journal lines)",
  vendor: "VLedger AI",
  product: "CSV-compatible accounting applications and spreadsheets",
  supportedVersions: ["RFC 4180 CSV"],
  category: "generic",
  importMechanism: "CSV file download — one row per journal line, ready for spreadsheet review or a generic CSV importer with column mapping.",
  fileType: "CSV (UTF-8, RFC 4180, CRLF line endings)",
  fileExtension: "csv",
  contentType: "text/csv; charset=utf-8",
  implemented: true,
  verificationNote: "Open VLedger layout. Map the columns in the receiving application's CSV importer; column names are stable across releases.",
  specReferences: [{ label: "RFC 4180 — Common Format and MIME Type for CSV Files", url: "https://www.rfc-editor.org/rfc/rfc4180" }],
  requiredFields: [...GENERIC_CSV_JOURNAL_HEADER],
  accountMappingRules: "Uses VLedger account codes and names; map them in the receiving application if its codes differ.",
  taxMappingRules: "Tax appears as lines on tax accounts (Input Tax Credit / Output Tax Payable). No tax-code column.",
  currencyMapping: "Debit/Credit are in the workspace base currency (Currency column). Foreign-currency transactions are already converted at their recorded exchange rate.",
  contactMapping: "Not included in the line layout; use the canonical JSON for customer/vendor names.",
  referenceRules: "Transaction ID (TXN-) and Journal Entry ID (JE-) identify the source entry; reversal lines carry the reversal JE- reference and Entry Type = reversal.",
  limitations: [
    "Approval, posting and modification history are not part of the CSV — download the audit metadata file for the full trail.",
    "Text cells that begin with = + or @ are prefixed with an apostrophe to prevent spreadsheet formula injection.",
  ],
  provenance: {
    createdByTransfer: "native",
    description: "Created By name, Created By ID (USR-), Created At and Source are dedicated columns on every line.",
    fullAuditTransfer: false,
  },
  configFields: [
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
      help: "Use semicolon for spreadsheet locales that use a decimal comma.",
    },
  ],
  requiresAccountMapping: false,
  supportedExportTypes: ["accounting_transactions", "journal_entries", "account_ledger"],
  allowsDrafts: false,
  defaultExcludeExported: false,
  apiTransfer: { status: "not_applicable", note: "File download." },
};

function journalRows(c: CanonicalExport) {
  const byTxn = new Map(c.transactions.map((t) => [t.transactionId, t]));
  const rows: (string | number)[][] = [];
  for (const doc of postingDocuments(c)) {
    const t = doc.transactionId ? byTxn.get(doc.transactionId) : undefined;
    const entryType =
      doc.kind === "journal_entry"
        ? doc.isReversal
          ? "reversal"
          : doc.type === "opening" || doc.type === "adjustment"
            ? doc.type
            : doc.isAdjustment
              ? "adjustment"
              : "standard"
        : doc.isReversal
          ? "reversal"
          : doc.isAdjustment
            ? "adjustment"
            : "standard";
    doc.lines.forEach((l, i) => {
      rows.push([
        doc.date,
        doc.transactionId ?? "",
        doc.journalEntryId ?? "",
        entryType,
        l.lineNo ?? i + 1,
        l.accountCode,
        csvSafeText(l.accountName),
        l.debit,
        l.credit,
        csvSafeText(l.description),
        csvSafeText(doc.description),
        t?.type ?? doc.type,
        t?.status ?? "posted",
        csvSafeText(t?.category),
        csvSafeText(t?.paymentMethod),
        csvSafeText(doc.reference),
        c.workspace.currency,
        csvSafeText(doc.createdBy.name),
        doc.createdBy.userId,
        doc.createdAt ?? "",
        doc.source ?? "",
      ]);
    });
  }
  return rows;
}

function ledgerRows(c: CanonicalExport) {
  const rows: (string | number)[][] = [];
  for (const g of c.ledgers ?? []) {
    rows.push([g.accountCode, csvSafeText(g.accountName), g.accountType, c.filters?.from ?? "", "", "opening_balance", "", "Opening balance", "", "", g.openingBalance, "", "", ""]);
    for (const e of g.entries) {
      rows.push([
        g.accountCode,
        csvSafeText(g.accountName),
        g.accountType,
        e.date,
        e.journalEntryId,
        e.entryType,
        e.transactionId ?? "",
        csvSafeText(e.description),
        e.debit,
        e.credit,
        e.balance,
        csvSafeText(e.createdBy.name),
        e.createdBy.userId,
        csvSafeText(e.postedBy.name),
      ]);
    }
    rows.push([g.accountCode, csvSafeText(g.accountName), g.accountType, c.filters?.to ?? "", "", "closing_balance", "", "Closing balance", g.totalDebit, g.totalCredit, g.closingBalance, "", "", ""]);
  }
  return rows;
}

export const genericCsvAdapter: ExportAdapter = {
  ...spec,
  validate(input) {
    const issues = validateCommon(spec, input);
    if (input.canonical.exportType !== "account_ledger") issues.push(...validateBalanced(postingDocuments(input.canonical)));
    return issues;
  },
  generate(input) {
    const c = input.canonical;
    const delimiter = delimiterOf(input.config);
    const content =
      c.exportType === "account_ledger"
        ? toCsv([...GENERIC_CSV_LEDGER_HEADER], ledgerRows(c), delimiter)
        : toCsv([...GENERIC_CSV_JOURNAL_HEADER], journalRows(c), delimiter);
    return { files: [{ fileName: `${input.fileBaseName}.csv`, contentType: spec.contentType, content }], warnings: [] };
  },
};

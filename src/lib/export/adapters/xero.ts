import { csvSafeText, formatDay, toCsv, clip } from "../formats";
import type { AdapterInput, AdapterSpec, ExportAdapter, ValidationIssue } from "../types";
import {
  accountNameMap,
  accountSubtypeMap,
  assertValid,
  configString,
  fmt2,
  missingConfig,
  narration,
  postingDocuments,
  usedAccountCodes,
  validateBalanced,
  validateCommon,
  validateMappingFormat,
  validateMappings,
} from "./shared";
import { Decimal } from "@/lib/money";

/**
 * Column headings of Xero's manual journal import template. Mandatory columns
 * carry a leading asterisk, as in Xero's downloadable templates; Xero asks that
 * headings are not changed.
 */
export const XERO_MANUAL_JOURNAL_HEADER = [
  "*Narration",
  "*Date",
  "Description",
  "*AccountCode",
  "*TaxRate",
  "*Amount",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
] as const;

/** Account kinds Xero does not accept in manual journals (bank accounts and system accounts). */
const XERO_RESTRICTED: Record<string, string> = {
  BANK: "bank account",
  CASH: "bank/cash account",
  WALLET: "bank/wallet account",
  RECEIVABLE: "Accounts Receivable (system account)",
  PAYABLE: "Accounts Payable (system account)",
  RETAINED_EARNINGS: "Retained Earnings (system account)",
};

const spec: AdapterSpec = {
  key: "xero",
  name: "Xero",
  vendor: "Xero Limited",
  product: "Xero (all regions)",
  supportedVersions: ["Xero manual journal CSV import"],
  category: "native",
  importMechanism: "CSV upload: Accounting › Manual journals › Import, then choose the file. Rows with the same Narration and Date become one manual journal.",
  fileType: "CSV — Xero manual journal import template",
  fileExtension: "csv",
  contentType: "text/csv; charset=utf-8",
  implemented: true,
  verificationNote:
    "Generated from the documented import format — run a test import in Xero before relying on it. Headings follow Xero's manual journal template (*Narration, *Date, Description, *AccountCode, *TaxRate, *Amount, Tracking columns); Amount is positive for debits and negative for credits. Compare the headings with the template downloaded from your Xero organisation before the first import.",
  specReferences: [
    { label: "Xero Central — Add, import and post manual journals", url: "https://central.xero.com/s/article/Add-import-and-post-manual-journals-US" },
    { label: "Xero Central — Manual journals support topic", url: "https://central.xero.com/s/topic/0TO1N0000017kp1WAA/manual-journals" },
    { label: "Xero Developer — Accounting API: Manual Journals (Narration, LineAmount sign, AccountCode)", url: "https://developer.xero.com/documentation/api/accounting/manualjournals" },
  ],
  requiredFields: ["*Narration", "*Date", "*AccountCode (mapped, ≤ 10 characters)", "*TaxRate", "*Amount"],
  accountMappingRules: "Each VLedger account must be mapped to a Xero account code (up to 10 characters). Xero does not accept bank accounts or system accounts (Accounts Receivable, Accounts Payable, Retained Earnings) in manual journals — map those to a clearing account or record them in Xero as bank transactions.",
  taxMappingRules: "One tax rate name (workspace setting, e.g. “Tax Exempt”, “No GST”, “No VAT”, “BAS Excluded”) is applied to every line; it must exist in the Xero organisation. Tax amounts travel as lines on the mapped tax accounts.",
  currencyMapping: "Manual journals are in the organisation's base currency. Amounts are the VLedger base-currency amounts.",
  contactMapping: "Manual journals have no contact; counterparty names remain in the narration.",
  referenceRules: "Narration contains the VLedger reference (TXN-0001 / JE-0001), so every journal's Narration is unique and rows group correctly.",
  limitations: [
    "Created By is carried as text in Narration; approval/posting history and the audit trail cannot be transferred — keep the audit metadata file.",
    "Tracking categories are left blank.",
    "Review imported journals in Xero before posting them.",
  ],
  provenance: {
    createdByTransfer: "narration",
    description: "*Narration = description + “Created by <name> (USR-…) · <timestamp> · via <source>” + VLedger references (one narration per journal).",
    fullAuditTransfer: false,
  },
  configFields: [
    { key: "taxRate", label: "Tax rate for journal lines", type: "text", required: true, default: "Tax Exempt", maxLength: 50, help: "Exact tax rate name from Xero › Settings › Tax rates, e.g. Tax Exempt, No GST, No VAT, BAS Excluded." },
    {
      key: "dateFormat",
      label: "Date format",
      type: "select",
      default: "DD/MM/YYYY",
      options: [
        { value: "DD/MM/YYYY", label: "DD/MM/YYYY (UK, AU, NZ, IN, …)" },
        { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
      ],
      help: "Match your Xero organisation's region.",
    },
  ],
  requiresAccountMapping: true,
  mapping: { codeLabel: "Xero account code", codeHint: "Account code from Xero's chart of accounts, e.g. 445.", nameLabel: "Xero account name (reference)", codePattern: "^[^,\\r\\n]{1,10}$", codePatternMessage: "Xero account codes are at most 10 characters.", codeMaxLength: 10 },
  supportedExportTypes: ["accounting_transactions", "journal_entries"],
  allowsDrafts: false,
  defaultExcludeExported: true,
  apiTransfer: { status: "not_implemented", note: "Direct API transfer requires an OAuth connection which is not configured." },
};

function validate(input: AdapterInput): ValidationIssue[] {
  const issues = validateCommon(spec, input);
  for (const label of missingConfig(spec, input.config)) issues.push({ level: "error", code: "MISSING_CONFIG", message: `Set “${label}” in Integrations › Xero.` });
  const docs = postingDocuments(input.canonical);
  issues.push(...validateBalanced(docs));
  issues.push(...validateMappings(docs, input.mappings, "Xero", accountNameMap(input.canonical)));
  issues.push(...validateMappingFormat(docs, input.mappings, /^[^,\r\n]{1,10}$/, (code, ext) => `Mapping for ${code} (“${ext}”) is not a valid Xero account code (max 10 characters).`));
  const subtypes = accountSubtypeMap(input.canonical);
  const names = accountNameMap(input.canonical);
  for (const code of usedAccountCodes(docs)) {
    const kind = XERO_RESTRICTED[subtypes.get(code) ?? ""];
    if (kind) {
      issues.push({
        level: "warning",
        code: "XERO_RESTRICTED_ACCOUNT",
        accountCode: code,
        message: `${code}${names.get(code) ? ` (${names.get(code)})` : ""} is a ${kind}. Xero rejects manual journal lines on bank and system accounts unless it is mapped to a non-bank account such as a clearing account.`,
      });
    }
  }
  return issues;
}

function generate(input: AdapterInput) {
  assertValid(spec.name, validate(input));
  const taxRate = configString(input.config, "taxRate", "Tax Exempt");
  const layout = configString(input.config, "dateFormat", "DD/MM/YYYY") === "MM/DD/YYYY" ? "MM/DD/YYYY" : "DD/MM/YYYY";
  const rows: string[][] = [];
  const docs = postingDocuments(input.canonical);
  for (const doc of docs) {
    const text = csvSafeText(narration(doc, 4000));
    for (const l of doc.lines) {
      const debit = new Decimal(l.debit || "0");
      const amount = debit.gt(0) ? fmt2(debit) : `-${fmt2(new Decimal(l.credit || "0"))}`;
      rows.push([text, formatDay(doc.date, layout), csvSafeText(clip(l.description || doc.description, 4000)), input.mappings[l.accountCode].externalCode.trim(), taxRate, amount, "", "", "", ""]);
    }
  }
  return {
    files: [{ fileName: `${input.fileBaseName}.csv`, contentType: spec.contentType, content: toCsv([...XERO_MANUAL_JOURNAL_HEADER], rows) }],
    warnings: [`${docs.length} manual journal${docs.length === 1 ? "" : "s"} (${rows.length} lines), tax rate “${taxRate}”, dates ${layout}.`],
  };
}

export const xeroAdapter: ExportAdapter = { ...spec, validate, generate };

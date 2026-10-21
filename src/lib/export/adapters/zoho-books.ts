import { clip } from "../formats";
import type { AdapterInput, AdapterSpec, ExportAdapter, ValidationIssue } from "../types";
import { accountNameMap, assertValid, configString, createdBySummary, fmt2, narration, postingDocuments, validateBalanced, validateCommon, validateMappingFormat, validateMappings } from "./shared";
import { Decimal } from "@/lib/money";

/** Largest amount that survives a JSON number round-trip with 2 decimals. */
const MAX_JSON_AMOUNT = new Decimal("99999999999.99");

const spec: AdapterSpec = {
  key: "zoho-books",
  name: "Zoho Books",
  vendor: "Zoho Corporation",
  product: "Zoho Books (all editions with the Books API v3)",
  supportedVersions: ["Zoho Books API v3"],
  category: "native",
  importMechanism:
    "Manual journal request bodies for POST https://www.zohoapis.com/books/v3/journals?organization_id=<id> (OAuth scope ZohoBooks.accountants.CREATE). The file is a JSON array; each element is one request body.",
  fileType: "JSON array of Create-a-journal request bodies",
  fileExtension: "json",
  contentType: "application/json",
  implemented: true,
  verificationNote:
    "Generated from the documented Zoho Books API v3 journal request (journal_date, reference_number, notes, journal_type, status, line_items[account_id, description, amount, debit_or_credit], custom_fields) — run a test import in Zoho Books before relying on it.",
  specReferences: [
    { label: "Zoho Books API v3 — Journals (Create a journal)", url: "https://www.zoho.com/books/api/v3/journals/" },
    { label: "Zoho Books API v3 — OAuth", url: "https://www.zoho.com/books/api/v3/oauth/" },
  ],
  requiredFields: ["journal_date", "line_items[].account_id (mapped)", "line_items[].amount", "line_items[].debit_or_credit"],
  accountMappingRules: "Each VLedger account must be mapped to a Zoho Books account_id (numeric id from the Chart of Accounts API or the account's page URL).",
  taxMappingRules: "No tax_id is sent; tax travels as plain lines on the mapped tax accounts. Zoho's tax-aware journal fields (tax_id, VAT treatment) are left unset.",
  currencyMapping: "currency_id and exchange_rate are omitted, so journals are recorded in the organisation's base currency. Amounts are the VLedger base-currency amounts.",
  contactMapping: "customer_id is not sent (contacts are not mapped). Counterparty names remain in the description.",
  referenceRules: "reference_number = VLedger reference (TXN-0001, TXN-0001-REV or JE-0042). notes repeat the reference and journal entry id.",
  limitations: [
    "Direct API transfer requires an OAuth connection which is not configured — status for API transfer: Not Implemented. Use the payloads with your own authorised integration.",
    "Created By is carried as text in notes, line descriptions and (optionally) a journal custom field; approval/posting history and the audit trail cannot be transferred.",
    "Zoho rejects some system account types in manual journals (error 11016 “Involved account types are not applicable”); map those accounts to journal-eligible accounts.",
  ],
  provenance: {
    createdByTransfer: "memo",
    description: "notes = description + “Created by <name> (USR-…) · <timestamp> · via <source>” + VLedger references. If a journal custom field id is configured, it receives “<name> (USR-…)”.",
    fullAuditTransfer: false,
  },
  configFields: [
    {
      key: "status",
      label: "Journal status",
      type: "select",
      default: "draft",
      options: [
        { value: "draft", label: "Draft (review in Zoho Books)" },
        { value: "published", label: "Published" },
      ],
    },
    {
      key: "journalType",
      label: "Journal type",
      type: "select",
      default: "both",
      options: [
        { value: "both", label: "Both (accrual and cash basis)" },
        { value: "cash", label: "Cash basis only" },
      ],
    },
    { key: "createdByCustomFieldId", label: "Created By custom field id (optional)", type: "text", maxLength: 40, help: "customfield_id of a text custom field on Zoho Books journals that should receive the creator.", placeholder: "460000000098001" },
  ],
  requiresAccountMapping: true,
  mapping: { codeLabel: "Zoho account_id", codeHint: "Numeric account_id, e.g. 460000000000361.", nameLabel: "Zoho account name (reference)", codePattern: "^[0-9]{1,32}$", codePatternMessage: "Zoho Books account_id values are numeric.", codeMaxLength: 32 },
  supportedExportTypes: ["accounting_transactions", "journal_entries"],
  allowsDrafts: false,
  defaultExcludeExported: true,
  apiTransfer: { status: "not_implemented", note: "Direct API transfer requires an OAuth connection which is not configured." },
};

function validate(input: AdapterInput): ValidationIssue[] {
  const issues = validateCommon(spec, input);
  const docs = postingDocuments(input.canonical);
  issues.push(...validateBalanced(docs));
  issues.push(...validateMappings(docs, input.mappings, "Zoho Books", accountNameMap(input.canonical)));
  issues.push(...validateMappingFormat(docs, input.mappings, /^[0-9]{1,32}$/, (code, ext) => `Mapping for ${code} (“${ext}”) is not a numeric Zoho Books account_id.`));
  for (const doc of docs) {
    if (doc.lines.some((l) => new Decimal(l.debit || "0").gt(MAX_JSON_AMOUNT) || new Decimal(l.credit || "0").gt(MAX_JSON_AMOUNT))) {
      issues.push({ level: "error", code: "AMOUNT_TOO_LARGE", transactionId: doc.transactionId ?? undefined, message: `${doc.ref} has an amount too large for a JSON number.` });
    }
  }
  const cf = configString(input.config, "createdByCustomFieldId");
  if (cf && !/^[0-9]{1,40}$/.test(cf)) issues.push({ level: "error", code: "INVALID_CONFIG", message: "The Zoho Books custom field id must be numeric." });
  return issues;
}

function generate(input: AdapterInput) {
  assertValid(spec.name, validate(input));
  const status = configString(input.config, "status", "draft");
  const journalType = configString(input.config, "journalType", "both");
  const customFieldId = configString(input.config, "createdByCustomFieldId");
  const payloads = postingDocuments(input.canonical).map((doc) => ({
    journal_date: doc.date,
    reference_number: doc.ref,
    notes: narration(doc, 1000),
    journal_type: journalType,
    status,
    line_items: doc.lines.map((l) => {
      const debit = new Decimal(l.debit || "0");
      const isDebit = debit.gt(0);
      return {
        account_id: input.mappings[l.accountCode].externalCode.trim(),
        description: clip(`${l.description || doc.description} (${createdBySummary(doc)})`, 500),
        amount: Number(fmt2(isDebit ? debit : new Decimal(l.credit || "0"))),
        debit_or_credit: isDebit ? "debit" : "credit",
      };
    }),
    ...(customFieldId ? { custom_fields: [{ customfield_id: customFieldId, value: `${doc.createdBy.name} (${doc.createdBy.userId})` }] } : {}),
  }));
  return {
    files: [{ fileName: `${input.fileBaseName}.json`, contentType: "application/json", content: JSON.stringify(payloads, null, 2) + "\n" }],
    warnings: [`${payloads.length} journal request bod${payloads.length === 1 ? "y" : "ies"} for POST /books/v3/journals (status: ${status}). Direct API transfer is not implemented.`],
  };
}

export const zohoBooksAdapter: ExportAdapter = { ...spec, validate, generate };

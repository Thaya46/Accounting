import { clip } from "../formats";
import type { AdapterInput, AdapterSpec, ExportAdapter, ValidationIssue } from "../types";
import { accountNameMap, accountSubtypeMap, assertValid, fmt2, narration, postingDocuments, validateBalanced, validateCommon, validateMappingFormat, validateMappings } from "./shared";
import { Decimal } from "@/lib/money";

const MAX_JSON_AMOUNT = new Decimal("99999999999.99");
/** Intuit .NET SDK reference: "The maximum length for DocNumber is 21 characters" (QBO). */
export const QBO_DOCNUMBER_MAX = 21;

const spec: AdapterSpec = {
  key: "quickbooks-online",
  name: "QuickBooks Online",
  vendor: "Intuit",
  product: "QuickBooks Online (Accounting API v3)",
  supportedVersions: ["QuickBooks Online Accounting API v3"],
  category: "native",
  importMechanism: "JournalEntry objects for POST https://quickbooks.api.intuit.com/v3/company/<realmId>/journalentry. The file is a JSON array; each element is one JournalEntry request body.",
  fileType: "JSON array of JournalEntry objects",
  fileExtension: "json",
  contentType: "application/json",
  implemented: true,
  verificationNote:
    "Generated from the documented JournalEntry entity (Line[] with DetailType JournalEntryLineDetail, PostingType Debit/Credit, AccountRef; DocNumber ≤ 21 characters; TxnDate; PrivateNote) — run a test import in QuickBooks Online before relying on it.",
  specReferences: [
    { label: "Intuit — QuickBooks Online Accounting API: JournalEntry", url: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry" },
    { label: "Intuit SDK reference — JournalEntry properties (DocNumber max 21, PrivateNote, TxnDate)", url: "https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm" },
    { label: "Intuit SDK reference — JournalEntryLineDetail (PostingType, AccountRef)", url: "https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/JournalEntryLineDetail.html" },
  ],
  requiredFields: ["Line[] (≥ 2, balanced)", "Line.DetailType = JournalEntryLineDetail", "Line.Amount", "JournalEntryLineDetail.PostingType", "JournalEntryLineDetail.AccountRef.value (mapped)"],
  accountMappingRules: "Each VLedger account must be mapped to a QuickBooks Account Id (AccountRef.value). The optional external name is sent as AccountRef.name.",
  taxMappingRules: "No TaxCodeRef / TxnTaxDetail is sent; tax travels as plain lines on the mapped tax accounts. Companies that require tax on journal lines must add it in QuickBooks.",
  currencyMapping: "CurrencyRef and ExchangeRate are omitted, so entries are in the company's home currency. Amounts are the VLedger base-currency amounts.",
  contactMapping: "Entity (customer/vendor) is not sent. QuickBooks requires a customer on Accounts Receivable lines and a vendor on Accounts Payable lines — see warnings.",
  referenceRules: "DocNumber = VLedger reference (TXN-0001, TXN-0001-REV or JE-0042, max 21 characters). PrivateNote repeats the reference and journal entry id.",
  limitations: [
    "Direct API transfer requires an OAuth connection which is not configured — status for API transfer: Not Implemented. Use the objects with your own authorised integration.",
    "Created By is carried as text in PrivateNote; approval/posting history and the audit trail cannot be transferred.",
    "Lines on Accounts Receivable / Accounts Payable need a customer / vendor Entity, which VLedger does not map.",
  ],
  provenance: {
    createdByTransfer: "memo",
    description: "PrivateNote (organisation-private memo) = description + “Created by <name> (USR-…) · <timestamp> · via <source>” + VLedger references.",
    fullAuditTransfer: false,
  },
  configFields: [{ key: "sendDocNumber", label: "Send VLedger reference as DocNumber", type: "boolean", default: true, help: "Turn off to let QuickBooks leave the journal number blank." }],
  requiresAccountMapping: true,
  mapping: { codeLabel: "QuickBooks Account Id", codeHint: "Numeric Account.Id, e.g. 33.", nameLabel: "QuickBooks account name", codePattern: "^[0-9]{1,20}$", codePatternMessage: "QuickBooks Online Account Ids are numeric.", codeMaxLength: 20 },
  supportedExportTypes: ["accounting_transactions", "journal_entries"],
  allowsDrafts: false,
  defaultExcludeExported: true,
  apiTransfer: { status: "not_implemented", note: "Direct API transfer requires an OAuth connection which is not configured." },
};

function validate(input: AdapterInput): ValidationIssue[] {
  const issues = validateCommon(spec, input);
  const docs = postingDocuments(input.canonical);
  issues.push(...validateBalanced(docs));
  issues.push(...validateMappings(docs, input.mappings, "QuickBooks Online", accountNameMap(input.canonical)));
  issues.push(...validateMappingFormat(docs, input.mappings, /^[0-9]{1,20}$/, (code, ext) => `Mapping for ${code} (“${ext}”) is not a numeric QuickBooks Account Id.`));
  const subtypes = accountSubtypeMap(input.canonical);
  const arAp = new Set<string>();
  for (const doc of docs) {
    if (doc.ref.length > QBO_DOCNUMBER_MAX) {
      issues.push({ level: "warning", code: "DOCNUMBER_TRUNCATED", transactionId: doc.transactionId ?? undefined, message: `${doc.ref} is longer than ${QBO_DOCNUMBER_MAX} characters and will be truncated in DocNumber.` });
    }
    if (doc.lines.some((l) => new Decimal(l.debit || "0").gt(MAX_JSON_AMOUNT) || new Decimal(l.credit || "0").gt(MAX_JSON_AMOUNT))) {
      issues.push({ level: "error", code: "AMOUNT_TOO_LARGE", transactionId: doc.transactionId ?? undefined, message: `${doc.ref} has an amount too large for a JSON number.` });
    }
    for (const l of doc.lines) {
      const st = subtypes.get(l.accountCode);
      if (st === "RECEIVABLE" || st === "PAYABLE") arAp.add(l.accountCode);
    }
  }
  for (const code of arAp) {
    issues.push({
      level: "warning",
      code: "ENTITY_REQUIRED",
      accountCode: code,
      message: `Lines on ${code} post to Accounts ${subtypes.get(code) === "RECEIVABLE" ? "Receivable — QuickBooks requires a customer" : "Payable — QuickBooks requires a vendor"} on such lines; add it in QuickBooks or map ${code} to another account.`,
    });
  }
  return issues;
}

function generate(input: AdapterInput) {
  assertValid(spec.name, validate(input));
  const sendDocNumber = input.config.sendDocNumber !== false;
  const entries = postingDocuments(input.canonical).map((doc) => ({
    ...(sendDocNumber ? { DocNumber: doc.ref.slice(0, QBO_DOCNUMBER_MAX) } : {}),
    TxnDate: doc.date,
    PrivateNote: narration(doc, 1000),
    ...(doc.isAdjustment ? { Adjustment: true } : {}),
    Line: doc.lines.map((l) => {
      const debit = new Decimal(l.debit || "0");
      const isDebit = debit.gt(0);
      const m = input.mappings[l.accountCode];
      return {
        Description: clip(l.description || doc.description, 1000),
        Amount: Number(fmt2(isDebit ? debit : new Decimal(l.credit || "0"))),
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: isDebit ? "Debit" : "Credit",
          AccountRef: { value: m.externalCode.trim(), ...(m.externalName?.trim() ? { name: m.externalName.trim() } : {}) },
        },
      };
    }),
  }));
  return {
    files: [{ fileName: `${input.fileBaseName}.json`, contentType: "application/json", content: JSON.stringify(entries, null, 2) + "\n" }],
    warnings: [`${entries.length} JournalEntry object${entries.length === 1 ? "" : "s"} for POST /v3/company/<realmId>/journalentry. Direct API transfer is not implemented.`],
  };
}

export const quickBooksOnlineAdapter: ExportAdapter = { ...spec, validate, generate };

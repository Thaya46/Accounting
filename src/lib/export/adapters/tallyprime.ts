import { asciiPunctuation, formatDay, xmlEscape } from "../formats";
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
  validateBalanced,
  validateCommon,
  validateMappings,
  type PostingDoc,
} from "./shared";
import { Decimal } from "@/lib/money";

/** Subtypes that live under Tally's Bank Accounts / Cash-in-Hand groups. */
const CASH_LIKE = new Set(["BANK", "CASH", "WALLET"]);

const spec: AdapterSpec = {
  key: "tallyprime",
  name: "TallyPrime",
  vendor: "Tally Solutions",
  product: "TallyPrime (also accepted by Tally.ERP 9 Release 6.x)",
  supportedVersions: ["TallyPrime (XML import, current releases)", "Tally.ERP 9 Release 6.x"],
  category: "native",
  importMechanism: "XML voucher import: Gateway of Tally › Import › Transactions (Vouchers) and choose the .xml file, or POST the same envelope to Tally's XML/HTTP server (port 9000).",
  fileType: "Tally XML envelope (TALLYREQUEST Import / TYPE Data / ID Vouchers)",
  fileExtension: "xml",
  contentType: "application/xml; charset=utf-8",
  implemented: true,
  verificationNote:
    "Generated from the documented import format — run a test import in TallyPrime before relying on it. Structure follows Tally's developer reference (Case Study I request format and Sample XML): ALLLEDGERENTRIES.LIST with ISDEEMEDPOSITIVE Yes and a negative AMOUNT for debits, No and a positive AMOUNT for credits, dates as YYYYMMDD.",
  specReferences: [
    { label: "Tally Developer Reference — XML request/response formats (Case Study I)", url: "https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/case_study_1.htm" },
    { label: "Tally Help — Sample XML (voucher import, ISDEEMEDPOSITIVE)", url: "https://help.tallysolutions.com/sample-xml/" },
    { label: "Tally Help — Understanding Tally XML tags (STATICVARIABLES / SVCURRENTCOMPANY)", url: "https://help.tallysolutions.com/understanding-tally-xml-tags/" },
    { label: "Tally Help — Import data into TallyPrime", url: "https://help.tallysolutions.com/tally-prime/data-management/import-data" },
  ],
  requiredFields: ["Company name (SVCURRENTCOMPANY)", "DATE", "VOUCHERTYPENAME", "LEDGERNAME for every line (mapped)", "ISDEEMEDPOSITIVE", "AMOUNT"],
  accountMappingRules: "Every VLedger account used must be mapped to an existing TallyPrime ledger name (exact spelling, case-insensitive in Tally). Tally rejects vouchers that reference a ledger that does not exist — create or import ledger masters first.",
  taxMappingRules: "No GST/VAT computation. Tax amounts travel as ordinary ledger lines on the mapped duty ledgers (e.g. Input Tax Credit → Input CGST/SGST ledgers).",
  currencyMapping: "Amounts are the workspace base currency. Forex vouchers (rate of exchange) are not generated — the company's base currency must match the workspace currency.",
  contactMapping: "Customers and vendors are not created as party ledgers; the counterparty name appears in the narration of the source description only.",
  referenceRules:
    "Voucher type is chosen from the posting: money leaving a cash/bank/wallet ledger → Payment; money arriving → Receipt; cash/bank to cash/bank → Contra; anything else (including opening and adjustment entries) → Journal. VOUCHERNUMBER is the VLedger reference (TXN-0001, TXN-0001-REV, JE-0042) unless Tally numbering is selected.",
  limitations: [
    "Created By is carried only as text in NARRATION; approval, posting and modification history cannot be transferred — keep the audit metadata file with the import.",
    "Voucher types with automatic numbering may renumber imported vouchers; the VLedger reference stays in the narration.",
    "Bill-wise details, cost centres, inventory and GST classifications are not generated.",
    "Opening balances are normally entered on Tally ledger masters; opening entries exported as Journal vouchers should be reviewed.",
  ],
  provenance: {
    createdByTransfer: "narration",
    description: "NARRATION carries the description, “Created by <name> (USR-…) · <timestamp> · via <source>” and the VLedger TXN/JE references.",
    fullAuditTransfer: false,
  },
  configFields: [
    { key: "companyName", label: "TallyPrime company name", type: "text", required: true, maxLength: 200, help: "Exactly as shown in TallyPrime (sent as SVCURRENTCOMPANY so vouchers land in the right company).", placeholder: "ABC Technologies Pvt Ltd" },
    {
      key: "voucherNumbering",
      label: "Voucher numbers",
      type: "select",
      default: "reference",
      options: [
        { value: "reference", label: "Use VLedger references (TXN-0001)" },
        { value: "tally", label: "Let TallyPrime number vouchers" },
      ],
    },
    { key: "paymentVoucherType", label: "Payment voucher type", type: "text", default: "Payment", maxLength: 100 },
    { key: "receiptVoucherType", label: "Receipt voucher type", type: "text", default: "Receipt", maxLength: 100 },
    { key: "contraVoucherType", label: "Contra voucher type", type: "text", default: "Contra", maxLength: 100 },
    { key: "journalVoucherType", label: "Journal voucher type", type: "text", default: "Journal", maxLength: 100 },
  ],
  requiresAccountMapping: true,
  mapping: { codeLabel: "Tally ledger name", codeHint: "Exact ledger name in TallyPrime, e.g. “HDFC Bank A/c”.", codeMaxLength: 200 },
  supportedExportTypes: ["accounting_transactions", "journal_entries"],
  allowsDrafts: false,
  defaultExcludeExported: true,
  apiTransfer: { status: "not_implemented", note: "Direct transfer to Tally's XML server needs network access to the customer's Tally instance, which is not configured. Import the file in TallyPrime." },
};

export type TallyVoucherKind = "payment" | "receipt" | "contra" | "journal" | "sales" | "purchase";

/** Picks the Tally voucher class from where money moves (see referenceRules). */
export function tallyVoucherKind(doc: PostingDoc, subtypes: Map<string, string | null>): TallyVoucherKind {
  if (doc.type === "opening" || doc.isAdjustment) return "journal";
  const cash = (code: string) => CASH_LIKE.has(subtypes.get(code) ?? "");
  const debits = doc.lines.filter((l) => new Decimal(l.debit || "0").gt(0));
  const credits = doc.lines.filter((l) => new Decimal(l.credit || "0").gt(0));
  const debitCash = debits.some((l) => cash(l.accountCode));
  const creditCash = credits.some((l) => cash(l.accountCode));
  if (debitCash && creditCash && doc.lines.every((l) => cash(l.accountCode))) return "contra";
  if (creditCash) return "payment";
  if (debitCash) return "receipt";
  if (credits.some((l) => l.accountCode.toUpperCase().includes("SALE"))) return "sales";
  if (debits.some((l) => l.accountCode.toUpperCase().includes("PURCH"))) return "purchase";
  return "journal";
}

function ledgerName(input: AdapterInput, code: string) {
  const m = input.mappings[code];
  const nameMap = accountNameMap(input.canonical);
  return (m?.externalName?.trim() || m?.externalCode?.trim() || nameMap.get(code) || code).slice(0, 200);
}

function validate(input: AdapterInput): ValidationIssue[] {
  const issues = validateCommon(spec, input);
  for (const label of missingConfig(spec, input.config)) {
    issues.push({ level: "error", code: "MISSING_CONFIG", message: `Set “${label}” in Integrations › TallyPrime.` });
  }
  const docs = postingDocuments(input.canonical);
  issues.push(...validateBalanced(docs));
  issues.push(...validateMappings(docs, input.mappings, "TallyPrime ledger", accountNameMap(input.canonical)));
  const openings = docs.filter((d) => d.type === "opening").length;
  if (openings) {
    issues.push({ level: "warning", code: "OPENING_AS_JOURNAL", message: `${openings} opening-balance entr${openings === 1 ? "y is" : "ies are"} exported as Journal vouchers. TallyPrime normally holds opening balances on ledger masters — review before importing.` });
  }
  return issues;
}

function generate(input: AdapterInput) {
  assertValid(spec.name, validate(input));
  const c = input.canonical;
  const subtypes = accountSubtypeMap(c);
  const vchTypeName: Record<TallyVoucherKind, string> = {
    payment: configString(input.config, "paymentVoucherType", "Payment"),
    receipt: configString(input.config, "receiptVoucherType", "Receipt"),
    contra: configString(input.config, "contraVoucherType", "Contra"),
    journal: configString(input.config, "journalVoucherType", "Journal"),
    sales: configString(input.config, "salesVoucherType", "Sales"),
    purchase: configString(input.config, "purchaseVoucherType", "Purchase"),
  };
  const useRefs = configString(input.config, "voucherNumbering", "reference") === "reference";
  const company = configString(input.config, "companyName");
  const counts: Record<TallyVoucherKind, number> = { payment: 0, receipt: 0, contra: 0, journal: 0, sales: 0, purchase: 0 };

  const vouchers = postingDocuments(c).map((doc) => {
    const kind = tallyVoucherKind(doc, subtypes);
    counts[kind]++;
    const type = vchTypeName[kind];
    const entries = doc.lines
      .map((l) => {
        const debit = new Decimal(l.debit || "0");
        const isDebit = debit.gt(0);
        const amount = isDebit ? `-${fmt2(debit)}` : fmt2(new Decimal(l.credit || "0"));
        return [
          "      <ALLLEDGERENTRIES.LIST>",
          `       <LEDGERNAME>${xmlEscape(ledgerName(input, l.accountCode))}</LEDGERNAME>`,
          `       <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
          `       <AMOUNT>${amount}</AMOUNT>`,
          "      </ALLLEDGERENTRIES.LIST>",
        ].join("\n");
      })
      .join("\n");
    return [
      "   <TALLYMESSAGE>",
      `    <VOUCHER VCHTYPE="${xmlEscape(type)}" ACTION="Create">`,
      `     <DATE>${formatDay(doc.date, "YYYYMMDD")}</DATE>`,
      `     <VOUCHERTYPENAME>${xmlEscape(type)}</VOUCHERTYPENAME>`,
      ...(useRefs ? [`     <VOUCHERNUMBER>${xmlEscape(doc.ref)}</VOUCHERNUMBER>`] : []),
      `     <NARRATION>${xmlEscape(asciiPunctuation(narration(doc, 1000)))}</NARRATION>`,
      entries,
      "    </VOUCHER>",
      "   </TALLYMESSAGE>",
    ].join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    " <HEADER>",
    "  <VERSION>1</VERSION>",
    "  <TALLYREQUEST>Import</TALLYREQUEST>",
    "  <TYPE>Data</TYPE>",
    "  <ID>Vouchers</ID>",
    " </HEADER>",
    " <BODY>",
    "  <DESC>",
    "   <STATICVARIABLES>",
    `    <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>`,
    "   </STATICVARIABLES>",
    "  </DESC>",
    "  <DATA>",
    ...vouchers,
    "  </DATA>",
    " </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");

  const summary = (Object.keys(counts) as TallyVoucherKind[]).filter((k) => counts[k]).map((k) => `${counts[k]} ${vchTypeName[k]}`).join(", ");
  return {
    files: [{ fileName: `${input.fileBaseName}.xml`, contentType: spec.contentType, content: xml }],
    warnings: [`Vouchers generated: ${summary || "none"}. Import into company “${company}”.`],
  };
}

export const tallyPrimeAdapter: ExportAdapter = { ...spec, validate, generate };

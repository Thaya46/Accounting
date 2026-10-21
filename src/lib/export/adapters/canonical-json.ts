import { canonicalExportSchema, EXPORT_TYPES } from "../canonical-schema";
import type { ExportAdapter, ValidationIssue } from "../types";
import { validateCommon } from "./shared";

/** The canonical VLedger JSON itself — the format for generic JSON integrations. */
export const canonicalJsonAdapter: ExportAdapter = {
  key: "canonical-json",
  name: "VLedger Canonical JSON",
  vendor: "VLedger AI",
  product: "Generic JSON integrations",
  supportedVersions: ["Canonical schema 1.0"],
  category: "generic",
  importMechanism: "JSON file download, or consumption by any integration that reads the published canonical schema. Also re-importable through the VLedger Import module.",
  fileType: "JSON (UTF-8)",
  fileExtension: "json",
  contentType: "application/json",
  implemented: true,
  verificationNote: "This is VLedger's own schema (version 1.0). Every file is validated against the schema before download.",
  specReferences: [
    { label: "RFC 8259 — The JSON Data Interchange Format", url: "https://www.rfc-editor.org/rfc/rfc8259" },
    { label: "ISO 4217 currency codes", url: "https://www.iso.org/iso-4217-currency-codes.html" },
  ],
  requiredFields: [
    "schemaVersion",
    "exportType",
    "workspace.workspaceId / workspaceName / currency",
    "transactions[].transactionId / transactionDate / type / description / amount / currency / journalLines",
    "transactions[].audit.createdBy.userId / name, audit.createdAt, audit.source",
  ],
  accountMappingRules: "No mapping — journal lines carry VLedger account codes; the accounts[] section lists every referenced account with its name and type.",
  taxMappingRules: "Tax is represented by the posting accounts used (e.g. Input Tax Credit, Output Tax Payable). No separate tax codes.",
  currencyMapping: "transactions[].amount is in the transaction currency; journalLines and baseAmount are in the workspace base currency (workspace.currency) using exchangeRate.",
  contactMapping: "counterparty {type: customer|vendor, name} when the transaction has one.",
  referenceRules: "transactionId = TXN- reference, journalEntryId = JE- reference, user ids = USR- references, workspaceId = WS- reference. All are stable per workspace.",
  limitations: [
    "Amounts are strings with exactly two decimals to avoid floating-point loss.",
    "Drafts and pending transactions are included only when selected; their journalLines are the proposed lines and posted is false.",
  ],
  provenance: {
    createdByTransfer: "native",
    description: "Full attribution is part of the schema: created by, last modified by, approved by, posted by, reversal details, import provenance and (optionally) the complete audit event trail.",
    fullAuditTransfer: true,
  },
  configFields: [],
  requiresAccountMapping: false,
  supportedExportTypes: [...EXPORT_TYPES],
  allowsDrafts: true,
  defaultExcludeExported: false,
  apiTransfer: { status: "not_applicable", note: "File download." },

  validate(input) {
    const issues: ValidationIssue[] = validateCommon(canonicalJsonAdapter, input);
    const parsed = canonicalExportSchema.safeParse(input.canonical);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 20)) {
        issues.push({ level: "error", code: "SCHEMA", message: `Canonical schema violation at ${i.path.join(".") || "(root)"}: ${i.message}` });
      }
    }
    return issues;
  },

  generate(input) {
    return {
      files: [{ fileName: `${input.fileBaseName}.json`, contentType: "application/json", content: JSON.stringify(input.canonical, null, 2) + "\n" }],
      warnings: [],
    };
  },
};

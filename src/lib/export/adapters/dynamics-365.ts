import { plannedAdapter } from "./planned";

export const dynamics365Adapter = plannedAdapter({
  key: "dynamics-365",
  name: "Microsoft Dynamics 365",
  vendor: "Microsoft",
  product: "Dynamics 365 Business Central (API v2.0 journals/journalLines); Dynamics 365 Finance (Data management — General journal entity)",
  supportedVersions: ["Business Central API v2.0 (planned)", "Dynamics 365 Finance data entities (planned)"],
  importMechanism:
    "Business Central: POST /api/v2.0/companies({id})/journals({id})/journalLines for G/L account lines, then the bound action journals({id})/Microsoft.NAV.post. Finance: data package import of the General journal data entity through Data management.",
  fileType: "OData JSON payloads / data package (planned)",
  verificationNote:
    "Not implemented. Both mechanisms require an authorised Microsoft Entra ID app registration and environment-specific journal batches; no unverified file is offered.",
  specReferences: [
    { label: "Business Central API v2.0 — journalLine resource type", url: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_journalline" },
    { label: "Business Central API v2.0 — Create journalLines", url: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_journalline_create" },
    { label: "Business Central API v2.0 — journal resource (post action)", url: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_journal" },
    { label: "Dynamics 365 Finance — Data entities and data packages", url: "https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/data-entities-data-packages" },
  ],
  requiredFields: ["Journal (batch) id", "postingDate", "accountType = G/L Account", "accountNumber per line", "amount (positive debit / negative credit)", "documentNumber", "description"],
  accountMappingRules: "Would map each VLedger account to a Business Central G/L account number.",
  taxMappingRules: "VAT/GST posting groups would need mapping per account.",
  currencyMapping: "Local currency (LCY) amounts.",
  contactMapping: "Customer/vendor lines would need accountType customer/vendor and their numbers.",
  referenceRules: "documentNumber / externalDocumentNumber would carry the VLedger reference.",
  limitations: ["Not implemented — no payload is generated.", "Requires OAuth (Microsoft Entra ID) access to the customer's environment."],
  provenanceNote: "Planned: Created By in the line description / comment. Not available until the adapter is implemented.",
});

import { plannedAdapter } from "./planned";

export const sapAdapter = plannedAdapter({
  key: "sap",
  name: "SAP",
  vendor: "SAP SE",
  product: "SAP S/4HANA Cloud (Journal Entry – Post API); SAP Business One (Service Layer JournalEntries)",
  supportedVersions: ["SAP S/4HANA Cloud — SAP_COM_0002 (planned)", "SAP Business One Service Layer (planned)"],
  importMechanism:
    "S/4HANA Cloud: SOAP service JournalEntryCreateRequestConfirmation_In (synchronous) or JournalEntryBulkCreationRequest_In (asynchronous) via communication scenario SAP_COM_0002. Business One: POST /b1s/v1/JournalEntries on the Service Layer.",
  fileType: "SOAP/XML or JSON API payloads (planned)",
  verificationNote:
    "Not implemented. Both SAP mechanisms are authenticated APIs that need a configured communication arrangement / Service Layer session, company code, G/L accounts and tax codes; no unverified file is offered.",
  specReferences: [
    { label: "SAP Business Accelerator Hub — Journal Entry – Post (Synchronous)", url: "https://api.sap.com/api/JOURNALENTRYCREATEREQUESTCONFI/overview" },
    { label: "SAP Community — Guidelines for API Journal Entry Post", url: "https://blogs.sap.com/2019/09/06/guidelines-for-api-journal-entry-post/" },
    { label: "SAP Help — SAP Business One Service Layer", url: "https://help.sap.com/docs/SAP_BUSINESS_ONE_VERSION_FOR_SAP_HANA" },
  ],
  requiredFields: ["Company code", "Document date / posting date", "G/L account per item", "Amount in transaction currency with debit/credit code", "Document type", "Tax code where applicable"],
  accountMappingRules: "Would map each VLedger account to an SAP G/L account within the company code.",
  taxMappingRules: "SAP validates tax code ↔ G/L account combinations; a tax-code mapping per account would be required.",
  currencyMapping: "Transaction currency plus company-code currency amounts.",
  contactMapping: "Customer/supplier line items would require business partner ids.",
  referenceRules: "VLedger reference would go into the document header text / reference document number (no duplicate check in the SAP API — VLedger's export history would prevent re-posting).",
  limitations: ["Not implemented — no payload is generated.", "Requires an SAP communication arrangement (OAuth / certificate) that VLedger does not hold."],
  provenanceNote: "Planned: Created By in the document header text. Not available until the adapter is implemented.",
});

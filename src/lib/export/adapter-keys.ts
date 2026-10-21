/** Stable keys for accounting software adapters (implementations live in ./adapters). */
export const ADAPTER_CATALOG = [
  { key: "canonical-json", name: "VLedger Canonical JSON (Generic JSON)" },
  { key: "generic-csv", name: "Generic CSV (journal lines)" },
  { key: "tallyprime", name: "TallyPrime" },
  { key: "zoho-books", name: "Zoho Books" },
  { key: "quickbooks-online", name: "QuickBooks Online" },
  { key: "xero", name: "Xero" },
  { key: "busy", name: "BUSY Accounting" },
  { key: "sap", name: "SAP" },
  { key: "dynamics-365", name: "Microsoft Dynamics 365" },
  { key: "custom", name: "Custom accounting software" },
] as const;

export type AdapterKey = (typeof ADAPTER_CATALOG)[number]["key"];

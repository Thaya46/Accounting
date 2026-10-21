import { plannedAdapter } from "./planned";

export const busyAdapter = plannedAdapter({
  key: "busy",
  name: "BUSY Accounting",
  vendor: "BUSY Infotech",
  product: "BUSY Accounting Software (Standard / Saffron / Blue editions)",
  supportedVersions: ["BUSY 21 (planned)"],
  importMechanism:
    "Administration › Data Export/Import › Import Vouchers from Excel, using a user-configured column format per voucher type (Payment, Receipt, Contra, Journal). Masters (ledgers) must be imported before vouchers.",
  fileType: "Excel workbook with a workspace-defined column format (planned)",
  verificationNote:
    "Not implemented. BUSY's voucher import uses a format the user configures inside BUSY; there is no published fixed file specification to generate against, so VLedger does not offer a BUSY file yet.",
  specReferences: [
    { label: "BUSY FAQ — Import data from another accounting system or Excel", url: "https://busy.in/faqs/how-do-i-import-data-from-another-accounting-system-or-excel-answerid-55982" },
    { label: "BUSY FAQ — Guidelines for importing masters and vouchers", url: "https://busy.in/faqs/what-guidelines-importing-data-using-import-master-or-voucher-busy-accounting-software-answerid-36490/" },
    { label: "BUSY FAQs — Voucher import/export", url: "https://busy.in/faqs/data-conversion/voucher-import-export/2" },
  ],
  requiredFields: ["Voucher date", "Voucher series / type", "Ledger (account) name per line", "Debit/Credit amount", "Narration"],
  accountMappingRules: "Would map each VLedger account to an existing BUSY ledger (account master) name.",
  taxMappingRules: "GST would require BUSY tax categories per ledger; not designed yet.",
  currencyMapping: "Base currency only.",
  contactMapping: "Party ledgers must exist in BUSY before import.",
  referenceRules: "VLedger references would go into the voucher number or narration.",
  limitations: ["Not implemented — no file is generated.", "Use the generic CSV or custom layout and BUSY's Excel import format configuration in the meantime."],
  provenanceNote: "Planned: Created By in narration. Not available until the adapter is implemented.",
});

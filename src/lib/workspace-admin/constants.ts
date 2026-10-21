/**
 * Workspace administration constants shared by the server (validation) and
 * client components (display). Must stay free of server-only imports.
 */
import type { PermissionKey } from "@/lib/permissions";

export const PERMISSION_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  {
    title: "Transactions",
    keys: ["TRANSACTION_CREATE", "TRANSACTION_VIEW", "TRANSACTION_EDIT_DRAFT", "TRANSACTION_POST", "TRANSACTION_REVERSE", "TRANSACTION_APPROVE"],
  },
  { title: "Reports & data", keys: ["REPORTS_VIEW", "DATA_EXPORT", "DATA_IMPORT"] },
  { title: "Administration", keys: ["ACCOUNTS_MANAGE", "USERS_MANAGE", "AUDIT_VIEW", "SETTINGS_MANAGE"] },
];

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountTypeKey = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_INFO: Record<AccountTypeKey, { label: string; plural: string; description: string }> = {
  ASSET: { label: "Asset", plural: "Assets", description: "What the business owns: bank, cash, receivables, equipment." },
  LIABILITY: { label: "Liability", plural: "Liabilities", description: "What the business owes: payables, credit cards, taxes, loans." },
  EQUITY: { label: "Equity", plural: "Equity", description: "Owner's capital, opening balances and retained earnings." },
  INCOME: { label: "Income", plural: "Income", description: "Revenue earned from services, sales and other sources." },
  EXPENSE: { label: "Expense", plural: "Expenses", description: "Costs of running the business." },
};

/** Subtypes allowed per account type. Reports and the AI parser rely on these values. */
export const SUBTYPES_BY_TYPE: Record<AccountTypeKey, string[]> = {
  ASSET: ["BANK", "CASH", "WALLET", "RECEIVABLE", "TAX", "CURRENT_ASSET", "FIXED_ASSET", "OTHER_ASSET"],
  LIABILITY: ["PAYABLE", "CREDIT_CARD", "TAX", "LOAN", "CURRENT_LIABILITY", "OTHER_LIABILITY"],
  EQUITY: ["CAPITAL", "DRAWINGS", "OPENING_EQUITY", "RETAINED_EARNINGS"],
  INCOME: ["OPERATING_INCOME", "OTHER_INCOME"],
  EXPENSE: ["OPERATING_EXPENSE", "COST_OF_SALES", "OTHER_EXPENSE"],
};

export const SUBTYPE_LABELS: Record<string, string> = {
  BANK: "Bank",
  CASH: "Cash",
  WALLET: "Wallet",
  RECEIVABLE: "Receivable",
  TAX: "Tax",
  CURRENT_ASSET: "Current asset",
  FIXED_ASSET: "Fixed asset",
  OTHER_ASSET: "Other asset",
  PAYABLE: "Payable",
  CREDIT_CARD: "Credit card",
  LOAN: "Loan",
  CURRENT_LIABILITY: "Current liability",
  OTHER_LIABILITY: "Other liability",
  CAPITAL: "Capital",
  DRAWINGS: "Drawings",
  OPENING_EQUITY: "Opening equity",
  RETAINED_EARNINGS: "Retained earnings",
  OPERATING_INCOME: "Operating income",
  OTHER_INCOME: "Other income",
  OPERATING_EXPENSE: "Operating expense",
  COST_OF_SALES: "Cost of sales",
  OTHER_EXPENSE: "Other expense",
};

export function subtypeLabel(subtype: string | null | undefined) {
  if (!subtype) return null;
  return SUBTYPE_LABELS[subtype] ?? subtype.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** One per workspace, created by provisioning; users cannot assign them. */
export const SYSTEM_ONLY_SUBTYPES = ["OPENING_EQUITY", "RETAINED_EARNINGS"];
/** Subtypes that carry bank name / last-4 details. */
export const BANK_DETAIL_SUBTYPES = ["BANK", "CREDIT_CARD"];
/** Bank & cash style accounts shown in the summary strip. */
export const MONEY_ACCOUNT_SUBTYPES = ["BANK", "CASH", "WALLET", "CREDIT_CARD"];

export const ACCOUNT_CODE_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** Opening balances apply to balance-sheet accounts except the balancing equity account. */
export function supportsOpeningBalance(type: string, subtype: string | null) {
  return (type === "ASSET" || type === "LIABILITY" || type === "EQUITY") && subtype !== "OPENING_EQUITY";
}

export const CONTACT_KINDS = ["customer", "vendor"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const AUDIT_PAGE_SIZE = 50;

/** Action filter options always offered, even before the first event of that kind exists. */
export const KNOWN_AUDIT_ACTIONS = [
  "CREATED",
  "UPDATED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "POSTED",
  "REVERSED",
  "EXPORTED",
  "IMPORTED",
  "USER_INVITED",
  "WORKSPACE_ADMIN_INVITED",
  "INVITATION_ACCEPTED",
  "INVITATION_RESENT",
  "INVITATION_REVOKED",
  "MEMBER_UPDATED",
  "MEMBER_ROLE_CHANGED",
  "MEMBER_DISABLED",
  "MEMBER_REACTIVATED",
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_DELETED",
  "ACCOUNT_CREATED",
  "ACCOUNT_UPDATED",
  "ACCOUNT_DEACTIVATED",
  "ACCOUNT_REACTIVATED",
  "OPENING_BALANCE_SET",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "CUSTOMER_CREATED",
  "CUSTOMER_UPDATED",
  "VENDOR_CREATED",
  "VENDOR_UPDATED",
  "WORKSPACE_SETTINGS_UPDATED",
  "SUMMARY_EMAIL_SENT",
];

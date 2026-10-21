import type { AccountType, CategoryKind } from "@prisma/client";

export type AccountTemplate = {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  isSystem?: boolean;
  description?: string;
};

/** Account subtypes that can be used as the paying / receiving side of a transaction. */
export const PAYMENT_SUBTYPES = ["BANK", "CASH", "CREDIT_CARD", "RECEIVABLE", "PAYABLE", "WALLET"] as const;
export const CASH_SUBTYPES = ["BANK", "CASH", "WALLET"] as const;

/** Default chart of accounts created for every new workspace. */
export const DEFAULT_ACCOUNTS: AccountTemplate[] = [
  // Assets
  { code: "CASH", name: "Cash in Hand", type: "ASSET", subtype: "CASH" },
  { code: "BANK-PRIMARY", name: "Primary Bank Account", type: "ASSET", subtype: "BANK" },
  { code: "WALLET-UPI", name: "UPI / Digital Wallet", type: "ASSET", subtype: "WALLET" },
  { code: "AR", name: "Accounts Receivable", type: "ASSET", subtype: "RECEIVABLE" },
  { code: "TAX-INPUT", name: "Input Tax Credit", type: "ASSET", subtype: "TAX" },
  { code: "PREPAID", name: "Prepaid Expenses", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "FA-EQUIP", name: "Office Equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  // Liabilities
  { code: "AP", name: "Accounts Payable", type: "LIABILITY", subtype: "PAYABLE" },
  { code: "CREDIT-CARD", name: "Company Credit Card", type: "LIABILITY", subtype: "CREDIT_CARD" },
  { code: "TAX-OUTPUT", name: "Output Tax Payable", type: "LIABILITY", subtype: "TAX" },
  { code: "TDS-PAYABLE", name: "TDS Payable", type: "LIABILITY", subtype: "TAX" },
  { code: "LOAN", name: "Loans Payable", type: "LIABILITY", subtype: "LOAN" },
  // Equity
  { code: "CAPITAL", name: "Owner's Capital", type: "EQUITY", subtype: "CAPITAL" },
  { code: "OPENING-EQUITY", name: "Opening Balance Equity", type: "EQUITY", subtype: "OPENING_EQUITY", isSystem: true },
  { code: "RETAINED", name: "Retained Earnings", type: "EQUITY", subtype: "RETAINED_EARNINGS", isSystem: true },
  // Income
  { code: "INC-SERVICE", name: "Service Revenue", type: "INCOME" },
  { code: "INC-SALES", name: "Sales Revenue", type: "INCOME" },
  { code: "INC-INTEREST", name: "Interest Income", type: "INCOME" },
  { code: "INC-OTHER", name: "Other Income", type: "INCOME" },
  // Expenses
  { code: "EXP-RENT", name: "Office Rent", type: "EXPENSE" },
  { code: "EXP-ELEC", name: "Office Electricity Expense", type: "EXPENSE" },
  { code: "EXP-SALARY", name: "Salaries & Wages", type: "EXPENSE" },
  { code: "EXP-FUEL", name: "Fuel Expense", type: "EXPENSE" },
  { code: "EXP-TRAVEL", name: "Travel Expense", type: "EXPENSE" },
  { code: "EXP-OFFICE", name: "Office Supplies", type: "EXPENSE" },
  { code: "EXP-INTERNET", name: "Internet & Telephone", type: "EXPENSE" },
  { code: "EXP-SOFTWARE", name: "Software Subscriptions", type: "EXPENSE" },
  { code: "EXP-MEALS", name: "Meals & Entertainment", type: "EXPENSE" },
  { code: "EXP-MARKETING", name: "Marketing & Advertising", type: "EXPENSE" },
  { code: "EXP-PROF", name: "Professional Fees", type: "EXPENSE" },
  { code: "EXP-REPAIRS", name: "Repairs & Maintenance", type: "EXPENSE" },
  { code: "EXP-BANK", name: "Bank Charges", type: "EXPENSE" },
  { code: "EXP-INSURANCE", name: "Insurance Expense", type: "EXPENSE" },
  { code: "EXP-TAXES", name: "Taxes & Licenses", type: "EXPENSE" },
  { code: "EXP-MISC", name: "Miscellaneous Expense", type: "EXPENSE" },
];

export type CategoryTemplate = { name: string; kind: CategoryKind; accountCode: string; keywords: string[] };

export const DEFAULT_CATEGORIES: CategoryTemplate[] = [
  { name: "Rent Expense", kind: "EXPENSE", accountCode: "EXP-RENT", keywords: ["rent", "lease", "office rent", "rental"] },
  { name: "Electricity Expense", kind: "EXPENSE", accountCode: "EXP-ELEC", keywords: ["electricity", "electric", "power bill", "eb bill", "current bill", "energy"] },
  { name: "Salaries", kind: "EXPENSE", accountCode: "EXP-SALARY", keywords: ["salary", "salaries", "wages", "payroll", "stipend", "bonus"] },
  { name: "Fuel", kind: "EXPENSE", accountCode: "EXP-FUEL", keywords: ["petrol", "diesel", "fuel", "gas station", "cng"] },
  { name: "Travel", kind: "EXPENSE", accountCode: "EXP-TRAVEL", keywords: ["travel", "taxi", "uber", "ola", "cab", "flight", "train", "bus", "hotel", "toll", "parking"] },
  { name: "Office Supplies", kind: "EXPENSE", accountCode: "EXP-OFFICE", keywords: ["stationery", "supplies", "printer", "paper", "pens", "toner", "office supplies"] },
  { name: "Internet & Phone", kind: "EXPENSE", accountCode: "EXP-INTERNET", keywords: ["internet", "broadband", "wifi", "wi-fi", "phone bill", "mobile recharge", "telephone", "recharge"] },
  { name: "Software", kind: "EXPENSE", accountCode: "EXP-SOFTWARE", keywords: ["software", "subscription", "saas", "aws", "hosting", "domain", "cloud", "license fee"] },
  { name: "Meals & Entertainment", kind: "EXPENSE", accountCode: "EXP-MEALS", keywords: ["lunch", "dinner", "breakfast", "food", "meal", "snacks", "tea", "coffee", "restaurant", "team outing"] },
  { name: "Marketing", kind: "EXPENSE", accountCode: "EXP-MARKETING", keywords: ["ads", "advertising", "marketing", "promotion", "campaign", "google ads", "facebook ads", "banner"] },
  { name: "Professional Fees", kind: "EXPENSE", accountCode: "EXP-PROF", keywords: ["consultant", "consultancy fee", "legal", "lawyer", "audit fee", "ca fee", "accountant fee", "professional fee"] },
  { name: "Repairs & Maintenance", kind: "EXPENSE", accountCode: "EXP-REPAIRS", keywords: ["repair", "repairs", "maintenance", "servicing", "plumber", "electrician"] },
  { name: "Bank Charges", kind: "EXPENSE", accountCode: "EXP-BANK", keywords: ["bank charges", "bank charge", "bank fee", "transaction fee", "processing fee"] },
  { name: "Insurance", kind: "EXPENSE", accountCode: "EXP-INSURANCE", keywords: ["insurance", "premium", "policy"] },
  { name: "Taxes & Licenses", kind: "EXPENSE", accountCode: "EXP-TAXES", keywords: ["license", "licence", "permit", "registration fee", "property tax", "professional tax"] },
  { name: "Miscellaneous Expense", kind: "EXPENSE", accountCode: "EXP-MISC", keywords: ["misc", "miscellaneous", "sundry"] },
  { name: "Service Revenue", kind: "INCOME", accountCode: "INC-SERVICE", keywords: ["service", "services", "consulting", "development", "website", "design", "project", "retainer", "professional services", "maintenance contract"] },
  { name: "Sales Revenue", kind: "INCOME", accountCode: "INC-SALES", keywords: ["sale", "sales", "sold", "product", "goods", "order"] },
  { name: "Interest Income", kind: "INCOME", accountCode: "INC-INTEREST", keywords: ["interest", "fd interest", "savings interest"] },
  { name: "Other Income", kind: "INCOME", accountCode: "INC-OTHER", keywords: ["refund", "reimbursement", "commission", "other income", "misc income"] },
];

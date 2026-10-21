import { dec } from "@/lib/money";
import { PAYMENT_SUBTYPE_KEYS, type AccountOption, type FormOptions } from "@/lib/transactions/types";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;

/** "15,000" → "15000"; keeps whatever the user typed otherwise so validation can flag it. */
export function normalizeAmount(v: string) {
  return v.replace(/[,\s₹$€£]/g, "").trim();
}

export function isValidAmount(v: string) {
  const n = normalizeAmount(v);
  return AMOUNT_RE.test(n) && dec(n).gt(0);
}

export function isValidRate(v: string) {
  const n = v.trim();
  return RATE_RE.test(n) && dec(n).gt(0);
}

/** Mirrors the server rule: workspace requires approval, or the amount reaches the threshold. */
export function approvalRequired(settings: FormOptions["settings"], amount: string) {
  if (settings.requireApproval) return true;
  if (settings.approvalThreshold && isValidAmount(amount)) return dec(normalizeAmount(amount)).gte(dec(settings.approvalThreshold));
  return false;
}

export function isPaymentAccount(a: AccountOption) {
  return (PAYMENT_SUBTYPE_KEYS as readonly string[]).includes(a.subtype ?? "");
}

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const TYPE_GROUP: Record<string, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

/** Groups accounts by ledger type for <optgroup>s. */
export function groupByType(accounts: AccountOption[]) {
  return TYPE_ORDER.map((t) => ({ label: TYPE_GROUP[t], items: accounts.filter((a) => a.type === t) })).filter((g) => g.items.length);
}

const SUBTYPE_ORDER = ["BANK", "CASH", "WALLET", "CREDIT_CARD", "RECEIVABLE", "PAYABLE"];
const SUBTYPE_GROUP: Record<string, string> = {
  BANK: "Bank accounts",
  CASH: "Cash",
  WALLET: "Wallets / UPI",
  CREDIT_CARD: "Credit cards",
  RECEIVABLE: "Receivables (on credit)",
  PAYABLE: "Payables (on credit)",
};

/** Payment-side accounts grouped by subtype. */
export function groupPaymentAccounts(accounts: AccountOption[], exclude: string[] = []) {
  return SUBTYPE_ORDER.map((s) => ({ label: SUBTYPE_GROUP[s], items: accounts.filter((a) => a.subtype === s && !exclude.includes(a.subtype ?? "")) })).filter((g) => g.items.length);
}

/** Example sentences built from the workspace's own accounts, for the helper chips. */
export function exampleSentences(options: FormOptions, fmt: (n: number) => string) {
  const pay = options.accounts.filter(isPaymentAccount);
  const bank = pay.find((a) => a.subtype === "BANK")?.name ?? pay[0]?.name ?? "the bank";
  const otherBank = pay.find((a) => a.subtype === "BANK" && a.name !== bank)?.name;
  const cash = pay.find((a) => a.subtype === "CASH")?.name ?? "cash";
  const customer = options.customers[0] ?? "ABC Technologies";
  return {
    EXPENSE: `Today I spent ${fmt(2500)} for office electricity through ${bank}`,
    INCOME: `Received ${fmt(75000)} from ${customer} for website development into ${bank}`,
    TRANSFER: `Transferred ${fmt(10000)} from ${bank} to ${otherBank ?? cash}`,
  };
}

/** Display helpers for dashboards (pure; safe on server and client). */
import { titleCaseEnum } from "@/lib/utils";

/** "Good morning" etc. for the current hour in the workspace time zone. */
export function greetingFor(timeZone: string, now = new Date()) {
  let hour = now.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  } catch {
    // fall back to UTC
  }
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or a date for older items. */
export function relativeTime(iso: string, now = new Date()) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return null;
}

const ACTION_VERBS: Record<string, string> = {
  CREATED: "created",
  UPDATED: "edited",
  SUBMITTED: "submitted for approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  POSTED: "posted",
  REVERSED: "reversed",
  EXPORTED: "exported",
  IMPORTED: "imported",
  RECONCILIATION_COMPLETED: "completed a reconciliation",
  OPENING_BALANCE_SET: "set an opening balance",
};

export function actionVerb(action: string) {
  return ACTION_VERBS[action] ?? titleCaseEnum(action).toLowerCase();
}

export function formatPct(value: number) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : 1;
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${abs.toFixed(digits)}%`;
}

export const SUBTYPE_LABEL: Record<string, string> = {
  BANK: "Bank",
  CASH: "Cash",
  WALLET: "Wallet",
  CREDIT_CARD: "Credit card",
  RECEIVABLE: "Receivable",
  PAYABLE: "Payable",
  TAX: "Tax",
  CURRENT_ASSET: "Current asset",
  FIXED_ASSET: "Fixed asset",
  LOAN: "Loan",
  CAPITAL: "Capital",
  OPENING_EQUITY: "Opening balance equity",
  RETAINED_EARNINGS: "Retained earnings",
};

export function subtypeLabel(subtype: string | null | undefined) {
  if (!subtype) return null;
  return SUBTYPE_LABEL[subtype] ?? titleCaseEnum(subtype);
}

/** Client-safe constants and helpers for the Super Admin console. */
import { MONTH_NAMES, financialYearFor, financialYearRange, formatDate, todayInTimeZone } from "@/lib/dates";

export const WORKSPACE_CODE_RE = /^[A-Z0-9]{2,10}$/;

export const WORKSPACE_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type WorkspaceStatusValue = (typeof WORKSPACE_STATUSES)[number];

/** Common IANA time zones offered in selects (any valid IANA zone is accepted by the API). */
export const TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Istanbul",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Cairo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
] as const;

export const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Singapore",
  "Australia",
  "Canada",
  "Germany",
  "France",
  "Netherlands",
  "Ireland",
  "Japan",
  "South Africa",
  "Saudi Arabia",
  "Qatar",
  "Malaysia",
  "Indonesia",
  "Sri Lanka",
  "Nepal",
  "Bangladesh",
  "New Zealand",
] as const;

/** Financial year options keyed by start month, e.g. 4 → "April – March". */
export const FY_MONTH_OPTIONS = MONTH_NAMES.map((name, i) => {
  const end = MONTH_NAMES[(i + 11) % 12]!;
  return { value: i + 1, label: i === 0 ? "January – December" : `${name} – ${end}` };
});

export function fyMonthLabel(month: number) {
  return FY_MONTH_OPTIONS[month - 1]?.label ?? `Month ${month}`;
}

/** "FY 2026-27 (01 Apr 2026 – 31 Mar 2027)" — the financial year containing today in `timeZone`. */
export function currentFyPreview(fyStartMonth: number, timeZone: string) {
  let fy: ReturnType<typeof financialYearRange>;
  try {
    fy = financialYearFor(todayInTimeZone(timeZone), fyStartMonth);
  } catch {
    fy = financialYearRange(new Date().getUTCFullYear(), fyStartMonth);
  }
  return { ...fy, display: `${fy.label} (${formatDate(fy.from)} – ${formatDate(fy.to)})` };
}

export function isValidTimeZone(tz: string) {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Suggests a workspace code from a name: "Acme Traders Pvt" → "ATP" / "ACMETRADER". */
export function suggestWorkspaceCode(name: string) {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0]!.slice(0, 10);
  const initials = words.map((w) => w[0]).join("");
  return (initials.length >= 3 ? initials : words.join("")).slice(0, 10);
}

/** Audit entity types whose before/after payloads are safe to show to a Super Admin. */
export const NON_FINANCIAL_ENTITY_TYPES = new Set([
  "WORKSPACE",
  "INVITATION",
  "USER",
  "SESSION",
  "MEMBERSHIP",
  "ROLE",
  "PLATFORM_SETTINGS",
  "INTEGRATION",
  "INTEGRATION_ADAPTER",
  "EMAIL",
  "NOTIFICATION",
]);

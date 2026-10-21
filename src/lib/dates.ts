/** Date helpers. Accounting dates are calendar dates stored as UTC midnight. */

export function parseISODate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isoDate(d) !== s) throw new Error(`Invalid date: ${s}`);
  return d;
}

export function isoDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA time zone, as YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return isoDate(now);
  }
}

export function addDays(isoDay: string, days: number): string {
  const d = parseISODate(isoDay);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "15 Oct 2026" */
export function formatDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return `${String(x.getUTCDate()).padStart(2, "0")} ${MONTH_SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

/** Date + time in `timeZone` (defaults to the runtime's local zone; pass the workspace zone where it matters). */
export function formatDateTime(d: Date | string, timeZone?: string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(x);
  } catch {
    return x.toISOString();
  }
}

export function financialYearRange(startYear: number, fyStartMonth: number) {
  const from = new Date(Date.UTC(startYear, fyStartMonth - 1, 1));
  const to = new Date(Date.UTC(startYear + 1, fyStartMonth - 1, 0));
  const label =
    fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { from: isoDate(from), to: isoDate(to), label, startYear };
}

/** Financial year containing `isoDay` for a given start month (1–12). */
export function financialYearFor(isoDay: string, fyStartMonth: number) {
  const d = parseISODate(isoDay);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return financialYearRange(m >= fyStartMonth ? y : y - 1, fyStartMonth);
}

export function startOfMonth(isoDay: string): string {
  return `${isoDay.slice(0, 7)}-01`;
}

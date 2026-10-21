/**
 * Reporting periods driven by URL search params. Pure functions (no I/O) so
 * they can be shared by pages, API routes and client components.
 */
import { addDays, financialYearFor, financialYearRange, formatDate, isoDate, MONTH_NAMES, parseISODate, startOfMonth } from "@/lib/dates";

export type PeriodPreset = "fy" | "prev-fy" | "this-month" | "last-month" | "custom";

export type Period = { preset: PeriodPreset; from: string; to: string; label: string };

export type AsOfPreset = "today" | "last-month-end" | "prev-fy-end" | "custom";

export type AsOf = { preset: AsOfPreset; asOf: string; label: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the value when it is a real calendar date (YYYY-MM-DD), otherwise null. */
export function safeIsoDate(value: string | string[] | null | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !ISO_DAY.test(v)) return null;
  try {
    parseISODate(v);
    return v;
  } catch {
    return null;
  }
}

export function endOfMonth(isoDay: string): string {
  const d = parseISODate(isoDay);
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Same calendar day one year earlier (29 Feb maps to 28 Feb). */
export function sameDayLastYear(isoDay: string): string {
  const d = parseISODate(isoDay);
  const y = d.getUTCFullYear() - 1;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

export function minIso(a: string, b: string) {
  return a <= b ? a : b;
}

export function rangeLabel(from: string, to: string) {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

function monthLabel(isoDay: string) {
  const d = parseISODate(isoDay);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function periodPresets(today: string, fyStartMonth: number) {
  const fy = financialYearFor(today, fyStartMonth);
  const prev = financialYearRange(fy.startYear - 1, fyStartMonth);
  const thisMonthFrom = startOfMonth(today);
  const lastMonthTo = addDays(thisMonthFrom, -1);
  const lastMonthFrom = startOfMonth(lastMonthTo);
  return {
    fy: { preset: "fy", from: fy.from, to: fy.to, label: `${fy.label} (current)` },
    "prev-fy": { preset: "prev-fy", from: prev.from, to: prev.to, label: prev.label },
    "this-month": { preset: "this-month", from: thisMonthFrom, to: endOfMonth(today), label: monthLabel(today) },
    "last-month": { preset: "last-month", from: lastMonthFrom, to: lastMonthTo, label: monthLabel(lastMonthFrom) },
  } satisfies Record<Exclude<PeriodPreset, "custom">, Period>;
}

/**
 * Resolves `?period=fy|prev-fy|this-month|last-month|custom&from=&to=`.
 * Explicit from/to without a preset are treated as a custom range. Invalid input
 * falls back to the current financial year.
 */
export function resolvePeriod(
  params: { period?: string | null; from?: string | null; to?: string | null },
  today: string,
  fyStartMonth: number,
): Period {
  const presets = periodPresets(today, fyStartMonth);
  const preset = params.period ?? "";
  if (preset in presets) return presets[preset as keyof typeof presets];
  let from = safeIsoDate(params.from);
  let to = safeIsoDate(params.to);
  if (from || to) {
    from ??= presets.fy.from;
    to ??= today;
    if (from > to) [from, to] = [to, from];
    return { preset: "custom", from, to, label: rangeLabel(from, to) };
  }
  return presets.fy;
}

export function asOfPresets(today: string, fyStartMonth: number) {
  const fy = financialYearFor(today, fyStartMonth);
  const prev = financialYearRange(fy.startYear - 1, fyStartMonth);
  const lastMonthEnd = addDays(startOfMonth(today), -1);
  return {
    today: { preset: "today", asOf: today, label: `Today (${formatDate(today)})` },
    "last-month-end": { preset: "last-month-end", asOf: lastMonthEnd, label: `End of ${monthLabel(lastMonthEnd)}` },
    "prev-fy-end": { preset: "prev-fy-end", asOf: prev.to, label: `End of ${prev.label}` },
  } satisfies Record<Exclude<AsOfPreset, "custom">, AsOf>;
}

/** Resolves `?asOf=YYYY-MM-DD` (defaults to today) and labels it with a matching preset. */
export function resolveAsOf(params: { asOf?: string | null }, today: string, fyStartMonth: number): AsOf {
  const presets = asOfPresets(today, fyStartMonth);
  const asOf = safeIsoDate(params.asOf) ?? today;
  const match = Object.values(presets).find((p) => p.asOf === asOf);
  return match ?? { preset: "custom", asOf, label: formatDate(asOf) };
}

/** Percentage change, or null when the base is zero (not computable). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

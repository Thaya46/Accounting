/**
 * Transaction list filters. Client-safe: used by the server page/API to parse
 * URL search params and by the filter bar to build shareable URLs.
 */
import { addDays, financialYearFor, parseISODate, startOfMonth } from "@/lib/dates";
import {
  ENTRY_SOURCES,
  RANGE_OPTIONS,
  SORT_OPTIONS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type EntrySourceKey,
  type RangeKey,
  type SortKey,
  type TransactionStatusKey,
  type TransactionTypeKey,
} from "./types";

export type TransactionFilters = {
  by?: string;
  range?: RangeKey;
  from?: string;
  to?: string;
  category?: string;
  min?: string;
  max?: string;
  type?: TransactionTypeKey;
  source?: EntrySourceKey;
  status?: TransactionStatusKey;
  q?: string;
  sort?: SortKey;
  page?: number;
};

export const FILTER_KEYS = ["by", "range", "from", "to", "category", "min", "max", "type", "source", "status", "q", "sort", "page"] as const;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const AMOUNT_RE = /^\d{1,15}(\.\d{1,2})?$/;

function isDate(v: string) {
  try {
    parseISODate(v);
    return true;
  } catch {
    return false;
  }
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Lenient parser: invalid values are dropped rather than failing the request,
 * so a hand-edited or stale URL still renders a sensible list.
 */
export function parseFilters(input: Record<string, string | string[] | undefined>): TransactionFilters {
  const get = (k: string) => {
    const v = input[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" ? s.trim() : undefined;
  };
  const f: TransactionFilters = {};
  const by = get("by");
  if (by && ID_RE.test(by)) f.by = by;
  f.range = pick(get("range"), RANGE_OPTIONS);
  const from = get("from");
  const to = get("to");
  if (from && isDate(from)) f.from = from;
  if (to && isDate(to)) f.to = to;
  const category = get("category");
  if (category && ID_RE.test(category)) f.category = category;
  const min = get("min")?.replace(/,/g, "");
  const max = get("max")?.replace(/,/g, "");
  if (min && AMOUNT_RE.test(min)) f.min = min;
  if (max && AMOUNT_RE.test(max)) f.max = max;
  f.type = pick(get("type"), TRANSACTION_TYPES);
  f.source = pick(get("source"), ENTRY_SOURCES);
  f.status = pick(get("status"), TRANSACTION_STATUSES);
  const q = get("q");
  if (q) f.q = q.slice(0, 120);
  f.sort = pick(get("sort"), SORT_OPTIONS);
  const page = Number(get("page"));
  if (Number.isInteger(page) && page > 1 && page <= 100000) f.page = page;
  for (const k of Object.keys(f) as (keyof TransactionFilters)[]) if (f[k] === undefined) delete f[k];
  return f;
}

function endOfMonth(isoDay: string) {
  const first = startOfMonth(isoDay);
  const [y, m] = first.split("-").map(Number);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(nextFirst, -1);
}

/** Resolves a named range (this month, last month, this FY) or a custom from/to into dates. */
export function resolveDateRange(f: Pick<TransactionFilters, "range" | "from" | "to">, today: string, fyStartMonth: number): { from?: string; to?: string } {
  switch (f.range) {
    case "this-month":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last-month": {
      const prev = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "this-fy": {
      const fy = financialYearFor(today, fyStartMonth);
      return { from: fy.from, to: fy.to };
    }
    default:
      return { from: f.from, to: f.to };
  }
}

/** Builds a query string from filters (omitting empty values). */
export function filtersToQuery(f: TransactionFilters, overrides: Partial<Record<keyof TransactionFilters, string | number | undefined>> = {}) {
  const sp = new URLSearchParams();
  const merged: Record<string, string | number | undefined> = { ...(f as Record<string, string | number | undefined>), ...overrides };
  for (const k of FILTER_KEYS) {
    const v = merged[k];
    if (v === undefined || v === "" || (k === "page" && Number(v) <= 1)) continue;
    if (k === "range" && v !== "custom") {
      sp.set(k, String(v));
      continue;
    }
    if ((k === "from" || k === "to") && merged.range && merged.range !== "custom") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Number of user-facing filters that are active (ignores sort and page). */
export function activeFilterCount(f: TransactionFilters) {
  let n = 0;
  if (f.by) n++;
  if (f.range || f.from || f.to) n++;
  if (f.category) n++;
  if (f.min || f.max) n++;
  if (f.type) n++;
  if (f.source) n++;
  if (f.status) n++;
  if (f.q) n++;
  return n;
}

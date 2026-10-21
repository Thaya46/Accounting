import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type DecimalLike = Decimal | string | number | { toString(): string };

/** Converts any Prisma Decimal / string / number into a decimal.js value. */
export function dec(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "object" ? value.toString() : value);
}

/** Canonical 2-dp string, e.g. "2500.00". */
export function money2(value: DecimalLike | null | undefined): string {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function sumDec(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

const LOCALE_BY_CURRENCY: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  SGD: "en-SG",
  AUD: "en-AU",
  CAD: "en-CA",
};

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "ZAR"] as const;

/** Display formatting (₹15,000 / $1,500.50). Safe on server and client. */
export function formatMoney(
  value: DecimalLike | null | undefined,
  currency = "INR",
  opts: { decimals?: boolean } = {},
): string {
  const n = Number(money2(value));
  const showDecimals = opts.decimals ?? !Number.isInteger(n);
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatCompact(value: DecimalLike, currency = "INR"): string {
  const n = Number(money2(value));
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? "en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/** Parses user input like "15,000" or "₹2,500.50" into a 2-dp string, or null. */
export function parseAmountInput(input: string): string | null {
  const cleaned = input.replace(/[^\d.\-]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return money2(cleaned);
}

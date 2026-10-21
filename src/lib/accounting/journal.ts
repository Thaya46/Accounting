import type { AccountType } from "@prisma/client";
import { Decimal, dec, money2, type DecimalLike } from "@/lib/money";

export type JournalLineInput = {
  accountId: string;
  debit: string;
  credit: string;
  description?: string | null;
};

export type JournalValidation =
  | { ok: true; totalDebit: string; totalCredit: string }
  | { ok: false; errors: string[]; totalDebit: string; totalCredit: string };

const TWO_DP = /^\d+(\.\d{1,2})?$/;

/**
 * Validates a set of journal lines before posting. Debits must equal credits,
 * every line must carry exactly one positive side, and amounts are fixed 2-dp.
 */
export function validateJournalLines(lines: JournalLineInput[]): JournalValidation {
  const errors: string[] = [];
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  if (lines.length < 2) errors.push("A journal entry needs at least two lines.");

  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.accountId) errors.push(`Line ${n}: choose an account.`);
    const d = String(line.debit ?? "0").trim() || "0";
    const c = String(line.credit ?? "0").trim() || "0";
    if (!TWO_DP.test(d) || !TWO_DP.test(c)) {
      errors.push(`Line ${n}: amounts must be positive numbers with at most 2 decimals.`);
      return;
    }
    const debit = new Decimal(d);
    const credit = new Decimal(c);
    if (debit.gt(0) && credit.gt(0)) errors.push(`Line ${n}: a line cannot have both a debit and a credit.`);
    if (debit.isZero() && credit.isZero()) errors.push(`Line ${n}: enter a debit or a credit amount.`);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
  });

  if (!totalDebit.eq(totalCredit)) {
    errors.push(`Debits (${money2(totalDebit)}) must equal credits (${money2(totalCredit)}).`);
  }
  if (totalDebit.isZero() && lines.length >= 2) errors.push("The entry total must be greater than zero.");

  const result = { totalDebit: money2(totalDebit), totalCredit: money2(totalCredit) };
  return errors.length ? { ok: false, errors, ...result } : { ok: true, ...result };
}

/** Two-line entry: Dr `debitAccountId`, Cr `creditAccountId`. */
export function simpleLines(debitAccountId: string, creditAccountId: string, amount: DecimalLike, description?: string): JournalLineInput[] {
  const a = money2(amount);
  return [
    { accountId: debitAccountId, debit: a, credit: "0.00", description: description ?? null },
    { accountId: creditAccountId, debit: "0.00", credit: a, description: description ?? null },
  ];
}

/** Mirror image of a posted entry, used for reversals. */
export function reverseLines(lines: { accountId: string; debit: DecimalLike; credit: DecimalLike; description?: string | null }[]): JournalLineInput[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: money2(l.credit),
    credit: money2(l.debit),
    description: l.description ? `Reversal: ${l.description}` : "Reversal",
  }));
}

export function isDebitNormal(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

/** Balance in the account's natural direction (positive = normal balance). */
export function naturalBalance(type: AccountType, debit: DecimalLike, credit: DecimalLike): Decimal {
  return isDebitNormal(type) ? dec(debit).minus(dec(credit)) : dec(credit).minus(dec(debit));
}

/** Converts a transaction-currency amount to the workspace base currency. */
export function toBaseAmount(amount: DecimalLike, exchangeRate: DecimalLike): string {
  return money2(dec(amount).times(dec(exchangeRate || 1)));
}

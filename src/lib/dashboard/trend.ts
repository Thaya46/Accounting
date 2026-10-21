import type { AccountType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isoDate, MONTH_SHORT, parseISODate } from "@/lib/dates";
import { Decimal, dec } from "@/lib/money";
import { naturalBalance } from "@/lib/accounting/journal";

export type TrendPoint = { month: string; label: string; income: number; expenses: number; net: number };

/**
 * Posted income vs expenses per calendar month for the `months` months ending
 * with the month of `to` (inclusive of `to`).
 *
 * Dates are bound as text and cast to `date`, and months are bucketed with
 * `to_char`, so results do not depend on the database session time zone
 * (binding a JS Date sends a timestamptz, which shifts calendar dates on
 * servers that are not on UTC).
 */
export async function monthlyIncomeExpense(workspaceId: string, to: string, months = 12): Promise<TrendPoint[]> {
  const end = parseISODate(to);
  const start = isoDate(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1)));
  const rows = await prisma.$queryRaw<{ month: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT to_char(e."date", 'YYYY-MM') AS month, a."type", SUM(l."debit") AS debit, SUM(l."credit") AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e."id" = l."journalEntryId"
    JOIN accounts a ON a."id" = l."accountId"
    WHERE l."workspaceId" = ${workspaceId}
      AND e."date" >= ${start}::date AND e."date" <= ${to}::date
      AND a."type" IN ('INCOME', 'EXPENSE')
    GROUP BY 1, 2`;

  const slots = new Map<string, { label: string; income: Decimal; expenses: Decimal }>();
  const s = parseISODate(start);
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1));
    const key = isoDate(d).slice(0, 7);
    slots.set(key, { label: `${MONTH_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, income: new Decimal(0), expenses: new Decimal(0) });
  }
  for (const r of rows) {
    const slot = slots.get(r.month);
    if (!slot) continue;
    const bal = naturalBalance(r.type, dec(r.debit), dec(r.credit));
    if (r.type === "INCOME") slot.income = slot.income.plus(bal);
    else slot.expenses = slot.expenses.plus(bal);
  }
  return [...slots.entries()].map(([month, v]) => ({
    month,
    label: v.label,
    income: v.income.toDecimalPlaces(2).toNumber(),
    expenses: v.expenses.toDecimalPlaces(2).toNumber(),
    net: v.income.minus(v.expenses).toDecimalPlaces(2).toNumber(),
  }));
}

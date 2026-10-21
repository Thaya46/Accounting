/**
 * Report catalogue and a single loader shared by the report pages and the
 * JSON API, so both always show the same numbers for the same parameters.
 */
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { prisma } from "@/lib/db";
import { todayInTimeZone } from "@/lib/dates";
import { balanceSheet, cashAndBankBalances, cashFlow, generalLedger, journalRegister, profitAndLoss, trialBalance } from "@/lib/accounting/reports";
import { CASH_SUBTYPES } from "@/lib/accounting/coa-template";
import { Decimal, dec, money2 } from "@/lib/money";
import { resolveAsOf, resolvePeriod, type AsOf, type Period } from "./periods";

export type ReportSlug = "profit-and-loss" | "balance-sheet" | "trial-balance" | "cash-flow" | "general-ledger" | "journal";

export type ReportDef = {
  slug: ReportSlug;
  title: string;
  description: string;
  /** "period" reports take from/to; "asOf" reports take a single date. */
  mode: "period" | "asOf";
};

export const REPORTS: ReportDef[] = [
  { slug: "profit-and-loss", title: "Profit & Loss", description: "Income, expenses and net profit for a period.", mode: "period" },
  { slug: "balance-sheet", title: "Balance Sheet", description: "Assets, liabilities and equity at a date.", mode: "asOf" },
  { slug: "trial-balance", title: "Trial Balance", description: "Debit and credit balances of every account at a date.", mode: "asOf" },
  { slug: "cash-flow", title: "Cash Flow", description: "Cash in and out of bank, cash and wallet accounts, by activity.", mode: "period" },
  { slug: "general-ledger", title: "General Ledger", description: "Every posting to one account with a running balance.", mode: "period" },
  { slug: "journal", title: "Journal Register", description: "All journal entries with their debit and credit lines.", mode: "period" },
];

export function reportDef(slug: string): ReportDef | null {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}

export const JOURNAL_LIMIT = 500;

export type ReportParams = { period?: string | null; from?: string | null; to?: string | null; asOf?: string | null; accountId?: string | null };

export async function ledgerAccountOptions(workspaceId: string) {
  return prisma.account.findMany({
    where: { workspaceId },
    select: { id: true, code: true, name: true, type: true, isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
}

export async function loadReport(ctx: WorkspaceContext, slug: ReportSlug, params: ReportParams) {
  const ws = ctx.workspace;
  const today = todayInTimeZone(ws.timeZone);
  const period: Period = resolvePeriod(params, today, ws.fyStartMonth);
  const asOf: AsOf = resolveAsOf(params, today, ws.fyStartMonth);
  const base = { today, currency: ws.defaultCurrency };
  switch (slug) {
    case "profit-and-loss":
      return { ...base, slug, period, data: await profitAndLoss(ws.id, period.from, period.to) } as const;
    case "balance-sheet":
      return { ...base, slug, asOf, data: await balanceSheet(ws.id, asOf.asOf) } as const;
    case "trial-balance":
      return { ...base, slug, asOf, data: await trialBalance(ws.id, asOf.asOf) } as const;
    case "cash-flow": {
      const [data, balances] = await Promise.all([cashFlow(ws.id, period.from, period.to), cashAndBankBalances(ws.id, period.to)]);
      // Cross-check: closing cash must equal the ledger balance of cash-like accounts at period end.
      const ledgerCash = balances
        .filter((b) => (CASH_SUBTYPES as readonly string[]).includes(b.subtype ?? ""))
        .reduce((s, b) => s.plus(dec(b.balance)), new Decimal(0));
      return { ...base, slug, period, data, ledgerCash: money2(ledgerCash), reconciles: ledgerCash.eq(dec(data.closingCash)) } as const;
    }
    case "general-ledger": {
      const accountId = params.accountId && params.accountId.length <= 64 ? params.accountId : null;
      const [accounts, data] = await Promise.all([
        ledgerAccountOptions(ws.id),
        accountId ? generalLedger(ws.id, accountId, period.from, period.to) : Promise.resolve(null),
      ]);
      return { ...base, slug, period, accountId: data ? accountId : null, accounts, data } as const;
    }
    case "journal": {
      const entries = await journalRegister(ws.id, period.from, period.to, JOURNAL_LIMIT);
      return { ...base, slug, period, data: entries, truncated: entries.length >= JOURNAL_LIMIT } as const;
    }
  }
}

export type LoadedReport = Awaited<ReturnType<typeof loadReport>>;

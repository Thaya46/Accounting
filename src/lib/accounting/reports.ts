/**
 * Financial reports, computed from posted journal lines only (the immutable
 * ledger). All functions are workspace-scoped; callers enforce permissions.
 */
import { Prisma, type AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, isoDate, parseISODate } from "@/lib/dates";
import { Decimal, dec, money2 } from "@/lib/money";
import { isDebitNormal, naturalBalance } from "./journal";
import { CASH_SUBTYPES } from "./coa-template";

type Range = { from?: string | null; to?: string | null };

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  isActive: boolean;
};

export type BalanceRow = AccountRow & { debit: string; credit: string; balance: string };

async function sums(workspaceId: string, range: Range) {
  const conds = [Prisma.sql`l."workspaceId" = ${workspaceId}`];
  // Dates are bound as 'YYYY-MM-DD'::date so results never depend on the DB session time zone.
  if (range.from) conds.push(Prisma.sql`e."date" >= ${isoDate(parseISODate(range.from))}::date`);
  if (range.to) conds.push(Prisma.sql`e."date" <= ${isoDate(parseISODate(range.to))}::date`);
  const rows = await prisma.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT l."accountId", COALESCE(SUM(l."debit"), 0) AS debit, COALESCE(SUM(l."credit"), 0) AS credit
    FROM journal_lines l JOIN journal_entries e ON e."id" = l."journalEntryId"
    WHERE ${Prisma.join(conds, " AND ")}
    GROUP BY l."accountId"`;
  return new Map(rows.map((r) => [r.accountId, { debit: dec(r.debit), credit: dec(r.credit) }]));
}

async function accounts(workspaceId: string): Promise<AccountRow[]> {
  return prisma.account.findMany({
    where: { workspaceId },
    select: { id: true, code: true, name: true, type: true, subtype: true, isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
}

/** Debit/credit totals and natural balance per account for a period. */
export async function accountBalances(workspaceId: string, range: Range = {}): Promise<BalanceRow[]> {
  const [accs, s] = await Promise.all([accounts(workspaceId), sums(workspaceId, range)]);
  return accs.map((a) => {
    const t = s.get(a.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    return { ...a, debit: money2(t.debit), credit: money2(t.credit), balance: money2(naturalBalance(a.type, t.debit, t.credit)) };
  });
}

const TYPE_ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

export async function trialBalance(workspaceId: string, asOf: string) {
  const rows = await accountBalances(workspaceId, { to: asOf });
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const lines = rows
    .filter((r) => dec(r.debit).gt(0) || dec(r.credit).gt(0))
    .map((r) => {
      const net = dec(r.debit).minus(dec(r.credit));
      const debit = net.gt(0) ? net : new Decimal(0);
      const credit = net.lt(0) ? net.neg() : new Decimal(0);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      return { id: r.id, code: r.code, name: r.name, type: r.type, debit: money2(debit), credit: money2(credit) };
    })
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.code.localeCompare(b.code));
  return { asOf, lines, totalDebit: money2(totalDebit), totalCredit: money2(totalCredit), balanced: totalDebit.eq(totalCredit) };
}

export async function profitAndLoss(workspaceId: string, from: string, to: string) {
  const rows = await accountBalances(workspaceId, { from, to });
  const pick = (type: AccountType) =>
    rows
      .filter((r) => r.type === type && !dec(r.balance).isZero())
      .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.balance }))
      .sort((a, b) => dec(b.amount).cmp(dec(a.amount)));
  const income = pick("INCOME");
  const expenses = pick("EXPENSE");
  const totalIncome = income.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  const totalExpenses = expenses.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  return {
    from,
    to,
    income,
    expenses,
    totalIncome: money2(totalIncome),
    totalExpenses: money2(totalExpenses),
    netProfit: money2(totalIncome.minus(totalExpenses)),
  };
}

export async function balanceSheet(workspaceId: string, asOf: string) {
  const rows = await accountBalances(workspaceId, { to: asOf });
  const pick = (type: AccountType) =>
    rows.filter((r) => r.type === type && !dec(r.balance).isZero()).map((r) => ({ id: r.id, code: r.code, name: r.name, subtype: r.subtype, amount: r.balance }));
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const sum = (xs: { amount: string }[]) => xs.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  // No closing entries are booked, so cumulative income minus expenses is shown as current earnings.
  const earnings = sum(pick("INCOME")).minus(sum(pick("EXPENSE")));
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity).plus(earnings);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    currentEarnings: money2(earnings),
    totalAssets: money2(totalAssets),
    totalLiabilities: money2(totalLiabilities),
    totalEquity: money2(totalEquity),
    totalLiabilitiesAndEquity: money2(totalLiabilities.plus(totalEquity)),
    balanced: totalAssets.eq(totalLiabilities.plus(totalEquity)),
  };
}

type CashActivity = "operating" | "investing" | "financing";

function classify(type: AccountType, subtype: string | null): CashActivity {
  if (type === "ASSET" && subtype === "FIXED_ASSET") return "investing";
  if (type === "EQUITY" || (type === "LIABILITY" && subtype === "LOAN")) return "financing";
  return "operating";
}

/**
 * Direct-method cash flow: every journal entry that touches a bank/cash/wallet
 * account is attributed to its non-cash counterpart accounts. Transfers between
 * cash accounts net to zero and are excluded.
 */
export async function cashFlow(workspaceId: string, from: string, to: string) {
  const accs = await accounts(workspaceId);
  const byId = new Map(accs.map((a) => [a.id, a]));
  const isCash = (id: string) => (CASH_SUBTYPES as readonly string[]).includes(byId.get(id)?.subtype ?? "");
  const cashIds = accs.filter((a) => isCash(a.id)).map((a) => a.id);

  const opening = await sums(workspaceId, { to: addDays(from, -1) });
  let openingCash = cashIds.reduce((s, id) => {
    const t = opening.get(id);
    return t ? s.plus(t.debit.minus(t.credit)) : s;
  }, new Decimal(0));

  const entries = await prisma.journalEntry.findMany({
    where: { workspaceId, date: { gte: parseISODate(from), lte: parseISODate(to) }, lines: { some: { accountId: { in: cashIds } } } },
    include: { lines: true, reverses: { select: { type: true } } },
  });

  const buckets: Record<CashActivity, Map<string, Decimal>> = { operating: new Map(), investing: new Map(), financing: new Map() };
  let netChange = new Decimal(0);
  for (const e of entries) {
    const cashDelta = e.lines.filter((l) => isCash(l.accountId)).reduce((s, l) => s.plus(dec(l.debit)).minus(dec(l.credit)), new Decimal(0));
    if (cashDelta.isZero()) continue;
    // Opening balances (and corrections to them) are starting cash, not cash flows.
    if (e.type === "OPENING" || e.reverses?.type === "OPENING") {
      openingCash = openingCash.plus(cashDelta);
      continue;
    }
    netChange = netChange.plus(cashDelta);
    const others = e.lines.filter((l) => !isCash(l.accountId));
    const otherTotal = others.reduce((s, l) => s.plus(dec(l.debit)).plus(dec(l.credit)), new Decimal(0));
    for (const l of others) {
      const acc = byId.get(l.accountId)!;
      const share = otherTotal.isZero() ? new Decimal(0) : dec(l.debit).plus(dec(l.credit)).div(otherTotal);
      const amount = cashDelta.times(share);
      const bucket = buckets[classify(acc.type, acc.subtype)];
      bucket.set(acc.id, (bucket.get(acc.id) ?? new Decimal(0)).plus(amount));
    }
  }

  const section = (activity: CashActivity) => {
    const items = [...buckets[activity].entries()]
      .map(([id, amount]) => ({ id, code: byId.get(id)!.code, name: byId.get(id)!.name, amount: money2(amount) }))
      .filter((i) => !dec(i.amount).isZero())
      .sort((a, b) => dec(a.amount).cmp(dec(b.amount)));
    return { items, total: money2(items.reduce((s, i) => s.plus(dec(i.amount)), new Decimal(0))) };
  };

  return {
    from,
    to,
    openingCash: money2(openingCash),
    operating: section("operating"),
    investing: section("investing"),
    financing: section("financing"),
    netChange: money2(netChange),
    closingCash: money2(openingCash.plus(netChange)),
  };
}

export async function generalLedger(workspaceId: string, accountId: string, from: string, to: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, workspaceId } });
  if (!account) return null;
  const openingSums = await sums(workspaceId, { to: addDays(from, -1) });
  const o = openingSums.get(accountId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
  let running = naturalBalance(account.type, o.debit, o.credit);
  const opening = money2(running);

  const lines = await prisma.journalLine.findMany({
    where: { workspaceId, accountId, journalEntry: { date: { gte: parseISODate(from), lte: parseISODate(to) } } },
    include: {
      journalEntry: {
        select: {
          id: true,
          number: true,
          date: true,
          type: true,
          description: true,
          postedByName: true,
          transaction: { select: { id: true, number: true, createdByName: true } },
          reversalOfTxn: { select: { id: true, number: true, createdByName: true } },
        },
      },
    },
    orderBy: [{ journalEntry: { date: "asc" } }, { journalEntry: { number: "asc" } }, { lineNo: "asc" }],
  });

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const entries = lines.map((l) => {
    const d = dec(l.debit);
    const c = dec(l.credit);
    totalDebit = totalDebit.plus(d);
    totalCredit = totalCredit.plus(c);
    running = running.plus(isDebitNormal(account.type) ? d.minus(c) : c.minus(d));
    const txn = l.journalEntry.transaction ?? l.journalEntry.reversalOfTxn;
    return {
      lineId: l.id,
      date: isoDate(l.journalEntry.date),
      journalEntryId: l.journalEntry.id,
      journalNumber: l.journalEntry.number,
      journalType: l.journalEntry.type,
      description: l.description ?? l.journalEntry.description,
      transactionId: txn?.id ?? null,
      transactionNumber: txn?.number ?? null,
      enteredBy: txn?.createdByName ?? l.journalEntry.postedByName,
      debit: money2(d),
      credit: money2(c),
      balance: money2(running),
      reconciled: Boolean(l.reconciledAt),
    };
  });
  return {
    account: { id: account.id, code: account.code, name: account.name, type: account.type, subtype: account.subtype },
    from,
    to,
    opening,
    entries,
    totalDebit: money2(totalDebit),
    totalCredit: money2(totalCredit),
    closing: money2(running),
  };
}

export async function journalRegister(workspaceId: string, from: string, to: string, take = 500) {
  const entries = await prisma.journalEntry.findMany({
    where: { workspaceId, date: { gte: parseISODate(from), lte: parseISODate(to) } },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" } },
      transaction: { select: { id: true, number: true, createdByName: true } },
      reversalOfTxn: { select: { id: true, number: true, createdByName: true } },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    take,
  });
  return entries.map((e) => ({
    id: e.id,
    number: e.number,
    date: isoDate(e.date),
    type: e.type,
    description: e.description,
    postedByName: e.postedByName,
    transaction: e.transaction ?? e.reversalOfTxn,
    totalDebit: money2(e.totalDebit),
    totalCredit: money2(e.totalCredit),
    lines: e.lines.map((l) => ({ code: l.account.code, name: l.account.name, debit: money2(l.debit), credit: money2(l.credit), description: l.description })),
  }));
}

/** Income vs expenses per month for the last `months` months ending at `to`. */
export async function monthlyTrend(workspaceId: string, to: string, months = 12) {
  const end = parseISODate(to);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  const rows = await prisma.$queryRaw<{ month: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT to_char(e."date", 'YYYY-MM') AS month, a."type", SUM(l."debit") AS debit, SUM(l."credit") AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e."id" = l."journalEntryId"
    JOIN accounts a ON a."id" = l."accountId"
    WHERE l."workspaceId" = ${workspaceId} AND e."date" >= ${isoDate(start)}::date AND e."date" <= ${isoDate(end)}::date
      AND a."type" IN ('INCOME', 'EXPENSE')
    GROUP BY 1, 2`;
  const out: { month: string; label: string; income: number; expenses: number; net: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = isoDate(d).slice(0, 7);
    out.push({ month: key, label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " " + String(d.getUTCFullYear()).slice(2), income: 0, expenses: 0, net: 0 });
  }
  for (const r of rows) {
    const slot = out.find((o) => o.month === r.month);
    if (!slot) continue;
    const bal = naturalBalance(r.type, r.debit, r.credit).toNumber();
    if (r.type === "INCOME") slot.income += bal;
    else slot.expenses += bal;
  }
  for (const o of out) o.net = Math.round((o.income - o.expenses) * 100) / 100;
  return out;
}

/** Expense totals by category (falls back to the expense account when uncategorised). */
export async function expenseBreakdown(workspaceId: string, from: string, to: string) {
  const rows = await prisma.$queryRaw<{ name: string; amount: Prisma.Decimal }[]>`
    SELECT COALESCE(c."name", a."name") AS name, SUM(l."debit" - l."credit") AS amount
    FROM journal_lines l
    JOIN journal_entries e ON e."id" = l."journalEntryId"
    JOIN accounts a ON a."id" = l."accountId"
    LEFT JOIN transactions t ON t."journalEntryId" = e."id" OR t."reversalEntryId" = e."id"
    LEFT JOIN account_categories c ON c."id" = t."categoryId" AND c."accountId" = a."id"
    WHERE l."workspaceId" = ${workspaceId} AND a."type" = 'EXPENSE'
      AND e."date" >= ${isoDate(parseISODate(from))}::date AND e."date" <= ${isoDate(parseISODate(to))}::date
    GROUP BY 1
    HAVING SUM(l."debit" - l."credit") <> 0
    ORDER BY 2 DESC`;
  return rows.map((r) => ({ name: r.name, amount: Number(money2(r.amount)) }));
}

export async function cashAndBankBalances(workspaceId: string, asOf?: string) {
  const rows = await accountBalances(workspaceId, { to: asOf ?? null });
  return rows
    .filter((r) => (CASH_SUBTYPES as readonly string[]).includes(r.subtype ?? "") || r.subtype === "CREDIT_CARD")
    .map((r) => ({ id: r.id, code: r.code, name: r.name, subtype: r.subtype, balance: r.balance, isActive: r.isActive }));
}

/** Posted income/expense totals (in base currency) for a period, optionally for one creator. */
export async function incomeExpenseTotals(workspaceId: string, range: Range, createdById?: string) {
  const conds = [Prisma.sql`"workspaceId" = ${workspaceId}`, Prisma.sql`"status" = 'POSTED'`, Prisma.sql`"type" IN ('INCOME', 'EXPENSE')`];
  if (createdById) conds.push(Prisma.sql`"createdById" = ${createdById}`);
  if (range.from) conds.push(Prisma.sql`"date" >= ${isoDate(parseISODate(range.from))}::date`);
  if (range.to) conds.push(Prisma.sql`"date" <= ${isoDate(parseISODate(range.to))}::date`);
  const rows = await prisma.$queryRaw<{ type: string; total: Prisma.Decimal | null; n: number }[]>`
    SELECT "type"::text AS type, SUM(ROUND("amount" * "exchangeRate", 2)) AS total, COUNT(*)::int AS n
    FROM transactions WHERE ${Prisma.join(conds, " AND ")} GROUP BY "type"`;
  const get = (t: string) => rows.find((r) => r.type === t);
  const income = dec(get("INCOME")?.total ?? 0);
  const expenses = dec(get("EXPENSE")?.total ?? 0);
  return {
    income: money2(income),
    expenses: money2(expenses),
    net: money2(income.minus(expenses)),
    incomeCount: get("INCOME")?.n ?? 0,
    expenseCount: get("EXPENSE")?.n ?? 0,
  };
}

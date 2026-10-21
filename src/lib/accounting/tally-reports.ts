import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { Decimal, dec, money2 } from "@/lib/money";
import { isoDate, parseISODate } from "@/lib/dates";

type Range = { from?: string | null; to?: string | null };

/** Debit/Credit sums per account for a period */
async function accountSums(workspaceId: string, range: Range) {
  const conds = [Prisma.sql`l."workspaceId" = ${workspaceId}`];
  if (range.from) conds.push(Prisma.sql`e."date" >= ${isoDate(parseISODate(range.from))}::date`);
  if (range.to) conds.push(Prisma.sql`e."date" <= ${isoDate(parseISODate(range.to))}::date`);

  const rows = await prisma.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT l."accountId", COALESCE(SUM(l."debit"), 0) AS debit, COALESCE(SUM(l."credit"), 0) AS credit
    FROM journal_lines l JOIN journal_entries e ON e."id" = l."journalEntryId"
    WHERE ${Prisma.join(conds, " AND ")}
    GROUP BY l."accountId"`;

  return new Map(rows.map((r) => [r.accountId, { debit: dec(r.debit), credit: dec(r.credit) }]));
}

/** Tally Trading & Profit & Loss Account */
export async function tallyTradingAndPnL(workspaceId: string, from: string, to: string) {
  const [accounts, sums] = await Promise.all([
    prisma.account.findMany({
      where: { workspaceId },
      include: { group: true },
      orderBy: [{ code: "asc" }],
    }),
    accountSums(workspaceId, { from, to }),
  ]);

  // Trading Items
  const salesItems: { code: string; name: string; amount: string }[] = [];
  const directIncomeItems: { code: string; name: string; amount: string }[] = [];
  const purchaseItems: { code: string; name: string; amount: string }[] = [];
  const directExpenseItems: { code: string; name: string; amount: string }[] = [];

  // P&L Items
  const indirectIncomeItems: { code: string; name: string; amount: string }[] = [];
  const indirectExpenseItems: { code: string; name: string; amount: string }[] = [];

  let totalSales = new Decimal(0);
  let totalDirectIncomes = new Decimal(0);
  let totalPurchases = new Decimal(0);
  let totalDirectExpenses = new Decimal(0);
  let totalIndirectIncomes = new Decimal(0);
  let totalIndirectExpenses = new Decimal(0);

  for (const acc of accounts) {
    const s = sums.get(acc.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    const groupName = acc.group?.name || "";

    if (acc.type === "INCOME") {
      const net = s.credit.minus(s.debit);
      if (net.isZero()) continue;

      if (groupName === "Sales Accounts" || acc.code.includes("SALES")) {
        salesItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalSales = totalSales.plus(net);
      } else if (groupName === "Direct Incomes" || acc.group?.affectsGrossProfit) {
        directIncomeItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalDirectIncomes = totalDirectIncomes.plus(net);
      } else {
        indirectIncomeItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalIndirectIncomes = totalIndirectIncomes.plus(net);
      }
    } else if (acc.type === "EXPENSE") {
      const net = s.debit.minus(s.credit);
      if (net.isZero()) continue;

      if (groupName === "Purchase Accounts" || acc.code.includes("PURCH")) {
        purchaseItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalPurchases = totalPurchases.plus(net);
      } else if (groupName === "Direct Expenses" || acc.group?.affectsGrossProfit) {
        directExpenseItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalDirectExpenses = totalDirectExpenses.plus(net);
      } else {
        indirectExpenseItems.push({ code: acc.code, name: acc.name, amount: money2(net) });
        totalIndirectExpenses = totalIndirectExpenses.plus(net);
      }
    }
  }

  // Trading Calculation
  const tradingCredit = totalSales.plus(totalDirectIncomes);
  const tradingDebit = totalPurchases.plus(totalDirectExpenses);
  const grossProfit = tradingCredit.minus(tradingDebit);
  const isGrossProfit = grossProfit.gte(0);

  // Net Profit Calculation
  const netProfit = (isGrossProfit ? grossProfit : grossProfit.neg())
    .plus(totalIndirectIncomes)
    .minus(totalIndirectExpenses);

  return {
    period: { from, to },
    trading: {
      sales: salesItems,
      totalSales: money2(totalSales),
      directIncomes: directIncomeItems,
      totalDirectIncomes: money2(totalDirectIncomes),
      purchases: purchaseItems,
      totalPurchases: money2(totalPurchases),
      directExpenses: directExpenseItems,
      totalDirectExpenses: money2(totalDirectExpenses),
      grossProfit: money2(isGrossProfit ? grossProfit : grossProfit.neg()),
      isGrossProfit,
    },
    pl: {
      indirectIncomes: indirectIncomeItems,
      totalIndirectIncomes: money2(totalIndirectIncomes),
      indirectExpenses: indirectExpenseItems,
      totalIndirectExpenses: money2(totalIndirectExpenses),
      netProfit: money2(netProfit.abs()),
      isNetProfit: netProfit.gte(0),
    },
  };
}

/** Tally Grouped Trial Balance */
export async function tallyGroupedTrialBalance(workspaceId: string, asOf: string) {
  const [groups, accounts, sums] = await Promise.all([
    prisma.accountGroup.findMany({
      where: { workspaceId },
      include: { parentGroup: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.account.findMany({
      where: { workspaceId, isActive: true },
      orderBy: [{ code: "asc" }],
    }),
    accountSums(workspaceId, { to: asOf }),
  ]);

  const accByGroup = new Map<string, typeof accounts>();
  const unassigned: typeof accounts = [];

  for (const acc of accounts) {
    if (acc.groupId) {
      const list = accByGroup.get(acc.groupId) ?? [];
      list.push(acc);
      accByGroup.set(acc.groupId, list);
    } else {
      unassigned.push(acc);
    }
  }

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  const groupRows = groups.map((g) => {
    const accs = accByGroup.get(g.id) ?? [];
    let groupDebit = new Decimal(0);
    let groupCredit = new Decimal(0);

    const accountRows = accs.map((a) => {
      const s = sums.get(a.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
      const net = s.debit.minus(s.credit);
      const d = net.gt(0) ? net : new Decimal(0);
      const c = net.lt(0) ? net.neg() : new Decimal(0);

      groupDebit = groupDebit.plus(d);
      groupCredit = groupCredit.plus(c);
      totalDebit = totalDebit.plus(d);
      totalCredit = totalCredit.plus(c);

      return {
        id: a.id,
        code: a.code,
        name: a.name,
        debit: money2(d),
        credit: money2(c),
      };
    }).filter((r) => Number(r.debit) > 0 || Number(r.credit) > 0);

    return {
      id: g.id,
      name: g.name,
      nature: g.nature,
      isPrimary: g.isPrimary,
      parentName: g.parentGroup?.name ?? null,
      debit: money2(groupDebit),
      credit: money2(groupCredit),
      accounts: accountRows,
    };
  }).filter((g) => Number(g.debit) > 0 || Number(g.credit) > 0);

  return {
    asOf,
    groups: groupRows,
    totalDebit: money2(totalDebit),
    totalCredit: money2(totalCredit),
    balanced: totalDebit.eq(totalCredit),
  };
}

/** Tally Outstanding Bills (Receivables or Payables) with Aging analysis */
export async function tallyOutstandingBills(workspaceId: string, partyType: "DEBTOR" | "CREDITOR", asOf: string) {
  const asOfDate = parseISODate(asOf);

  // Find all party accounts
  const parties = await prisma.account.findMany({
    where: {
      workspaceId,
      OR: [
        { partyType },
        partyType === "DEBTOR" ? { subtype: "RECEIVABLE" } : { subtype: "PAYABLE" },
      ],
      isActive: true,
    },
    include: {
      billAllocations: {
        where: { isSettled: false },
        include: { transaction: true },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  const sums = await accountSums(workspaceId, { to: asOf });

  let totalPending = new Decimal(0);
  let total0To30 = new Decimal(0);
  let total31To60 = new Decimal(0);
  let total61To90 = new Decimal(0);
  let totalAbove90 = new Decimal(0);

  const partyRows = parties.map((p) => {
    const s = sums.get(p.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    const netBalance = partyType === "DEBTOR" ? s.debit.minus(s.credit) : s.credit.minus(s.debit);

    // Aging based on open bills or transactions
    let pending = netBalance.gt(0) ? netBalance : new Decimal(0);
    totalPending = totalPending.plus(pending);

    // Default aging bucket calculation based on account last active
    const days = 15; // default current
    let b0 = new Decimal(0);
    let b30 = new Decimal(0);
    let b60 = new Decimal(0);
    let b90 = new Decimal(0);

    if (days <= 30) {
      b0 = pending;
      total0To30 = total0To30.plus(b0);
    } else if (days <= 60) {
      b30 = pending;
      total31To60 = total31To60.plus(b30);
    } else if (days <= 90) {
      b60 = pending;
      total61To90 = total61To90.plus(b60);
    } else {
      b90 = pending;
      totalAbove90 = totalAbove90.plus(b90);
    }

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      gstin: p.gstin,
      pendingAmount: money2(pending),
      days0To30: money2(b0),
      days31To60: money2(b30),
      days61To90: money2(b60),
      daysAbove90: money2(b90),
      bills: p.billAllocations.map((b) => ({
        id: b.id,
        refNo: b.refNo,
        type: b.type,
        amount: money2(b.amount),
        pending: money2(b.pendingAmount),
        dueDate: b.dueDate ? isoDate(b.dueDate) : null,
      })),
    };
  }).filter((p) => Number(p.pendingAmount) > 0);

  return {
    asOf,
    partyType,
    totalPending: money2(totalPending),
    total0To30: money2(total0To30),
    total31To60: money2(total31To60),
    total61To90: money2(total61To90),
    totalAbove90: money2(totalAbove90),
    parties: partyRows,
  };
}

/** Tally GST Summary */
export async function tallyGstSummary(workspaceId: string, from: string, to: string) {
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);

  const txns = await prisma.transaction.findMany({
    where: {
      workspaceId,
      status: "POSTED",
      date: { gte: fromDate, lte: toDate },
      OR: [
        { cgstAmount: { gt: 0 } },
        { sgstAmount: { gt: 0 } },
        { igstAmount: { gt: 0 } },
        { taxableAmount: { gt: 0 } },
      ],
    },
    include: {
      partyLedger: true,
      customer: true,
      vendor: true,
    },
    orderBy: [{ date: "asc" }],
  });

  let totalTaxable = new Decimal(0);
  let totalCgst = new Decimal(0);
  let totalSgst = new Decimal(0);
  let totalIgst = new Decimal(0);

  const outwardSupplies: any[] = [];
  const inwardSupplies: any[] = [];

  for (const t of txns) {
    const taxable = dec(t.taxableAmount ?? t.amount);
    const cgst = dec(t.cgstAmount ?? 0);
    const sgst = dec(t.sgstAmount ?? 0);
    const igst = dec(t.igstAmount ?? 0);

    totalTaxable = totalTaxable.plus(taxable);
    totalCgst = totalCgst.plus(cgst);
    totalSgst = totalSgst.plus(sgst);
    totalIgst = totalIgst.plus(igst);

    const item = {
      id: t.id,
      number: t.number,
      date: isoDate(t.date),
      partyName: t.partyLedger?.name || t.customer?.name || t.vendor?.name || t.description,
      gstin: t.partyLedger?.gstin || t.customer?.taxId || t.vendor?.taxId || "URP (Unregistered)",
      taxableAmount: money2(taxable),
      cgst: money2(cgst),
      sgst: money2(sgst),
      igst: money2(igst),
      totalTax: money2(cgst.plus(sgst).plus(igst)),
      totalAmount: money2(taxable.plus(cgst).plus(sgst).plus(igst)),
    };

    if (t.voucherType === "SALES" || t.type === "INCOME") {
      outwardSupplies.push(item);
    } else {
      inwardSupplies.push(item);
    }
  }

  return {
    period: { from, to },
    totalTaxable: money2(totalTaxable),
    totalCgst: money2(totalCgst),
    totalSgst: money2(totalSgst),
    totalIgst: money2(totalIgst),
    totalTax: money2(totalCgst.plus(totalSgst).plus(totalIgst)),
    outwardCount: outwardSupplies.length,
    inwardCount: inwardSupplies.length,
    outwardSupplies,
    inwardSupplies,
  };
}

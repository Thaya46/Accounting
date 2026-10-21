import { prisma } from "@/lib/db";
import { isoDate, parseISODate } from "@/lib/dates";
import { Decimal, money2 } from "@/lib/money";

export type DayBookFilter = {
  date?: string;
  voucherType?: string;
  search?: string;
};

export type DayBookEntry = {
  id: string;
  number: number;
  date: string;
  voucherType: string;
  type: string;
  description: string;
  amount: string;
  currency: string;
  status: string;
  createdByName: string;
  reference: string | null;
  debitAccountName: string | null;
  creditAccountName: string | null;
  partyName: string | null;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
  }[];
};

export async function loadDayBook(workspaceId: string, filter: DayBookFilter) {
  const targetDate = filter.date ? parseISODate(filter.date) : parseISODate(new Date().toISOString().slice(0, 10));

  // Load transactions for the target date
  const whereClause: any = {
    workspaceId,
    date: targetDate,
  };

  if (filter.voucherType && filter.voucherType !== "ALL") {
    whereClause.OR = [
      { voucherType: filter.voucherType },
      // Fallback matching
      filter.voucherType === "PAYMENT" ? { type: "EXPENSE" } : null,
      filter.voucherType === "RECEIPT" ? { type: "INCOME" } : null,
      filter.voucherType === "CONTRA" ? { type: "TRANSFER" } : null,
      filter.voucherType === "JOURNAL" ? { type: "JOURNAL" } : null,
    ].filter(Boolean);
  }

  const txns = await prisma.transaction.findMany({
    where: whereClause,
    include: {
      debitAccount: true,
      creditAccount: true,
      partyLedger: true,
      customer: true,
      vendor: true,
      journalEntry: {
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      },
    },
    orderBy: [{ number: "asc" }],
  });

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  const entries: DayBookEntry[] = txns.map((t) => {
    const vType =
      t.voucherType ||
      (t.type === "EXPENSE"
        ? "PAYMENT"
        : t.type === "INCOME"
          ? "RECEIPT"
          : t.type === "TRANSFER"
            ? "CONTRA"
            : "JOURNAL");

    const amt = new Decimal(t.amount);
    totalDebit = totalDebit.plus(amt);
    totalCredit = totalCredit.plus(amt);

    const journalLines = t.journalEntry?.lines.map((l) => ({
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      debit: money2(l.debit),
      credit: money2(l.credit),
    })) ?? [
      {
        accountId: t.debitAccountId ?? "",
        accountCode: t.debitAccount?.code ?? "",
        accountName: t.debitAccount?.name ?? "Debit",
        debit: money2(amt),
        credit: "0.00",
      },
      {
        accountId: t.creditAccountId ?? "",
        accountCode: t.creditAccount?.code ?? "",
        accountName: t.creditAccount?.name ?? "Credit",
        debit: "0.00",
        credit: money2(amt),
      },
    ];

    return {
      id: t.id,
      number: t.number,
      date: isoDate(t.date),
      voucherType: vType,
      type: t.type,
      description: t.description,
      amount: money2(amt),
      currency: t.currency,
      status: t.status,
      createdByName: t.createdByName,
      reference: t.reference || t.invoiceNumber || null,
      debitAccountName: t.debitAccount?.name ?? null,
      creditAccountName: t.creditAccount?.name ?? null,
      partyName: t.partyLedger?.name || t.customer?.name || t.vendor?.name || null,
      lines: journalLines,
    };
  });

  return {
    date: isoDate(targetDate),
    totalDebit: money2(totalDebit),
    totalCredit: money2(totalCredit),
    count: entries.length,
    entries,
  };
}

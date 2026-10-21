import { prisma } from "@/lib/db";
import { isoDate, parseISODate } from "@/lib/dates";
import { money2 } from "@/lib/money";
import { naturalBalance } from "@/lib/accounting/journal";

/** Account header data for the ledger page (null when not in this workspace). */
export async function accountOverview(workspaceId: string, accountId: string, asOf: string) {
  if (!accountId || accountId.length > 64) return null;
  const account = await prisma.account.findFirst({ where: { id: accountId, workspaceId } });
  if (!account) return null;
  const [sums, firstEntry] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { workspaceId, accountId, journalEntry: { date: { lte: parseISODate(asOf) } } },
      _sum: { debit: true, credit: true },
      _count: true,
    }),
    prisma.journalEntry.findFirst({
      where: { workspaceId, lines: { some: { accountId } } },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    description: account.description,
    bankName: account.bankName,
    accountNumberLast4: account.accountNumberLast4,
    isActive: account.isActive,
    isSystem: account.isSystem,
    openingBalance: money2(account.openingBalance),
    openingBalanceDate: account.openingBalanceDate ? isoDate(account.openingBalanceDate) : null,
    balance: money2(naturalBalance(account.type, sums._sum.debit ?? 0, sums._sum.credit ?? 0)),
    postingCount: sums._count,
    firstEntryDate: firstEntry ? isoDate(firstEntry.date) : null,
    asOf,
  };
}

export type AccountOverview = NonNullable<Awaited<ReturnType<typeof accountOverview>>>;

/**
 * Bank / cash / wallet / credit-card reconciliation.
 *
 * Posted journal lines are immutable; reconciliation only stamps
 * `reconciledAt` + `reconciliationId` on lines (the only columns the ledger
 * trigger lets change). Balances are always recomputed on the server with
 * Decimal, in the account's natural direction.
 */
import { z } from "zod";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatDate, isoDate, parseISODate, todayInTimeZone } from "@/lib/dates";
import { Decimal, dec, formatMoney, money2 } from "@/lib/money";
import { naturalBalance } from "./journal";
import type { ServiceCtx } from "./transactions";

export const RECONCILABLE_SUBTYPES = ["BANK", "CASH", "WALLET", "CREDIT_CARD"] as const;

export function isReconcilable(subtype: string | null | undefined) {
  return (RECONCILABLE_SUBTYPES as readonly string[]).includes(subtype ?? "");
}

const MAX_LINES = 5000;

export const reconciliationInputSchema = z.object({
  accountId: z.string().trim().min(1).max(64),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  statementBalance: z
    .string()
    .trim()
    .regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Enter the statement balance with at most 2 decimals"),
  lineIds: z.array(z.string().trim().min(1).max(64)).max(MAX_LINES, `At most ${MAX_LINES} lines per reconciliation`),
  /** Required to complete when the statement and cleared balances differ. */
  acceptDifference: z.boolean().optional().default(false),
});

export type ReconciliationInput = z.input<typeof reconciliationInputSchema>;

export type UnreconciledLine = {
  id: string;
  date: string;
  journalNumber: number;
  journalType: string;
  description: string;
  transactionId: string | null;
  transactionNumber: number | null;
  enteredBy: string;
  debit: string;
  credit: string;
};

export type ReconciliationSummary = {
  id: string;
  statementDate: string;
  statementBalance: string;
  bookBalance: string;
  difference: string;
  lineCount: number;
  completedByName: string;
  createdAt: string;
};

async function clearedTotals(workspaceId: string, accountId: string, type: AccountType) {
  const agg = await prisma.journalLine.aggregate({
    where: { workspaceId, accountId, reconciledAt: { not: null } },
    _sum: { debit: true, credit: true },
    _count: true,
  });
  return { balance: naturalBalance(type, agg._sum.debit ?? 0, agg._sum.credit ?? 0), count: agg._count };
}

export async function listReconciliations(workspaceId: string, accountId: string, take = 50): Promise<ReconciliationSummary[]> {
  const rows = await prisma.reconciliation.findMany({
    where: { workspaceId, accountId },
    orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }],
    take,
    include: { _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    statementDate: isoDate(r.statementDate),
    statementBalance: money2(r.statementBalance),
    bookBalance: money2(r.bookBalance),
    difference: money2(r.difference),
    lineCount: r._count.lines,
    completedByName: r.completedByName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Everything the reconciliation screen needs for one account. */
export async function reconciliationState(workspaceId: string, accountId: string, limit = 2000) {
  const account = await prisma.account.findFirst({ where: { id: accountId, workspaceId }, select: { id: true, type: true, subtype: true } });
  if (!account || !isReconcilable(account.subtype)) return null;
  const [cleared, lines, history] = await Promise.all([
    clearedTotals(workspaceId, accountId, account.type),
    prisma.journalLine.findMany({
      where: { workspaceId, accountId, reconciledAt: null },
      include: {
        journalEntry: {
          select: {
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
      take: limit + 1,
    }),
    listReconciliations(workspaceId, accountId),
  ]);
  const truncated = lines.length > limit;
  const unreconciled: UnreconciledLine[] = lines.slice(0, limit).map((l) => {
    const txn = l.journalEntry.transaction ?? l.journalEntry.reversalOfTxn;
    return {
      id: l.id,
      date: isoDate(l.journalEntry.date),
      journalNumber: l.journalEntry.number,
      journalType: l.journalEntry.type,
      description: l.description ?? l.journalEntry.description,
      transactionId: txn?.id ?? null,
      transactionNumber: txn?.number ?? null,
      enteredBy: txn?.createdByName ?? l.journalEntry.postedByName,
      debit: money2(l.debit),
      credit: money2(l.credit),
    };
  });
  return {
    accountType: account.type,
    clearedBalance: money2(cleared.balance),
    clearedCount: cleared.count,
    lastStatementDate: history[0]?.statementDate ?? null,
    unreconciled,
    truncated,
    history,
  };
}

/**
 * Completes a reconciliation: validates every selected line, recomputes the
 * cleared balance, records the statement/cleared difference and stamps the
 * lines — atomically, serialised per account.
 */
export async function completeReconciliation(ctx: ServiceCtx, rawInput: ReconciliationInput) {
  if (!ctx.permissions.has("ACCOUNTS_MANAGE")) throw forbidden("Missing permission: ACCOUNTS_MANAGE");
  const input = reconciliationInputSchema.parse(rawInput);
  const workspaceId = ctx.workspace.id;

  let statementDate: Date;
  try {
    statementDate = parseISODate(input.statementDate);
  } catch {
    throw badRequest("Enter a valid statement date");
  }
  const today = todayInTimeZone(ctx.workspace.timeZone);
  if (input.statementDate > today) throw badRequest("The statement date cannot be in the future");
  const statementBalance = dec(input.statementBalance);
  const lineIds = [...new Set(input.lineIds)];

  return prisma.$transaction(
    async (tx) => {
      // Serialise reconciliations of the same account.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM accounts WHERE "id" = ${input.accountId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      if (!locked.length) throw notFound("Account not found");
      const account = await tx.account.findFirst({ where: { id: input.accountId, workspaceId } });
      if (!account) throw notFound("Account not found");
      if (!isReconcilable(account.subtype)) throw badRequest("Only bank, cash, wallet and credit card accounts can be reconciled");

      const last = await tx.reconciliation.findFirst({
        where: { workspaceId, accountId: account.id },
        orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }],
        select: { statementDate: true },
      });
      if (last && statementDate < last.statementDate) {
        throw badRequest(`The statement date cannot be earlier than the last reconciliation (${formatDate(last.statementDate)})`);
      }

      const lines = lineIds.length
        ? await tx.journalLine.findMany({
            where: { id: { in: lineIds }, workspaceId, accountId: account.id },
            select: { id: true, debit: true, credit: true, reconciledAt: true, journalEntry: { select: { date: true, number: true } } },
          })
        : [];
      if (lines.length !== lineIds.length) throw badRequest("Some selected lines do not belong to this account");
      const already = lines.filter((l) => l.reconciledAt);
      if (already.length) throw conflict(`${already.length} selected line(s) were already reconciled. Refresh and try again.`);
      const late = lines.filter((l) => l.journalEntry.date > statementDate);
      if (late.length) throw badRequest(`${late.length} selected line(s) are dated after the statement date`);

      const prev = await tx.journalLine.aggregate({
        where: { workspaceId, accountId: account.id, reconciledAt: { not: null } },
        _sum: { debit: true, credit: true },
      });
      let debit = dec(prev._sum.debit ?? 0);
      let credit = dec(prev._sum.credit ?? 0);
      for (const l of lines) {
        debit = debit.plus(dec(l.debit));
        credit = credit.plus(dec(l.credit));
      }
      const cleared = naturalBalance(account.type, debit, credit);
      const difference = statementBalance.minus(cleared);
      if (!difference.isZero() && !input.acceptDifference) {
        throw conflict(`The statement balance differs from the cleared balance by ${money2(difference)}. Confirm to record the difference.`, {
          clearedBalance: money2(cleared),
          difference: money2(difference),
        });
      }

      const rec = await tx.reconciliation.create({
        data: {
          workspaceId,
          accountId: account.id,
          statementDate,
          statementBalance: money2(statementBalance),
          bookBalance: money2(cleared),
          difference: money2(difference),
          completedById: ctx.actor.id,
          completedByName: ctx.actor.name,
        },
      });
      if (lineIds.length) {
        const stamped = await tx.journalLine.updateMany({
          where: { id: { in: lineIds }, workspaceId, accountId: account.id, reconciledAt: null },
          data: { reconciledAt: new Date(), reconciliationId: rec.id },
        });
        if (stamped.count !== lineIds.length) throw conflict("Some lines were reconciled by someone else. Refresh and try again.");
      }

      const summary = {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        statementDate: input.statementDate,
        statementBalance: money2(statementBalance),
        clearedBalance: money2(cleared),
        difference: money2(difference),
        lineCount: lineIds.length,
      };
      await audit(tx, {
        workspaceId,
        actor: ctx.actor,
        entityType: "RECONCILIATION",
        entityId: rec.id,
        action: "RECONCILIATION_COMPLETED",
        reason: difference.isZero()
          ? null
          : `Completed with a difference of ${formatMoney(difference, ctx.workspace.defaultCurrency, { decimals: true })}`,
        after: summary,
        ip: ctx.meta?.ip,
        userAgent: ctx.meta?.userAgent,
      });
      return { id: rec.id, ...summary };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Natural-direction sum of lines (used by tests and the UI for previews). */
export function naturalSum(type: AccountType, lines: { debit: string; credit: string }[]) {
  const d = lines.reduce((s, l) => s.plus(dec(l.debit)), new Decimal(0));
  const c = lines.reduce((s, l) => s.plus(dec(l.credit)), new Decimal(0));
  return naturalBalance(type, d, c);
}

import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { parseISODate } from "@/lib/dates";
import { dec, money2 } from "@/lib/money";
import { allocateNumber, type ServiceCtx } from "./transactions";
import { isDebitNormal, reverseLines, validateJournalLines, type JournalLineInput } from "./journal";

/**
 * Sets an account's opening balance by posting an OPENING journal entry against
 * Opening Balance Equity. Changing it later reverses the previous opening entry
 * and posts a new one, so the ledger history stays intact.
 * `amount` is in the account's natural direction (positive = normal balance).
 */
export async function setOpeningBalance(ctx: ServiceCtx, accountId: string, amount: string, date: string) {
  if (!ctx.permissions.has("ACCOUNTS_MANAGE")) throw forbidden("Missing permission: ACCOUNTS_MANAGE");
  parseISODate(date);
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw badRequest("Enter the opening balance with at most 2 decimals");

  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({ where: { id: accountId, workspaceId: ctx.workspace.id } });
    if (!account) throw notFound("Account not found");
    if (account.type === "INCOME" || account.type === "EXPENSE") throw badRequest("Opening balances apply to asset, liability and equity accounts");
    if (account.subtype === "OPENING_EQUITY") throw badRequest("Opening Balance Equity is the balancing account and cannot be set directly");
    const equity = await tx.account.findFirst({ where: { workspaceId: ctx.workspace.id, subtype: "OPENING_EQUITY" } });
    if (!equity) throw badRequest("This workspace has no Opening Balance Equity account");

    const reference = `OPENING:${account.id}`;
    const previous = await tx.journalEntry.findFirst({
      where: { workspaceId: ctx.workspace.id, type: "OPENING", reference, reversedBy: null },
      include: { lines: true },
    });
    let reversalId: string | null = null;
    if (previous) {
      const lines = reverseLines(previous.lines);
      const v = validateJournalLines(lines);
      const number = await allocateNumber(tx, ctx.workspace.id, "journal");
      const rev = await tx.journalEntry.create({
        data: {
          workspaceId: ctx.workspace.id,
          number,
          date: previous.date,
          type: "REVERSAL",
          description: `Reversal of opening balance: ${account.name}`,
          reference,
          reversesEntryId: previous.id,
          totalDebit: v.totalDebit,
          totalCredit: v.totalCredit,
          postedById: ctx.actor.id,
          postedByName: ctx.actor.name,
          lines: { create: lines.map((l, i) => ({ workspaceId: ctx.workspace.id, accountId: l.accountId, lineNo: i + 1, debit: l.debit, credit: l.credit, description: l.description })) },
        },
      });
      reversalId = rev.id;
    }

    let entryId: string | null = null;
    const value = dec(amount);
    if (!value.isZero()) {
      const abs = money2(value.abs());
      // Debit the account when the balance increases its natural (debit) side.
      const debitAccount = isDebitNormal(account.type) === value.gt(0);
      const lines: JournalLineInput[] = debitAccount
        ? [
            { accountId: account.id, debit: abs, credit: "0.00", description: "Opening balance" },
            { accountId: equity.id, debit: "0.00", credit: abs, description: `Opening balance: ${account.name}` },
          ]
        : [
            { accountId: equity.id, debit: abs, credit: "0.00", description: `Opening balance: ${account.name}` },
            { accountId: account.id, debit: "0.00", credit: abs, description: "Opening balance" },
          ];
      const v = validateJournalLines(lines);
      const number = await allocateNumber(tx, ctx.workspace.id, "journal");
      const entry = await tx.journalEntry.create({
        data: {
          workspaceId: ctx.workspace.id,
          number,
          date: parseISODate(date),
          type: "OPENING",
          description: `Opening balance: ${account.name}`,
          reference,
          totalDebit: v.totalDebit,
          totalCredit: v.totalCredit,
          postedById: ctx.actor.id,
          postedByName: ctx.actor.name,
          lines: { create: lines.map((l, i) => ({ workspaceId: ctx.workspace.id, accountId: l.accountId, lineNo: i + 1, debit: l.debit, credit: l.credit, description: l.description })) },
        },
      });
      entryId = entry.id;
    }

    await tx.account.update({ where: { id: account.id }, data: { openingBalance: money2(value), openingBalanceDate: parseISODate(date) } });
    await audit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      entityType: "ACCOUNT",
      entityId: account.id,
      action: "OPENING_BALANCE_SET",
      before: { openingBalance: money2(account.openingBalance) },
      after: { openingBalance: money2(value), date, journalEntryId: entryId },
      reversalId,
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });
    return { entryId, reversalId };
  }, { maxWait: 10_000, timeout: 30_000 });
}

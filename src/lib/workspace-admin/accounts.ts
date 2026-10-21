import { z } from "zod";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { accountBalances } from "@/lib/accounting/reports";
import { isoDate } from "@/lib/dates";
import { money2 } from "@/lib/money";
import {
  ACCOUNT_CODE_RE,
  ACCOUNT_TYPES,
  BANK_DETAIL_SUBTYPES,
  SUBTYPES_BY_TYPE,
  SYSTEM_ONLY_SUBTYPES,
  subtypeLabel,
} from "./constants";
import { TX_OPTIONS, auditMeta, optionalText, type AdminCtx } from "./common";

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  description: string | null;
  bankName: string | null;
  accountNumberLast4: string | null;
  isActive: boolean;
  isSystem: boolean;
  openingBalance: string;
  openingBalanceDate: string | null;
  balance: string;
  hasLedgerEntries: boolean;
  usedByTransactions: boolean;
  categoryCount: number;
  activeCategoryCount: number;
};

export async function listAccounts(workspaceId: string): Promise<AccountRow[]> {
  const [accounts, balances] = await Promise.all([
    prisma.account.findMany({
      where: { workspaceId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        description: true,
        bankName: true,
        accountNumberLast4: true,
        isActive: true,
        isSystem: true,
        openingBalance: true,
        openingBalanceDate: true,
        _count: { select: { journalLines: true, debitTxns: true, creditTxns: true, categories: true } },
        categories: { where: { isActive: true }, select: { id: true } },
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    accountBalances(workspaceId),
  ]);
  const balanceById = new Map(balances.map((b) => [b.id, b.balance]));
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    description: a.description,
    bankName: a.bankName,
    accountNumberLast4: a.accountNumberLast4,
    isActive: a.isActive,
    isSystem: a.isSystem,
    openingBalance: money2(a.openingBalance),
    openingBalanceDate: a.openingBalanceDate ? isoDate(a.openingBalanceDate) : null,
    balance: balanceById.get(a.id) ?? "0.00",
    hasLedgerEntries: a._count.journalLines > 0,
    usedByTransactions: a._count.debitTxns + a._count.creditTxns > 0,
    categoryCount: a._count.categories,
    activeCategoryCount: a.categories.length,
  }));
}

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Enter an account code")
  .max(30, "Codes are at most 30 characters")
  .regex(ACCOUNT_CODE_RE, "Use uppercase letters, digits and single dashes (e.g. BANK-HDFC)");

const last4Schema = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}$/.test(v), "Enter exactly the last 4 digits");

const subtypeSchema = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v ? v.toUpperCase() : null));

export const accountCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2, "Account name must be at least 2 characters").max(120),
  type: z.enum(ACCOUNT_TYPES),
  subtype: subtypeSchema,
  description: optionalText(500),
  bankName: optionalText(120),
  accountNumberLast4: last4Schema,
  isActive: z.boolean().default(true),
});

export const accountUpdateSchema = z.object({
  code: codeSchema.optional(),
  name: z.string().trim().min(2, "Account name must be at least 2 characters").max(120).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  subtype: subtypeSchema.optional(),
  description: optionalText(500).optional(),
  bankName: optionalText(120).optional(),
  accountNumberLast4: last4Schema.optional(),
  isActive: z.boolean().optional(),
});

function assertSubtypeFits(type: AccountType, subtype: string | null) {
  if (subtype && !SUBTYPES_BY_TYPE[type].includes(subtype)) {
    throw badRequest(`"${subtypeLabel(subtype)}" is not a valid subtype for ${type.toLowerCase()} accounts`);
  }
}

async function assertUnique(workspaceId: string, code: string | undefined, name: string | undefined, exceptId?: string) {
  const not = exceptId ? { id: { not: exceptId } } : {};
  if (code) {
    const clash = await prisma.account.findFirst({ where: { workspaceId, code, ...not }, select: { name: true } });
    if (clash) throw conflict(`Code ${code} is already used by "${clash.name}"`);
  }
  if (name) {
    const clash = await prisma.account.findFirst({ where: { workspaceId, name: { equals: name, mode: "insensitive" }, ...not }, select: { code: true } });
    if (clash) throw conflict(`An account named "${name}" already exists (${clash.code})`);
  }
}

export async function createAccount(ctx: AdminCtx, body: z.infer<typeof accountCreateSchema>) {
  assertSubtypeFits(body.type, body.subtype);
  if (body.subtype && SYSTEM_ONLY_SUBTYPES.includes(body.subtype)) {
    throw badRequest(`${subtypeLabel(body.subtype)} is reserved for the built-in system account`);
  }
  await assertUnique(ctx.workspace.id, body.code, body.name);
  const bankDetails = body.subtype && BANK_DETAIL_SUBTYPES.includes(body.subtype);
  const data = {
    code: body.code,
    name: body.name,
    type: body.type,
    subtype: body.subtype,
    description: body.description,
    bankName: bankDetails ? body.bankName : null,
    accountNumberLast4: bankDetails ? body.accountNumberLast4 : null,
    isActive: body.isActive,
  };
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({ data: { workspaceId: ctx.workspace.id, ...data } });
    await audit(tx, { ...auditMeta(ctx), entityType: "ACCOUNT", entityId: account.id, action: "ACCOUNT_CREATED", after: data });
    return { id: account.id, code: account.code, name: account.name };
  }, TX_OPTIONS);
}

export async function updateAccount(ctx: AdminCtx, accountId: string, body: z.infer<typeof accountUpdateSchema>) {
  const wsId = ctx.workspace.id;
  return prisma.$transaction(async (tx) => {
    // Lock the row so concurrent edits cannot interleave with the usage checks below.
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${accountId} AND "workspaceId" = ${wsId} FOR UPDATE`;
    const account = await tx.account.findFirst({
      where: { id: accountId, workspaceId: wsId },
      include: {
        _count: { select: { journalLines: true, debitTxns: true, creditTxns: true, categories: true } },
        categories: { where: { isActive: true }, select: { name: true } },
      },
    });
    if (!account) throw notFound("Account not found");

    const type = body.type ?? account.type;
    const subtype = body.subtype !== undefined ? body.subtype : account.subtype;
    const isActive = body.isActive ?? account.isActive;

    if (type !== account.type) {
      if (account.isSystem) throw badRequest("System accounts cannot change type");
      if (account._count.journalLines > 0) throw badRequest("This account already has ledger entries, so its type cannot change. Create a new account instead.");
      if (account._count.debitTxns + account._count.creditTxns > 0) throw badRequest("Transactions already use this account, so its type cannot change");
      if (account._count.categories > 0) throw badRequest("Categories are linked to this account. Relink them before changing its type.");
    }
    if (subtype !== account.subtype) {
      if (account.isSystem) throw badRequest("System accounts cannot change subtype");
      if (subtype && SYSTEM_ONLY_SUBTYPES.includes(subtype)) throw badRequest(`${subtypeLabel(subtype)} is reserved for the built-in system account`);
    }
    assertSubtypeFits(type, subtype);
    if (!isActive && account.isActive) {
      if (account.isSystem) throw badRequest("System accounts cannot be deactivated");
      if (account.categories.length) {
        const names = account.categories.map((c) => c.name).join(", ");
        throw badRequest(`Active categories use this account (${names}). Deactivate them or link them to another account first.`);
      }
    }

    const code = body.code ?? account.code;
    const name = body.name ?? account.name;
    if (code !== account.code || name.toLowerCase() !== account.name.toLowerCase()) {
      const not = { id: { not: account.id } };
      if (code !== account.code) {
        const clash = await tx.account.findFirst({ where: { workspaceId: wsId, code, ...not }, select: { name: true } });
        if (clash) throw conflict(`Code ${code} is already used by "${clash.name}"`);
      }
      if (name.toLowerCase() !== account.name.toLowerCase()) {
        const clash = await tx.account.findFirst({ where: { workspaceId: wsId, name: { equals: name, mode: "insensitive" }, ...not }, select: { code: true } });
        if (clash) throw conflict(`An account named "${name}" already exists (${clash.code})`);
      }
    }

    const bankDetails = Boolean(subtype && BANK_DETAIL_SUBTYPES.includes(subtype));
    const next = {
      code,
      name,
      type,
      subtype,
      description: body.description !== undefined ? body.description : account.description,
      bankName: bankDetails ? (body.bankName !== undefined ? body.bankName : account.bankName) : null,
      accountNumberLast4: bankDetails ? (body.accountNumberLast4 !== undefined ? body.accountNumberLast4 : account.accountNumberLast4) : null,
      isActive,
    };
    const current = {
      code: account.code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      description: account.description,
      bankName: account.bankName,
      accountNumberLast4: account.accountNumberLast4,
      isActive: account.isActive,
    };
    const d = diff(current, next);
    if (!d.changed) return { id: account.id, changed: false };

    await tx.account.update({ where: { id: account.id }, data: next });
    const action = next.isActive !== account.isActive ? (next.isActive ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED") : "ACCOUNT_UPDATED";
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "ACCOUNT",
      entityId: account.id,
      action,
      before: { account: `${account.code} · ${account.name}`, ...d.before },
      after: { account: `${next.code} · ${next.name}`, ...d.after },
    });
    return { id: account.id, changed: true };
  }, TX_OPTIONS);
}

export const openingBalanceSchema = z.object({
  amount: z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), "Enter an amount with at most 2 decimals (negative allowed)")
    .refine((v) => v.replace("-", "").split(".")[0]!.length <= 15, "Amount is too large"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
});

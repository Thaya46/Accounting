import { z } from "zod";
import type { CategoryKind } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { TX_OPTIONS, auditMeta, type AdminCtx } from "./common";

export type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountActive: boolean;
  keywords: string[];
  isActive: boolean;
  usageCount: number;
};

export async function listCategories(workspaceId: string): Promise<CategoryRow[]> {
  const rows = await prisma.accountCategory.findMany({
    where: { workspaceId },
    include: { account: { select: { id: true, code: true, name: true, isActive: true } }, _count: { select: { transactions: true } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    accountId: c.account.id,
    accountCode: c.account.code,
    accountName: c.account.name,
    accountActive: c.account.isActive,
    keywords: c.keywords,
    isActive: c.isActive,
    usageCount: c._count.transactions,
  }));
}

/** Lower-cased, trimmed, de-duplicated keywords (the AI parser matches case-insensitively). */
const keywordsSchema = z
  .array(z.string().trim().toLowerCase().max(60, "Keywords are at most 60 characters"))
  .max(60, "Use at most 60 keywords")
  .transform((list) => [...new Set(list.filter(Boolean))]);

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(80),
  kind: z.enum(["INCOME", "EXPENSE"]),
  accountId: z.string().trim().min(1, "Choose a ledger account").max(64),
  keywords: keywordsSchema.default([]),
  isActive: z.boolean().default(true),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(80).optional(),
  kind: z.enum(["INCOME", "EXPENSE"]).optional(),
  accountId: z.string().trim().min(1).max(64).optional(),
  keywords: keywordsSchema.optional(),
  isActive: z.boolean().optional(),
});

/** Income categories post to INCOME accounts, expense categories to EXPENSE accounts — same workspace. */
async function resolveLedgerAccount(db: Tx, workspaceId: string, accountId: string, kind: CategoryKind) {
  const account = await db.account.findFirst({ where: { id: accountId, workspaceId }, select: { id: true, code: true, name: true, type: true, isActive: true } });
  if (!account) throw badRequest("Choose a ledger account from this workspace");
  if (account.type !== kind) {
    throw badRequest(`${kind === "INCOME" ? "Income" : "Expense"} categories must be linked to ${kind === "INCOME" ? "an income" : "an expense"} account`);
  }
  if (!account.isActive) throw badRequest(`${account.name} is inactive. Reactivate it or choose another account.`);
  return account;
}

async function assertNameFree(db: Tx, workspaceId: string, name: string, exceptId?: string) {
  const clash = await db.accountCategory.findFirst({
    where: { workspaceId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`A category named "${name}" already exists`);
}

export async function createCategory(ctx: AdminCtx, body: z.infer<typeof categoryCreateSchema>) {
  return prisma.$transaction(async (tx) => {
    const account = await resolveLedgerAccount(tx, ctx.workspace.id, body.accountId, body.kind);
    await assertNameFree(tx, ctx.workspace.id, body.name);
    const category = await tx.accountCategory.create({
      data: { workspaceId: ctx.workspace.id, name: body.name, kind: body.kind, accountId: account.id, keywords: body.keywords, isActive: body.isActive },
    });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "CATEGORY",
      entityId: category.id,
      action: "CATEGORY_CREATED",
      after: { name: category.name, kind: category.kind, account: `${account.code} · ${account.name}`, keywords: category.keywords, isActive: category.isActive },
    });
    return { id: category.id, name: category.name };
  }, TX_OPTIONS);
}

export async function updateCategory(ctx: AdminCtx, categoryId: string, body: z.infer<typeof categoryUpdateSchema>) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.accountCategory.findFirst({
      where: { id: categoryId, workspaceId: ctx.workspace.id },
      include: { account: { select: { id: true, code: true, name: true } }, _count: { select: { transactions: true } } },
    });
    if (!category) throw notFound("Category not found");

    const kind = body.kind ?? category.kind;
    if (kind !== category.kind && category._count.transactions > 0) {
      throw badRequest("Transactions already use this category, so it cannot switch between income and expense");
    }
    const accountId = body.accountId ?? category.accountId;
    let account = category.account;
    const reactivating = body.isActive === true && !category.isActive;
    if (accountId !== category.accountId || kind !== category.kind || reactivating) {
      account = await resolveLedgerAccount(tx, ctx.workspace.id, accountId, kind);
    }
    const name = body.name ?? category.name;
    if (name.toLowerCase() !== category.name.toLowerCase()) await assertNameFree(tx, ctx.workspace.id, name, category.id);

    const current = {
      name: category.name,
      kind: category.kind,
      account: `${category.account.code} · ${category.account.name}`,
      keywords: category.keywords,
      isActive: category.isActive,
    };
    const next = {
      name,
      kind,
      account: `${account.code} · ${account.name}`,
      keywords: body.keywords ?? category.keywords,
      isActive: body.isActive ?? category.isActive,
    };
    const d = diff(current, next);
    if (!d.changed) return { id: category.id, changed: false };

    await tx.accountCategory.update({
      where: { id: category.id },
      data: { name: next.name, kind: next.kind, accountId: account.id, keywords: next.keywords, isActive: next.isActive },
    });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "CATEGORY",
      entityId: category.id,
      action: "CATEGORY_UPDATED",
      before: { category: category.name, ...d.before },
      after: { category: next.name, ...d.after },
    });
    return { id: category.id, changed: true };
  }, TX_OPTIONS);
}

/** Hard delete is only possible while no transaction has ever used the category. */
export async function deleteCategory(ctx: AdminCtx, categoryId: string) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.accountCategory.findFirst({
      where: { id: categoryId, workspaceId: ctx.workspace.id },
      include: { account: { select: { code: true, name: true } }, _count: { select: { transactions: true } } },
    });
    if (!category) throw notFound("Category not found");
    if (category._count.transactions > 0) {
      throw conflict("Transactions use this category, so it cannot be deleted. Deactivate it instead to keep history intact.");
    }
    await tx.accountCategory.delete({ where: { id: category.id } });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "CATEGORY",
      entityId: category.id,
      action: "CATEGORY_DELETED",
      before: { name: category.name, kind: category.kind, account: `${category.account.code} · ${category.account.name}`, keywords: category.keywords },
    });
    return { id: category.id, deleted: true };
  }, TX_OPTIONS);
}

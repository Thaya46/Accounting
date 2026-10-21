import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { todayInTimeZone } from "@/lib/dates";
import { userRef } from "@/lib/ids";
import { money2 } from "@/lib/money";
import type { FormOptions } from "./types";

/** Accounts, categories, contacts, settings and permission flags for entry forms. */
export async function loadFormOptions(ctx: WorkspaceContext): Promise<FormOptions> {
  const workspaceId = ctx.workspace.id;
  const [accounts, categories, customers, vendors] = await Promise.all([
    prisma.account.findMany({
      where: { workspaceId, isActive: true },
      select: { id: true, code: true, name: true, type: true, subtype: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    prisma.accountCategory.findMany({
      where: { workspaceId, isActive: true, account: { isActive: true } },
      select: { id: true, name: true, kind: true, accountId: true, account: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.customer.findMany({ where: { workspaceId }, select: { name: true }, orderBy: { name: "asc" }, take: 1000 }),
    prisma.vendor.findMany({ where: { workspaceId }, select: { name: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  const s = ctx.workspace.settings;
  return {
    workspaceId,
    currency: ctx.workspace.defaultCurrency,
    today: todayInTimeZone(ctx.workspace.timeZone),
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, accountId: c.accountId, accountName: c.account.name })),
    customers: customers.map((c) => c.name),
    vendors: vendors.map((v) => v.name),
    settings: {
      autoPostEnabled: Boolean(s?.autoPostEnabled),
      autoPostMinConfidence: s?.autoPostMinConfidence ?? 0.9,
      requireApproval: Boolean(s?.requireApproval),
      approvalThreshold: s?.approvalThreshold ? money2(s.approvalThreshold) : null,
    },
    permissions: {
      canCreate: ctx.permissions.has("TRANSACTION_CREATE"),
      canPost: ctx.permissions.has("TRANSACTION_POST"),
      canViewAll: ctx.permissions.has("TRANSACTION_VIEW"),
      canEditDraft: ctx.permissions.has("TRANSACTION_EDIT_DRAFT"),
    },
    user: { id: ctx.user.id, name: ctx.actor.name, ref: userRef(ctx.user.seq) },
  };
}

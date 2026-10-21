import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { todayInTimeZone } from "@/lib/dates";
import type { ParseContext } from "@/lib/ai/parser";

/**
 * Builds the extraction context for one workspace: its own active accounts,
 * categories (with keywords) and known customer / vendor names. Nothing from
 * other workspaces is ever included.
 */
export async function buildParseContext(ctx: WorkspaceContext): Promise<ParseContext> {
  const workspaceId = ctx.workspace.id;
  const [accounts, categories, customers, vendors] = await Promise.all([
    prisma.account.findMany({
      where: { workspaceId, isActive: true },
      select: { id: true, code: true, name: true, type: true, subtype: true, bankName: true },
      orderBy: { code: "asc" },
    }),
    prisma.accountCategory.findMany({
      where: { workspaceId, isActive: true, account: { isActive: true } },
      select: { id: true, name: true, kind: true, accountId: true, keywords: true },
      orderBy: { name: "asc" },
    }),
    prisma.customer.findMany({ where: { workspaceId }, select: { name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.vendor.findMany({ where: { workspaceId }, select: { name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return {
    today: todayInTimeZone(ctx.workspace.timeZone),
    currency: ctx.workspace.defaultCurrency,
    accounts: accounts.map((a) => ({ ...a, type: a.type as string })),
    categories: categories.map((c) => ({ ...c, kind: c.kind })),
    customers: customers.map((c) => c.name),
    vendors: vendors.map((v) => v.name),
  };
}

import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/lib/permissions";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from "@/lib/accounting/coa-template";

/** Ensures the permission catalogue exists (idempotent). */
export async function ensurePermissions(db: Tx) {
  for (const key of ALL_PERMISSIONS) {
    const p = PERMISSIONS[key];
    await db.permission.upsert({
      where: { key },
      create: { key, label: p.label, description: p.description },
      update: { label: p.label, description: p.description },
    });
  }
  return db.permission.findMany();
}

export type WorkspaceInput = {
  name: string;
  code: string;
  companyName: string;
  companyEmail: string;
  country: string;
  defaultCurrency: string;
  fyStartMonth: number;
  timeZone: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
};

/**
 * Creates a workspace with its settings, system roles, default chart of accounts
 * and categories. Must run inside a database transaction.
 */
export async function provisionWorkspace(db: Tx, input: WorkspaceInput, createdById: string | null) {
  const permissions = await ensurePermissions(db);
  const permIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const workspace = await db.workspace.create({
    data: {
      name: input.name,
      code: input.code.toUpperCase(),
      companyName: input.companyName,
      companyEmail: input.companyEmail.toLowerCase(),
      country: input.country,
      defaultCurrency: input.defaultCurrency.toUpperCase(),
      fyStartMonth: input.fyStartMonth,
      timeZone: input.timeZone,
      status: input.status,
      createdById,
      suspendedAt: input.status === "SUSPENDED" ? new Date() : null,
      archivedAt: input.status === "ARCHIVED" ? new Date() : null,
      settings: { create: {} },
    },
  });

  const roles: Record<string, string> = {};
  for (const role of SYSTEM_ROLES) {
    const created = await db.role.create({
      data: {
        workspaceId: workspace.id,
        name: role.name,
        description: role.description,
        isAdmin: role.isAdmin,
        isSystem: true,
        permissions: { create: role.permissions.map((k) => ({ permissionId: permIdByKey.get(k)! })) },
      },
    });
    roles[role.name] = created.id;
  }

  await db.account.createMany({
    data: DEFAULT_ACCOUNTS.map((a) => ({
      workspaceId: workspace.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype ?? null,
      isSystem: a.isSystem ?? false,
      description: a.description ?? null,
    })),
  });
  const accounts = await db.account.findMany({ where: { workspaceId: workspace.id }, select: { id: true, code: true } });
  const accountIdByCode = new Map(accounts.map((a) => [a.code, a.id]));

  await db.accountCategory.createMany({
    data: DEFAULT_CATEGORIES.map(
      (c): Prisma.AccountCategoryCreateManyInput => ({
        workspaceId: workspace.id,
        name: c.name,
        kind: c.kind,
        accountId: accountIdByCode.get(c.accountCode)!,
        keywords: c.keywords,
      }),
    ),
  });

  return { workspace, roles };
}

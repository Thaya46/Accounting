import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import type { PermissionKey } from "@/lib/permissions";
import { TX_OPTIONS, assertGrantable, auditMeta, keysOf, optionalText, permissionKeysSchema, type AdminCtx } from "./common";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isAdmin: boolean;
  isSystem: boolean;
  permissionKeys: PermissionKey[];
  memberCount: number;
  activeMemberCount: number;
  invitationCount: number;
};

export async function listRoles(workspaceId: string): Promise<RoleRow[]> {
  const roles = await prisma.role.findMany({
    where: { workspaceId },
    include: {
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { memberships: true, invitations: true } },
    },
    orderBy: [{ isAdmin: "desc" }, { isSystem: "desc" }, { createdAt: "asc" }],
  });
  const active = await prisma.workspaceMembership.groupBy({ by: ["roleId"], where: { workspaceId, status: "ACTIVE" }, _count: true });
  const activeByRole = new Map(active.map((a) => [a.roleId, a._count]));
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isAdmin: r.isAdmin,
    isSystem: r.isSystem,
    permissionKeys: keysOf(r.permissions),
    memberCount: r._count.memberships,
    activeMemberCount: activeByRole.get(r.id) ?? 0,
    invitationCount: r._count.invitations,
  }));
}

export const roleCreateSchema = z.object({
  name: z.string().trim().min(2, "Role name must be at least 2 characters").max(60),
  description: optionalText(300),
  permissionKeys: permissionKeysSchema.refine((k) => k.length > 0, "Choose at least one permission"),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2, "Role name must be at least 2 characters").max(60).optional(),
  description: optionalText(300).optional(),
  permissionKeys: permissionKeysSchema.refine((k) => k.length > 0, "Choose at least one permission").optional(),
});

async function assertNameFree(workspaceId: string, name: string, exceptId?: string) {
  const clash = await prisma.role.findFirst({
    where: { workspaceId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`A role named "${name}" already exists`);
}

export async function createRole(ctx: AdminCtx, body: z.infer<typeof roleCreateSchema>) {
  assertGrantable(ctx, body.permissionKeys);
  await assertNameFree(ctx.workspace.id, body.name);
  return prisma.$transaction(async (tx) => {
    const perms = await tx.permission.findMany({ where: { key: { in: body.permissionKeys } }, select: { id: true } });
    const role = await tx.role.create({
      data: {
        workspaceId: ctx.workspace.id,
        name: body.name,
        description: body.description,
        isAdmin: false,
        isSystem: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "ROLE",
      entityId: role.id,
      action: "ROLE_CREATED",
      after: { name: role.name, description: role.description, permissions: body.permissionKeys },
    });
    return { id: role.id, name: role.name };
  }, TX_OPTIONS);
}

export async function updateRole(ctx: AdminCtx, roleId: string, body: z.infer<typeof roleUpdateSchema>) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId: ctx.workspace.id },
    include: { permissions: { select: { permission: { select: { key: true } } } } },
  });
  if (!role) throw notFound("Role not found");
  if (role.isAdmin) throw badRequest("The Workspace Admin role always has every permission and cannot be edited");
  if (role.isSystem && body.name !== undefined && body.name !== role.name) throw badRequest("Built-in roles cannot be renamed");
  const currentKeys = keysOf(role.permissions);
  if (!ctx.membership.isAdmin) {
    if (ctx.membership.roleId === role.id) throw forbidden("You cannot change the role you hold. Ask a Workspace Admin.");
    assertGrantable(ctx, [...currentKeys, ...(body.permissionKeys ?? [])]);
  }
  if (body.name !== undefined && body.name.toLowerCase() !== role.name.toLowerCase()) await assertNameFree(ctx.workspace.id, body.name, role.id);

  const before = { name: role.name, description: role.description, permissions: currentKeys };
  const after = {
    name: body.name ?? role.name,
    description: body.description !== undefined ? body.description : role.description,
    permissions: body.permissionKeys ?? currentKeys,
  };
  const d = diff(before, after);
  if (!d.changed) return { id: role.id, changed: false };

  await prisma.$transaction(async (tx) => {
    let permissionsData = {};
    if (body.permissionKeys) {
      const perms = await tx.permission.findMany({ where: { key: { in: body.permissionKeys } }, select: { id: true } });
      permissionsData = { permissions: { deleteMany: {}, create: perms.map((p) => ({ permissionId: p.id })) } };
    }
    await tx.role.update({ where: { id: role.id }, data: { name: after.name, description: after.description, ...permissionsData } });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "ROLE",
      entityId: role.id,
      action: "ROLE_UPDATED",
      before: { role: role.name, ...d.before },
      after: { role: after.name, ...d.after },
    });
  }, TX_OPTIONS);
  return { id: role.id, changed: true };
}

export async function deleteRole(ctx: AdminCtx, roleId: string) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: { id: roleId, workspaceId: ctx.workspace.id },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { memberships: true, invitations: true } },
      },
    });
    if (!role) throw notFound("Role not found");
    if (role.isAdmin || role.isSystem) throw badRequest("Built-in roles cannot be deleted");
    const keys = keysOf(role.permissions);
    if (!ctx.membership.isAdmin) assertGrantable(ctx, keys);
    if (role._count.memberships > 0) {
      throw conflict(`This role is assigned to ${role._count.memberships} member${role._count.memberships === 1 ? "" : "s"}. Move them to another role first.`);
    }
    if (role._count.invitations > 0) {
      throw conflict("This role is referenced by invitation history, so it is kept for the record. You can still edit it.");
    }
    await tx.role.delete({ where: { id: role.id } });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "ROLE",
      entityId: role.id,
      action: "ROLE_DELETED",
      before: { name: role.name, description: role.description, permissions: keys },
    });
    return { id: role.id, deleted: true };
  }, TX_OPTIONS);
}

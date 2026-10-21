import type { Workspace, WorkspaceSettings } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions";
import type { AuthUser } from "./session";

export type WorkspaceContext = {
  user: AuthUser;
  workspace: Workspace & { settings: WorkspaceSettings | null };
  membership: {
    id: string;
    roleId: string;
    roleName: string;
    isAdmin: boolean;
    employeeId: string | null;
    department: string | null;
  };
  permissions: Set<PermissionKey>;
  /** Snapshot used for created-by / audit attribution. Always from the session. */
  actor: { id: string; name: string; email: string };
};

export type WorkspaceAccessError = "NOT_FOUND" | "FORBIDDEN" | "INACTIVE";

export function can(ctx: Pick<WorkspaceContext, "permissions">, permission: PermissionKey) {
  return ctx.permissions.has(permission);
}

/**
 * Resolves the caller's access to a workspace. This is the single choke point
 * for workspace isolation: every workspace page and API route goes through it.
 */
export async function loadWorkspaceContext(
  user: AuthUser,
  workspaceId: string,
): Promise<{ ok: true; ctx: WorkspaceContext } | { ok: false; error: WorkspaceAccessError; workspaceName?: string }> {
  if (!workspaceId || workspaceId.length > 64) return { ok: false, error: "NOT_FOUND" };
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    include: {
      workspace: { include: { settings: true } },
      role: { include: { permissions: { include: { permission: true } } } },
      permissions: { include: { permission: true } },
    },
  });
  if (!membership) return { ok: false, error: "FORBIDDEN" };
  if (membership.status !== "ACTIVE" || user.status !== "ACTIVE") return { ok: false, error: "FORBIDDEN" };
  if (membership.workspace.status !== "ACTIVE") {
    return { ok: false, error: "INACTIVE", workspaceName: membership.workspace.name };
  }

  const keys = new Set<PermissionKey>();
  for (const rp of membership.role.permissions) if (isPermissionKey(rp.permission.key)) keys.add(rp.permission.key);
  for (const mp of membership.permissions) if (isPermissionKey(mp.permission.key)) keys.add(mp.permission.key);

  const { role, permissions: _p, workspace, ...m } = membership;
  return {
    ok: true,
    ctx: {
      user,
      workspace,
      membership: {
        id: m.id,
        roleId: role.id,
        roleName: role.name,
        isAdmin: role.isAdmin,
        employeeId: m.employeeId,
        department: m.department,
      },
      permissions: keys,
      actor: { id: user.id, name: user.name, email: user.email },
    },
  };
}

/** Workspaces the user can switch between. */
export async function listUserWorkspaces(userId: string) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    select: { workspace: { select: { id: true, name: true, code: true, defaultCurrency: true } }, role: { select: { name: true } } },
    orderBy: { workspace: { name: "asc" } },
  });
  return memberships.map((m) => ({ ...m.workspace, roleName: m.role.name }));
}

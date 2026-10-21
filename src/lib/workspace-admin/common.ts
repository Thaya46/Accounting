import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { ApiError, badRequest, conflict, forbidden } from "@/lib/errors";
import { ALL_PERMISSIONS, PERMISSIONS, isPermissionKey, type PermissionKey } from "@/lib/permissions";

/** Context returned by `apiWorkspace` (workspace context + request metadata). */
export type AdminCtx = WorkspaceContext & { meta: { ip: string; userAgent: string } };

export const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export function auditMeta(ctx: AdminCtx) {
  return { workspaceId: ctx.workspace.id, actor: ctx.actor, ip: ctx.meta.ip, userAgent: ctx.meta.userAgent };
}

/** Optional free text: trims, empty → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const permissionKeySchema = z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]);
export const permissionKeysSchema = z
  .array(permissionKeySchema)
  .max(ALL_PERMISSIONS.length * 2)
  .transform((keys) => sortPermissions([...new Set(keys)]));

export function sortPermissions(keys: Iterable<string>): PermissionKey[] {
  const set = new Set(keys);
  return ALL_PERMISSIONS.filter((k) => set.has(k));
}

export function keysOf(links: { permission: { key: string } }[]): PermissionKey[] {
  return sortPermissions(links.map((l) => l.permission.key).filter(isPermissionKey));
}

/**
 * Anti-escalation rule: Workspace Admins may grant anything; other members with
 * USERS_MANAGE may only grant (or manage people holding) permissions they hold.
 */
export function assertGrantable(ctx: WorkspaceContext, keys: Iterable<PermissionKey>) {
  if (ctx.membership.isAdmin) return;
  const missing = [...new Set(keys)].filter((k) => !ctx.permissions.has(k));
  if (missing.length) {
    throw forbidden(`You can only grant permissions you hold yourself. Missing: ${missing.map((k) => PERMISSIONS[k].label).join(", ")}.`);
  }
}

/** Serialises membership changes in a workspace so "last admin" checks cannot race. */
export async function lockMemberships(tx: Tx, workspaceId: string) {
  await tx.$queryRaw`SELECT id FROM workspace_memberships WHERE "workspaceId" = ${workspaceId} FOR UPDATE`;
}

/** Throws unless another ACTIVE Workspace Admin (with an active user account) remains. */
export async function assertAnotherActiveAdmin(tx: Tx, workspaceId: string, excludeMembershipId: string) {
  const others = await tx.workspaceMembership.count({
    where: { workspaceId, status: "ACTIVE", id: { not: excludeMembershipId }, role: { isAdmin: true }, user: { status: "ACTIVE" } },
  });
  if (others === 0) {
    throw conflict("This is the last active Workspace Admin. Give another active member the Workspace Admin role first.");
  }
}

/**
 * The invitation helpers throw plain `Error`s for business rules; surface them
 * as client errors instead of a generic 500.
 */
export function mapInvitationError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof Error) {
    if (/already an active member/i.test(err.message)) throw conflict(err.message);
    if (/Super Admin|Role does not belong/i.test(err.message)) throw badRequest(err.message);
  }
  throw err;
}

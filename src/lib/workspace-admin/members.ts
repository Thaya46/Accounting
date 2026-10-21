import { z } from "zod";
import type { InvitationStatus, MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatDateTime } from "@/lib/dates";
import { userRef } from "@/lib/ids";
import { env } from "@/lib/env";
import { revokeAllSessions } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createInvitation, inviteAndEmail, sendInvitationEmail } from "@/lib/workspaces/invitations";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions";
import {
  TX_OPTIONS,
  assertAnotherActiveAdmin,
  assertGrantable,
  auditMeta,
  keysOf,
  lockMemberships,
  mapInvitationError,
  optionalText,
  permissionKeysSchema,
  sortPermissions,
  type AdminCtx,
} from "./common";

// ───────────────────────────── Read models ─────────────────────────────

export type MemberRow = {
  id: string;
  userId: string;
  ref: string;
  name: string;
  email: string;
  userStatus: "PENDING" | "ACTIVE" | "DISABLED";
  status: MembershipStatus;
  employeeId: string | null;
  department: string | null;
  roleId: string;
  roleName: string;
  roleIsAdmin: boolean;
  rolePermissions: PermissionKey[];
  extraPermissions: PermissionKey[];
  mfaEnabled: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  lastLoginLabel: string | null;
  joinedAt: string;
};

const STATUS_ORDER: Record<MembershipStatus, number> = { ACTIVE: 0, INVITED: 1, DISABLED: 2 };

export async function listMembers(workspaceId: string, timeZone: string): Promise<MemberRow[]> {
  const rows = await prisma.workspaceMembership.findMany({
    where: { workspaceId },
    select: {
      id: true,
      status: true,
      employeeId: true,
      department: true,
      createdAt: true,
      role: { select: { id: true, name: true, isAdmin: true, permissions: { select: { permission: { select: { key: true } } } } } },
      permissions: { select: { permission: { select: { key: true } } } },
      user: {
        select: {
          id: true,
          seq: true,
          name: true,
          email: true,
          status: true,
          passwordHash: true,
          lastLoginAt: true,
          mfaCredential: { select: { enabledAt: true } },
        },
      },
    },
  });
  return rows
    .map((m) => {
      const rolePermissions = keysOf(m.role.permissions);
      const roleSet = new Set<string>(rolePermissions);
      return {
        id: m.id,
        userId: m.user.id,
        ref: userRef(m.user.seq),
        name: m.user.name,
        email: m.user.email,
        userStatus: m.user.status,
        status: m.status,
        employeeId: m.employeeId,
        department: m.department,
        roleId: m.role.id,
        roleName: m.role.name,
        roleIsAdmin: m.role.isAdmin,
        rolePermissions,
        extraPermissions: keysOf(m.permissions).filter((k) => !roleSet.has(k)),
        mfaEnabled: Boolean(m.user.mfaCredential?.enabledAt),
        hasPassword: Boolean(m.user.passwordHash),
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
        lastLoginLabel: m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt, timeZone) : null,
        joinedAt: m.createdAt.toISOString(),
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

export type InvitationRow = {
  id: string;
  email: string;
  name: string;
  roleName: string;
  roleIsAdmin: boolean;
  employeeId: string | null;
  department: string | null;
  permissionKeys: PermissionKey[];
  status: InvitationStatus;
  invitedByName: string;
  createdLabel: string;
  expiresAt: string;
  expiresLabel: string;
  acceptedLabel: string | null;
  emailStatus: "SENT" | "FAILED" | "DEV_LOGGED" | null;
};

/** Effective invitation status: a PENDING invitation past its expiry is EXPIRED. */
export function effectiveInvitationStatus(inv: { status: InvitationStatus; expiresAt: Date }, now = new Date()): InvitationStatus {
  return inv.status === "PENDING" && inv.expiresAt < now ? "EXPIRED" : inv.status;
}

export async function listInvitations(workspaceId: string, timeZone: string): Promise<InvitationRow[]> {
  const invitations = await prisma.workspaceInvitation.findMany({
    where: { workspaceId },
    include: { role: { select: { name: true, isAdmin: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const emails = [...new Set(invitations.map((i) => i.email))];
  const logs = emails.length
    ? await prisma.notificationLog.findMany({
        where: { workspaceId, toEmail: { in: emails }, template: { in: ["USER_INVITATION", "WORKSPACE_ADMIN_INVITATION"] } },
        select: { toEmail: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const now = new Date();
  return invitations.map((i) => {
    // The invitation email is sent right after the invitation row is created.
    const log = logs.find((l) => l.toEmail === i.email && l.createdAt >= i.createdAt);
    return {
      id: i.id,
      email: i.email,
      name: i.name,
      roleName: i.role.name,
      roleIsAdmin: i.role.isAdmin,
      employeeId: i.employeeId,
      department: i.department,
      permissionKeys: sortPermissions(i.permissionKeys.filter(isPermissionKey)),
      status: effectiveInvitationStatus(i, now),
      invitedByName: i.invitedByName,
      createdLabel: formatDateTime(i.createdAt, timeZone),
      expiresAt: i.expiresAt.toISOString(),
      expiresLabel: formatDateTime(i.expiresAt, timeZone),
      acceptedLabel: i.acceptedAt ? formatDateTime(i.acceptedAt, timeZone) : null,
      emailStatus: log?.status ?? null,
    };
  });
}

// ───────────────────────────── Invite ─────────────────────────────

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  employeeId: optionalText(50),
  department: optionalText(80),
  roleId: z.string().trim().min(1, "Choose a role").max(64),
  permissionKeys: permissionKeysSchema.default([]),
});
export type InviteBody = z.infer<typeof inviteSchema>;

async function inviteRateLimit(workspaceId: string) {
  const limit = await rateLimit(`ws-invite:${workspaceId}`, 60, 60 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many invitations were sent from this workspace in the last hour. Try again later.", "RATE_LIMITED");
}

async function loadRoleForGrant(ctx: AdminCtx, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId: ctx.workspace.id },
    include: { permissions: { select: { permission: { select: { key: true } } } } },
  });
  if (!role) throw badRequest("Choose a role from this workspace");
  if (role.isAdmin && !ctx.membership.isAdmin) throw forbidden("Only a Workspace Admin can grant the Workspace Admin role");
  return { role, roleKeys: keysOf(role.permissions) };
}

export async function inviteMember(ctx: AdminCtx, body: InviteBody) {
  const { role, roleKeys } = await loadRoleForGrant(ctx, body.roleId);
  const roleSet = new Set<string>(roleKeys);
  const extras = body.permissionKeys.filter((k) => !roleSet.has(k));
  assertGrantable(ctx, [...roleKeys, ...extras]);

  const existingUser = await prisma.user.findUnique({
    where: { email: body.email },
    select: { platformRole: true, memberships: { where: { workspaceId: ctx.workspace.id }, select: { status: true } } },
  });
  if (existingUser?.platformRole === "SUPER_ADMIN") throw badRequest("Super Admin accounts cannot join workspaces");
  if (existingUser?.memberships[0]?.status === "ACTIVE") throw conflict("This person is already an active member of the workspace");

  await inviteRateLimit(ctx.workspace.id);
  try {
    const { invitation, delivery } = await inviteAndEmail(
      {
        workspaceId: ctx.workspace.id,
        email: body.email,
        name: body.name,
        roleId: role.id,
        employeeId: body.employeeId,
        department: body.department,
        permissionKeys: extras,
      },
      ctx.actor,
      ctx.meta,
    );
    return {
      invitation: { id: invitation.id, email: invitation.email, name: invitation.name, expiresAt: invitation.expiresAt.toISOString() },
      delivery: { ...delivery, outbox: env.devOutbox },
    };
  } catch (err) {
    mapInvitationError(err);
  }
}

// ───────────────────────────── Invitations ─────────────────────────────

export async function resendInvitation(ctx: AdminCtx, invitationId: string) {
  const inv = await prisma.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId: ctx.workspace.id } });
  if (!inv) throw notFound("Invitation not found");
  if (inv.status === "ACCEPTED") throw conflict("This invitation was already accepted");
  const { role, roleKeys } = await loadRoleForGrant(ctx, inv.roleId);
  const extras = inv.permissionKeys.filter(isPermissionKey);
  assertGrantable(ctx, [...roleKeys, ...extras]);
  await inviteRateLimit(ctx.workspace.id);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const created = await createInvitation(
        tx,
        {
          workspaceId: ctx.workspace.id,
          email: inv.email,
          name: inv.name,
          roleId: role.id,
          employeeId: inv.employeeId,
          department: inv.department,
          permissionKeys: extras,
        },
        ctx.actor,
        ctx.meta,
      );
      await audit(tx, {
        ...auditMeta(ctx),
        entityType: "INVITATION",
        entityId: created.invitation.id,
        action: "INVITATION_RESENT",
        before: { invitationId: inv.id, status: effectiveInvitationStatus(inv) },
        after: { invitationId: created.invitation.id, email: inv.email, expiresAt: created.invitation.expiresAt.toISOString() },
      });
      return created;
    }, TX_OPTIONS);
  } catch (err) {
    mapInvitationError(err);
  }

  const delivery = await sendInvitationEmail({
    workspaceId: ctx.workspace.id,
    workspaceName: ctx.workspace.name,
    email: result.invitation.email,
    name: result.invitation.name,
    roleName: result.role.name,
    isAdmin: result.role.isAdmin,
    invitedByName: ctx.actor.name,
    token: result.token,
    ttlHours: result.ttlHours,
    userId: result.user.id,
  });
  return {
    invitation: { id: result.invitation.id, email: result.invitation.email, expiresAt: result.invitation.expiresAt.toISOString() },
    delivery: { ...delivery, outbox: env.devOutbox },
  };
}

export const revokeSchema = z.object({ reason: optionalText(500) }).default({});

export async function revokeInvitation(ctx: AdminCtx, invitationId: string, reason: string | null) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId: ctx.workspace.id }, include: { role: { select: { isAdmin: true, name: true } } } });
    if (!inv) throw notFound("Invitation not found");
    if (inv.status !== "PENDING") throw conflict(`This invitation is already ${inv.status.toLowerCase()}`);
    if (inv.role.isAdmin && !ctx.membership.isAdmin) throw forbidden("Only a Workspace Admin can revoke a Workspace Admin invitation");
    const updated = await tx.workspaceInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "REVOKED" } });
    if (updated.count !== 1) throw conflict("This invitation was just accepted or revoked");
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "INVITATION",
      entityId: inv.id,
      action: "INVITATION_REVOKED",
      reason,
      before: { status: effectiveInvitationStatus(inv), email: inv.email, role: inv.role.name },
      after: { status: "REVOKED", email: inv.email, role: inv.role.name },
    });
    return { id: inv.id, status: "REVOKED" as const };
  }, TX_OPTIONS);
}

// ───────────────────────────── Member changes ─────────────────────────────

export const memberPatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    roleId: z.string().trim().min(1, "Choose a role").max(64),
    permissionKeys: permissionKeysSchema,
    employeeId: optionalText(50),
    department: optionalText(80),
  }),
  z.object({ action: z.literal("disable"), reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500) }),
  z.object({ action: z.literal("reactivate"), reason: optionalText(500) }),
]);
export type MemberPatch = z.infer<typeof memberPatchSchema>;

export async function updateMember(ctx: AdminCtx, membershipId: string, input: MemberPatch) {
  const wsId = ctx.workspace.id;
  const outcome = await prisma.$transaction(async (tx) => {
    await lockMemberships(tx, wsId);
    const m = await tx.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId: wsId },
      include: {
        role: { include: { permissions: { select: { permission: { select: { key: true } } } } } },
        permissions: { select: { permission: { select: { key: true } } } },
        user: { select: { id: true, name: true, email: true, status: true, passwordHash: true, mfaCredential: { select: { enabledAt: true } } } },
      },
    });
    if (!m) throw notFound("Member not found");

    const oldRoleKeys = keysOf(m.role.permissions);
    const oldRoleSet = new Set<string>(oldRoleKeys);
    const oldExtras = keysOf(m.permissions).filter((k) => !oldRoleSet.has(k));
    const isSelf = m.userId === ctx.user.id;
    const label = `${m.user.name} <${m.user.email}>`;

    // Members without the admin role may only manage people whose access is within their own.
    if (!ctx.membership.isAdmin) {
      if (isSelf) throw forbidden("You cannot change your own access. Ask a Workspace Admin.");
      if (m.role.isAdmin) throw forbidden("Only a Workspace Admin can change another Workspace Admin");
      assertGrantable(ctx, [...oldRoleKeys, ...oldExtras]);
    }

    if (input.action === "update") {
      const role = await tx.role.findFirst({
        where: { id: input.roleId, workspaceId: wsId },
        include: { permissions: { select: { permission: { select: { key: true } } } } },
      });
      if (!role) throw badRequest("Choose a role from this workspace");
      if (role.isAdmin && !ctx.membership.isAdmin) throw forbidden("Only a Workspace Admin can grant the Workspace Admin role");
      const roleKeys = keysOf(role.permissions);
      const roleSet = new Set<string>(roleKeys);
      const extras = input.permissionKeys.filter((k) => !roleSet.has(k));
      assertGrantable(ctx, [...roleKeys, ...extras]);

      if (m.role.isAdmin && !role.isAdmin && m.status === "ACTIVE") await assertAnotherActiveAdmin(tx, wsId, m.id);

      const before = { member: label, role: m.role.name, extraPermissions: oldExtras, employeeId: m.employeeId, department: m.department };
      const after = { member: label, role: role.name, extraPermissions: extras, employeeId: input.employeeId, department: input.department };
      const d = diff(before, after);
      if (!d.changed) return { changed: false as const, revokeSessionsFor: null };

      const perms = await tx.permission.findMany({ where: { key: { in: extras } }, select: { id: true } });
      await tx.workspaceMembership.update({
        where: { id: m.id },
        data: {
          roleId: role.id,
          employeeId: input.employeeId,
          department: input.department,
          permissions: { deleteMany: {}, create: perms.map((p) => ({ permissionId: p.id })) },
        },
      });
      // Accepting an invitation applies the invitation's role, so keep pending ones in sync.
      if (m.status === "INVITED") {
        await tx.workspaceInvitation.updateMany({
          where: { workspaceId: wsId, email: m.user.email, status: "PENDING" },
          data: { roleId: role.id, permissionKeys: extras, employeeId: input.employeeId, department: input.department },
        });
      }
      await audit(tx, {
        ...auditMeta(ctx),
        entityType: "MEMBERSHIP",
        entityId: m.id,
        action: role.id !== m.roleId ? "MEMBER_ROLE_CHANGED" : "MEMBER_UPDATED",
        before: { member: label, ...d.before },
        after: { member: label, ...d.after },
      });
      // Workspace Admins must use MFA: a newly promoted admin without MFA signs in again and enrols.
      const promoted = role.isAdmin && !m.role.isAdmin && m.status === "ACTIVE" && !m.user.mfaCredential?.enabledAt;
      return { changed: true as const, revokeSessionsFor: promoted ? m.userId : null };
    }

    if (input.action === "disable") {
      if (isSelf) throw badRequest("You cannot disable your own access");
      if (m.status === "DISABLED") throw conflict("This member is already disabled");
      if (m.role.isAdmin && m.status === "ACTIVE") await assertAnotherActiveAdmin(tx, wsId, m.id);
      await tx.workspaceMembership.update({ where: { id: m.id }, data: { status: "DISABLED" } });
      const revoked = await tx.workspaceInvitation.updateMany({
        where: { workspaceId: wsId, email: m.user.email, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      await audit(tx, {
        ...auditMeta(ctx),
        entityType: "MEMBERSHIP",
        entityId: m.id,
        action: "MEMBER_DISABLED",
        reason: input.reason,
        before: { member: label, status: m.status },
        after: { member: label, status: "DISABLED", ...(revoked.count ? { invitationsRevoked: revoked.count } : {}) },
      });
      return { changed: true as const, disabledUserId: m.userId, revokeSessionsFor: null };
    }

    // reactivate
    if (m.status !== "DISABLED") throw conflict("Only disabled members can be reactivated");
    if (!m.user.passwordHash || m.user.status === "PENDING") {
      throw badRequest(`${m.user.name} never finished accepting their invitation. Send them a new invitation instead.`);
    }
    if (m.user.status === "DISABLED") throw badRequest("This person's account is disabled platform-wide. Contact the Super Admin.");
    await tx.workspaceMembership.update({ where: { id: m.id }, data: { status: "ACTIVE" } });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "MEMBERSHIP",
      entityId: m.id,
      action: "MEMBER_REACTIVATED",
      reason: input.reason,
      before: { member: label, status: "DISABLED" },
      after: { member: label, status: "ACTIVE" },
    });
    return { changed: true as const, revokeSessionsFor: null };
  }, TX_OPTIONS);

  let sessionsRevoked = false;
  if ("disabledUserId" in outcome && outcome.disabledUserId) {
    // Sign the person out everywhere only when no other workspace still grants access.
    const otherActive = await prisma.workspaceMembership.count({
      where: { userId: outcome.disabledUserId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    });
    if (otherActive === 0) {
      await revokeAllSessions(outcome.disabledUserId);
      sessionsRevoked = true;
    }
  }
  if (outcome.revokeSessionsFor) {
    await revokeAllSessions(outcome.revokeSessionsFor);
    sessionsRevoked = true;
  }
  return { changed: outcome.changed, sessionsRevoked };
}

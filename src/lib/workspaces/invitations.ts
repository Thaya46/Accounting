import { prisma, type Tx } from "@/lib/db";
import { audit, type Actor } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { sendEmail } from "@/lib/email/send";
import { accountActivatedEmail, invitationEmail } from "@/lib/email/templates";
import { ApiError, badRequest, conflict } from "@/lib/errors";
import { isPermissionKey } from "@/lib/permissions";

export type InviteInput = {
  workspaceId: string;
  email: string;
  name: string;
  roleId: string;
  employeeId?: string | null;
  department?: string | null;
  permissionKeys?: string[];
};

async function invitationTtlHours(db: Tx) {
  const s = await db.platformSettings.findUnique({ where: { id: "platform" } });
  return s?.invitationTtlHours ?? 72;
}

/**
 * Creates (or refreshes) a pending invitation. A PENDING user and an INVITED
 * membership are created up front so the person appears in the user list and
 * can be attributed in audit history. Returns the raw token — it is only ever
 * placed in the email link; the database stores its hash.
 */
export async function createInvitation(db: Tx, input: InviteInput, invitedBy: Actor, meta?: { ip?: string; userAgent?: string }) {
  const email = input.email.trim().toLowerCase();
  const role = await db.role.findFirst({ where: { id: input.roleId, workspaceId: input.workspaceId } });
  if (!role) throw badRequest("Role does not belong to this workspace");
  const permissionKeys = (input.permissionKeys ?? []).filter(isPermissionKey);

  let user = await db.user.findUnique({ where: { email } });
  if (user?.platformRole === "SUPER_ADMIN") throw badRequest("Super Admin accounts cannot join workspaces");
  if (!user) {
    user = await db.user.create({ data: { email, name: input.name.trim(), status: "PENDING" } });
  }

  const existing = await db.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
  });
  if (existing && existing.status === "ACTIVE") throw conflict("This person is already an active member of the workspace");

  const permissions = await db.permission.findMany({ where: { key: { in: permissionKeys } } });
  const membership = existing
    ? await db.workspaceMembership.update({
        where: { id: existing.id },
        data: {
          roleId: role.id,
          status: "INVITED",
          employeeId: input.employeeId ?? null,
          department: input.department ?? null,
          permissions: { deleteMany: {}, create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      })
    : await db.workspaceMembership.create({
        data: {
          workspaceId: input.workspaceId,
          userId: user.id,
          roleId: role.id,
          status: "INVITED",
          employeeId: input.employeeId ?? null,
          department: input.department ?? null,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });

  // Only one live invitation per person per workspace.
  await db.workspaceInvitation.updateMany({
    where: { workspaceId: input.workspaceId, email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const token = randomToken(32);
  const ttl = await invitationTtlHours(db);
  const invitation = await db.workspaceInvitation.create({
    data: {
      workspaceId: input.workspaceId,
      email,
      name: input.name.trim(),
      roleId: role.id,
      employeeId: input.employeeId ?? null,
      department: input.department ?? null,
      permissionKeys,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttl * 3600 * 1000),
      invitedById: invitedBy.id,
      invitedByName: invitedBy.name,
    },
  });

  await audit(db, {
    workspaceId: input.workspaceId,
    actor: invitedBy,
    entityType: "INVITATION",
    entityId: invitation.id,
    action: role.isAdmin ? "WORKSPACE_ADMIN_INVITED" : "USER_INVITED",
    after: { email, name: input.name, role: role.name, permissionKeys },
    ip: meta?.ip,
    userAgent: meta?.userAgent,
  });

  return { invitation, token, user, membership, role, ttlHours: ttl };
}

/** Sends the invitation email (outside the DB transaction). */
export async function sendInvitationEmail(opts: {
  workspaceId: string;
  workspaceName: string;
  email: string;
  name: string;
  roleName: string;
  isAdmin: boolean;
  invitedByName: string;
  token: string;
  ttlHours: number;
  userId: string;
}) {
  const mail = invitationEmail({
    name: opts.name,
    workspaceName: opts.workspaceName,
    roleName: opts.roleName,
    invitedBy: opts.invitedByName,
    token: opts.token,
    expiresHours: opts.ttlHours,
    isAdmin: opts.isAdmin,
  });
  return sendEmail({
    to: opts.email,
    toName: opts.name,
    ...mail,
    template: opts.isAdmin ? "WORKSPACE_ADMIN_INVITATION" : "USER_INVITATION",
    workspaceId: opts.workspaceId,
    userId: opts.userId,
  });
}

/** Convenience: create + email in one call, for route handlers. */
export async function inviteAndEmail(input: InviteInput, invitedBy: Actor, meta?: { ip?: string; userAgent?: string }) {
  const result = await prisma.$transaction((tx) => createInvitation(tx, input, invitedBy, meta));
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { name: true } });
  const delivery = await sendInvitationEmail({
    workspaceId: input.workspaceId,
    workspaceName: workspace.name,
    email: result.invitation.email,
    name: result.invitation.name,
    roleName: result.role.name,
    isAdmin: result.role.isAdmin,
    invitedByName: invitedBy.name,
    token: result.token,
    ttlHours: result.ttlHours,
    userId: result.user.id,
  });
  return { invitation: result.invitation, delivery };
}

/**
 * Accepts an invitation. The token was only ever delivered to the invited email
 * address, so accepting it verifies that address and activates the account.
 * New users choose a password; existing users confirm theirs.
 */
export async function acceptInvitation(token: string, input: { name: string; password: string }, meta?: { ip?: string; userAgent?: string }) {
  const found = await findInvitationByToken(token);
  if ("error" in found) throw new ApiError(400, found.error!, "INVALID_INVITATION");
  const { invitation } = found;

  const user = await prisma.user.findUnique({ where: { email: invitation.email }, include: { mfaCredential: { select: { enabledAt: true } } } });
  if (!user) throw new ApiError(400, "This invitation is no longer valid.", "INVALID_INVITATION");
  if (user.status === "DISABLED") throw new ApiError(403, "This account has been disabled.", "DISABLED");
  // Only an invited (not disabled) membership can be activated by an invitation.
  const membership = await prisma.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } } });
  if (!membership || membership.status !== "INVITED") throw new ApiError(400, "This invitation is no longer valid. Ask your administrator for a new one.", "INVALID_INVITATION");

  let passwordHash: string | undefined;
  if (user.passwordHash) {
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new ApiError(401, "That password is not correct.", "INVALID_CREDENTIALS");
  } else {
    const parsed = passwordSchema.safeParse(input.password);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Choose a stronger password");
    passwordHash = await hashPassword(input.password);
  }
  const displayName = passwordHash ? input.name.trim() : user.name;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedUserId: user.id },
    });
    if (claimed.count !== 1) throw new ApiError(409, "This invitation has already been used.", "CONFLICT");
    await tx.user.update({
      where: { id: user.id },
      data: { ...(passwordHash ? { passwordHash, name: displayName } : {}), status: "ACTIVE", emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    await tx.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      data: { status: "ACTIVE", roleId: invitation.roleId },
    });
    await audit(tx, {
      workspaceId: invitation.workspaceId,
      actor: { id: user.id, name: displayName, email: user.email },
      entityType: "INVITATION",
      entityId: invitation.id,
      action: "INVITATION_ACCEPTED",
      after: { role: invitation.role.name, emailVerified: true, accountActivated: true },
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  });

  await sendEmail({
    to: user.email,
    toName: displayName,
    ...accountActivatedEmail({ name: displayName, workspaceName: invitation.workspace.name }),
    template: "ACCOUNT_ACTIVATED",
    workspaceId: invitation.workspaceId,
    userId: user.id,
  });

  return { user: { id: user.id, platformRole: user.platformRole, mfaEnabled: Boolean(user.mfaCredential?.enabledAt) }, workspaceId: invitation.workspaceId };
}

export async function findInvitationByToken(token: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { workspace: { select: { id: true, name: true, status: true } }, role: { select: { name: true, isAdmin: true } } },
  });
  if (!invitation) return { error: "This invitation link is invalid." as const };
  if (invitation.status === "ACCEPTED") return { error: "This invitation has already been used." as const };
  if (invitation.status === "REVOKED") return { error: "This invitation was replaced or revoked. Ask for a new one." as const };
  if (invitation.expiresAt < new Date()) return { error: "This invitation has expired. Ask your administrator to resend it." as const };
  if (invitation.workspace.status !== "ACTIVE") return { error: "This workspace is not currently active." as const };
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true, status: true, passwordHash: true } });
  return { invitation, existingUserHasPassword: Boolean(existingUser?.passwordHash) };
}

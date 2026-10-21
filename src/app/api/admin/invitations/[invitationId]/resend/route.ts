import { prisma } from "@/lib/db";
import { badRequest, json, notFound, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createInvitation, sendInvitationEmail } from "@/lib/workspaces/invitations";
import { adminApi, withInvitationErrors } from "@/lib/admin/server";

/**
 * POST /api/admin/invitations/:id/resend — issues a fresh Workspace Admin
 * invitation (new single-use token, new expiry) and emails it. The previous
 * pending invitation for the same person is revoked by createInvitation().
 */
export const POST = route(async (_req, { invitationId }) => {
  const { actor, meta } = await adminApi();

  const old = await prisma.workspaceInvitation.findUnique({
    where: { id: invitationId ?? "" },
    include: { role: { select: { isAdmin: true } }, workspace: { select: { id: true, name: true, status: true } } },
  });
  if (!old) throw notFound("Invitation not found");
  if (!old.role.isAdmin) throw badRequest("Only Workspace Admin invitations can be managed from the Super Admin console.");
  if (old.status === "ACCEPTED") throw badRequest("This invitation has already been accepted.");
  if (old.workspace.status === "ARCHIVED") throw badRequest("This workspace is archived. Activate it before resending invitations.");

  const result = await withInvitationErrors(() =>
    prisma.$transaction(async (tx) => {
      const fresh = await createInvitation(
        tx,
        {
          workspaceId: old.workspaceId,
          email: old.email,
          name: old.name,
          roleId: old.roleId,
          employeeId: old.employeeId,
          department: old.department,
          permissionKeys: old.permissionKeys,
        },
        actor,
        meta,
      );
      if (old.status === "PENDING") {
        // createInvitation already revoked it; this keeps the guarantee explicit.
        await tx.workspaceInvitation.updateMany({ where: { id: old.id, status: "PENDING" }, data: { status: "REVOKED" } });
      }
      await audit(tx, {
        workspaceId: old.workspaceId,
        actor,
        entityType: "INVITATION",
        entityId: fresh.invitation.id,
        action: "INVITATION_RESENT",
        before: { invitationId: old.id, status: old.status, expiresAt: old.expiresAt },
        after: { invitationId: fresh.invitation.id, email: fresh.invitation.email, expiresAt: fresh.invitation.expiresAt },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return fresh;
    }),
  );

  const delivery = await sendInvitationEmail({
    workspaceId: old.workspaceId,
    workspaceName: old.workspace.name,
    email: result.invitation.email,
    name: result.invitation.name,
    roleName: result.role.name,
    isAdmin: result.role.isAdmin,
    invitedByName: actor.name,
    token: result.token,
    ttlHours: result.ttlHours,
    userId: result.user.id,
  });

  return json({
    invitation: {
      id: result.invitation.id,
      email: result.invitation.email,
      name: result.invitation.name,
      expiresAt: result.invitation.expiresAt.toISOString(),
    },
    delivery,
    workspaceActive: old.workspace.status === "ACTIVE",
  });
});

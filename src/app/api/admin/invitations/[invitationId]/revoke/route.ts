import { prisma } from "@/lib/db";
import { ApiError, badRequest, json, notFound, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { adminApi } from "@/lib/admin/server";
import { revokeInvitationSchema } from "@/lib/admin/schemas";

/**
 * POST /api/admin/invitations/:id/revoke — revokes a pending Workspace Admin
 * invitation so its link stops working. If the person has no other live
 * invitation, their not-yet-accepted (INVITED) membership is disabled too.
 */
export const POST = route(async (req, { invitationId }) => {
  const { actor, meta } = await adminApi();
  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest("Request body must be valid JSON");
    }
  }
  const body = revokeInvitationSchema.parse(parsed);

  const inv = await prisma.workspaceInvitation.findUnique({
    where: { id: invitationId ?? "" },
    include: { role: { select: { isAdmin: true, name: true } } },
  });
  if (!inv) throw notFound("Invitation not found");
  if (!inv.role.isAdmin) throw badRequest("Only Workspace Admin invitations can be managed from the Super Admin console.");
  if (inv.status !== "PENDING") throw badRequest(`This invitation is already ${inv.status.toLowerCase()}.`);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "REVOKED" } });
    if (claimed.count !== 1) throw new ApiError(409, "This invitation was changed in the meantime. Refresh and try again.", "CONFLICT");

    let membershipDisabled = false;
    const user = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    if (user) {
      const membership = await tx.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
        select: { id: true, status: true },
      });
      const otherLive = await tx.workspaceInvitation.count({ where: { workspaceId: inv.workspaceId, email: inv.email, status: "PENDING" } });
      if (membership?.status === "INVITED" && otherLive === 0) {
        await tx.workspaceMembership.update({ where: { id: membership.id }, data: { status: "DISABLED" } });
        membershipDisabled = true;
      }
    }

    await audit(tx, {
      workspaceId: inv.workspaceId,
      actor,
      entityType: "INVITATION",
      entityId: inv.id,
      action: "INVITATION_REVOKED",
      reason: body.reason || null,
      before: { status: "PENDING", email: inv.email, role: inv.role.name, expiresAt: inv.expiresAt },
      after: { status: "REVOKED", membershipDisabled },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { membershipDisabled };
  });

  return json({ invitation: { id: inv.id, status: "REVOKED" as const }, ...result });
});

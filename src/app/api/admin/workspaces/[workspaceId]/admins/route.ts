import { prisma } from "@/lib/db";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api";
import { inviteAndEmail } from "@/lib/workspaces/invitations";
import { adminApi, withInvitationErrors } from "@/lib/admin/server";
import { adminInviteSchema } from "@/lib/admin/schemas";

/**
 * POST /api/admin/workspaces/:id/admins — invites an additional Workspace Admin.
 * Creates a pending invitation (audited as WORKSPACE_ADMIN_INVITED) and emails
 * the secure link through Brevo. No password is ever set or sent.
 */
export const POST = route(async (req, { workspaceId }) => {
  const { actor, meta } = await adminApi();
  const body = await parseBody(req, adminInviteSchema);

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId ?? "" }, select: { id: true, status: true } });
  if (!ws) throw notFound("Workspace not found");
  if (ws.status === "ARCHIVED") throw badRequest("This workspace is archived. Activate it before inviting administrators.");

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { platformRole: true } });
  if (existing?.platformRole === "SUPER_ADMIN") {
    throw badRequest("Super Admin accounts cannot be Workspace Admins. Use a different email address.", { field: "email" });
  }

  const role = await prisma.role.findFirst({
    where: { workspaceId: ws.id, isAdmin: true },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!role) throw badRequest("This workspace has no administrator role.");

  const { invitation, delivery } = await withInvitationErrors(() =>
    inviteAndEmail({ workspaceId: ws.id, email: body.email, name: body.name, roleId: role.id }, actor, meta),
  );

  return json(
    {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        expiresAt: invitation.expiresAt.toISOString(),
      },
      delivery,
      workspaceActive: ws.status === "ACTIVE",
    },
    201,
  );
});

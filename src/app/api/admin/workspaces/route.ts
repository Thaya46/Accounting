import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, conflict, json, parseBody, parseQuery, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { workspaceRef } from "@/lib/ids";
import { provisionWorkspace } from "@/lib/workspaces/provision";
import { createInvitation, sendInvitationEmail } from "@/lib/workspaces/invitations";
import { adminApi, withInvitationErrors } from "@/lib/admin/server";
import { workspaceCreateSchema } from "@/lib/admin/schemas";
import { listWorkspaces } from "@/lib/admin/queries";

const listQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

/** GET /api/admin/workspaces?q=&status=&page= — paginated workspace list with member/admin summaries. */
export const GET = route(async (req) => {
  await adminApi();
  const query = parseQuery(req, listQuery);
  return json(await listWorkspaces(query));
});

/**
 * POST /api/admin/workspaces — provisions a workspace (settings, roles, chart of
 * accounts, categories), creates a pending Workspace Admin invitation and
 * records WORKSPACE_CREATED, all in one transaction. The invitation email is
 * sent after commit; its delivery result is returned for display.
 */
export const POST = route(async (req) => {
  const { user, actor, meta } = await adminApi();
  const body = await parseBody(req, workspaceCreateSchema);

  // Fast pre-checks with friendly messages (the transaction re-validates via constraints).
  const [codeTaken, adminUser] = await Promise.all([
    prisma.workspace.findUnique({ where: { code: body.code }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: body.adminEmail }, select: { platformRole: true } }),
  ]);
  if (codeTaken) throw conflict(`Workspace code ${body.code} is already in use. Choose another code.`, { field: "code" });
  if (adminUser?.platformRole === "SUPER_ADMIN") {
    throw badRequest("Super Admin accounts cannot be Workspace Admins. Use a different email address.", { field: "adminEmail" });
  }

  const created = await withInvitationErrors(() =>
    prisma.$transaction(
      async (tx) => {
        const { workspace, roles } = await provisionWorkspace(
          tx,
          {
            name: body.name,
            code: body.code,
            companyName: body.companyName,
            companyEmail: body.companyEmail,
            country: body.country,
            defaultCurrency: body.defaultCurrency,
            fyStartMonth: body.fyStartMonth,
            timeZone: body.timeZone,
            status: body.status,
          },
          user.id,
        );
        const adminRoleId = roles["Workspace Admin"];
        if (!adminRoleId) throw new Error("Workspace Admin role was not provisioned");

        const invite = await createInvitation(
          tx,
          { workspaceId: workspace.id, email: body.adminEmail, name: body.adminName, roleId: adminRoleId },
          actor,
          meta,
        );

        await audit(tx, {
          workspaceId: workspace.id,
          actor,
          entityType: "WORKSPACE",
          entityId: workspace.id,
          action: "WORKSPACE_CREATED",
          after: {
            ref: workspaceRef(workspace.seq),
            name: workspace.name,
            code: workspace.code,
            companyName: workspace.companyName,
            companyEmail: workspace.companyEmail,
            country: workspace.country,
            defaultCurrency: workspace.defaultCurrency,
            fyStartMonth: workspace.fyStartMonth,
            timeZone: workspace.timeZone,
            status: workspace.status,
            adminInvitation: { email: invite.invitation.email, name: invite.invitation.name },
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { workspace, invite };
      },
      { timeout: 60_000, maxWait: 10_000 },
    ),
  );

  const { workspace, invite } = created;
  const delivery = await sendInvitationEmail({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    email: invite.invitation.email,
    name: invite.invitation.name,
    roleName: invite.role.name,
    isAdmin: invite.role.isAdmin,
    invitedByName: actor.name,
    token: invite.token,
    ttlHours: invite.ttlHours,
    userId: invite.user.id,
  });

  return json(
    {
      workspace: {
        id: workspace.id,
        ref: workspaceRef(workspace.seq),
        code: workspace.code,
        name: workspace.name,
        status: workspace.status,
      },
      invitation: {
        id: invite.invitation.id,
        email: invite.invitation.email,
        name: invite.invitation.name,
        expiresAt: invite.invitation.expiresAt.toISOString(),
      },
      delivery,
    },
    201,
  );
});

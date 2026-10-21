import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { inviteMember, inviteSchema, listMembers } from "@/lib/workspace-admin/members";

/** GET — every member of the workspace (active, invited and disabled). */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  return json({ members: await listMembers(ctx.workspace.id, ctx.workspace.timeZone) });
});

/**
 * POST — invite a person. Creates a pending user + INVITED membership and emails
 * a one-time invitation link via Brevo. Passwords are never set or emailed.
 * Body: { name, email, employeeId?, department?, roleId, permissionKeys?[] }
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  const body = await parseBody(req, inviteSchema);
  const result = await inviteMember(ctx, body);
  return json(result, 201);
});

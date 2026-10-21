import { apiWorkspace, json, route } from "@/lib/api";
import { listInvitations } from "@/lib/workspace-admin/members";

/** GET — invitation history (pending, accepted, revoked, expired) with email delivery status. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  return json({ invitations: await listInvitations(ctx.workspace.id, ctx.workspace.timeZone) });
});

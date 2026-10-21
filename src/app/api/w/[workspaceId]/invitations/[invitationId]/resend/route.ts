import { apiWorkspace, json, route } from "@/lib/api";
import { resendInvitation } from "@/lib/workspace-admin/members";

/** POST — issue a fresh invitation link (the previous one is revoked) and email it. */
export const POST = route(async (_req, { workspaceId, invitationId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  return json(await resendInvitation(ctx, invitationId!), 201);
});

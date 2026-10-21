import { apiWorkspace, badRequest, json, route } from "@/lib/api";
import { revokeInvitation, revokeSchema } from "@/lib/workspace-admin/members";

/** POST — revoke a pending invitation. Body (optional): { reason? } */
export const POST = route(async (req, { workspaceId, invitationId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("Request body must be valid JSON");
    }
  }
  const body = revokeSchema.parse(raw);
  return json(await revokeInvitation(ctx, invitationId!, body.reason));
});

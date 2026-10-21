import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { memberPatchSchema, updateMember } from "@/lib/workspace-admin/members";

/**
 * PATCH — change a member.
 * Body (one of):
 *   { action: "update", roleId, permissionKeys[], employeeId?, department? }
 *   { action: "disable", reason }
 *   { action: "reactivate", reason? }
 */
export const PATCH = route(async (req, { workspaceId, membershipId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  const body = await parseBody(req, memberPatchSchema);
  return json(await updateMember(ctx, membershipId!, body));
});

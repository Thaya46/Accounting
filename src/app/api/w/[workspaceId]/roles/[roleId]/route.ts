import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { deleteRole, roleUpdateSchema, updateRole } from "@/lib/workspace-admin/roles";

/** PATCH — edit a non-admin role. Body: { name?, description?, permissionKeys?[] } (built-in roles keep their name). */
export const PATCH = route(async (req, { workspaceId, roleId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  const body = await parseBody(req, roleUpdateSchema);
  return json(await updateRole(ctx, roleId!, body));
});

/** DELETE — remove a custom role that has never been assigned or used in an invitation. */
export const DELETE = route(async (_req, { workspaceId, roleId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  return json(await deleteRole(ctx, roleId!));
});

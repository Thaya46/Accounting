import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { createRole, listRoles, roleCreateSchema } from "@/lib/workspace-admin/roles";

/** GET — workspace roles with their permission keys and usage counts. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  return json({ roles: await listRoles(ctx.workspace.id) });
});

/** POST — create a custom role. Body: { name, description?, permissionKeys[] } */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "USERS_MANAGE");
  const body = await parseBody(req, roleCreateSchema);
  return json({ role: await createRole(ctx, body) }, 201);
});

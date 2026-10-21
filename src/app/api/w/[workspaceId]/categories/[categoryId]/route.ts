import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { categoryUpdateSchema, deleteCategory, updateCategory } from "@/lib/workspace-admin/categories";

/** PATCH — edit / (de)activate a category. Body: any of { name, kind, accountId, keywords[], isActive } */
export const PATCH = route(async (req, { workspaceId, categoryId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, categoryUpdateSchema);
  return json(await updateCategory(ctx, categoryId!, body));
});

/** DELETE — only for categories no transaction has used (otherwise deactivate). */
export const DELETE = route(async (_req, { workspaceId, categoryId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  return json(await deleteCategory(ctx, categoryId!));
});

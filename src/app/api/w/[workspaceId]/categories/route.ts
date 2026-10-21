import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { categoryCreateSchema, createCategory, listCategories } from "@/lib/workspace-admin/categories";

/** GET — income and expense categories with their ledger account, keywords and usage. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  return json({ categories: await listCategories(ctx.workspace.id) });
});

/** POST — create a category. Body: { name, kind: "INCOME"|"EXPENSE", accountId, keywords?[], isActive? } */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, categoryCreateSchema);
  return json({ category: await createCategory(ctx, body) }, 201);
});

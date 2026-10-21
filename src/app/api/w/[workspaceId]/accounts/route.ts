import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { accountCreateSchema, createAccount, listAccounts } from "@/lib/workspace-admin/accounts";

/** GET — chart of accounts with current (all-time, posted) balances in natural direction. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, ["ACCOUNTS_MANAGE", "REPORTS_VIEW"]);
  return json({ currency: ctx.workspace.defaultCurrency, accounts: await listAccounts(ctx.workspace.id) });
});

/**
 * POST — create an account.
 * Body: { code, name, type, subtype?, description?, bankName?, accountNumberLast4?, isActive? }
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, accountCreateSchema);
  return json({ account: await createAccount(ctx, body) }, 201);
});

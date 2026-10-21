import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { accountUpdateSchema, updateAccount } from "@/lib/workspace-admin/accounts";

/**
 * PATCH — edit an account. Body: any of { code, name, type, subtype, description, bankName, accountNumberLast4, isActive }.
 * System accounts cannot be retyped or deactivated; the type is locked once the account is used.
 */
export const PATCH = route(async (req, { workspaceId, accountId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, accountUpdateSchema);
  return json(await updateAccount(ctx, accountId!, body));
});

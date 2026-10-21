import { apiWorkspace, json, route } from "@/lib/api";
import { PAYMENT_ACCOUNT_SUBTYPES } from "@/lib/ai/parser";
import { buildParseContext } from "@/lib/transactions/ai-context";

/**
 * GET — what the in-app assistant needs to understand answers for this
 * workspace: its active categories, payment accounts and known contacts, the
 * workspace's "today" and currency, and whether posting needs approval.
 */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_CREATE");
  const pc = await buildParseContext(ctx);
  const s = ctx.workspace.settings;
  return json({
    today: pc.today,
    currency: pc.currency,
    workspaceName: ctx.workspace.name,
    accounts: pc.accounts.filter((a) => PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? "")),
    categories: pc.categories,
    customers: pc.customers ?? [],
    vendors: pc.vendors ?? [],
    canPost: ctx.permissions.has("TRANSACTION_POST"),
    approval: { required: Boolean(s?.requireApproval), threshold: s?.approvalThreshold ? s.approvalThreshold.toString() : null },
  });
});

import { apiWorkspace, json, route } from "@/lib/api";
import { listApprovalQueue } from "@/lib/transactions/queries";

/** GET — transactions pending approval and approved transactions awaiting posting. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_APPROVE");
  const queue = await listApprovalQueue(ctx);
  return json({ ...queue, canPost: ctx.permissions.has("TRANSACTION_POST"), isAdmin: ctx.membership.isAdmin });
});

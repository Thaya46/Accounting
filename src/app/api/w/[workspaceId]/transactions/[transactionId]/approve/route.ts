import { apiWorkspace, forbidden, json, parseBody, route } from "@/lib/api";
import { decideApproval } from "@/lib/accounting/transactions";
import { assertActionable, serializeSaved } from "@/lib/transactions/access";
import { approveBodySchema } from "@/lib/transactions/schemas";

/**
 * POST — approve or reject a submitted transaction, optionally posting it
 * straight away. Self-approval is blocked by the service for non-admins.
 */
export const POST = route(async (req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_APPROVE");
  await assertActionable(ctx, transactionId, { approverAccess: true });
  const body = await parseBody(req, approveBodySchema);
  if (body.post && body.decision === "APPROVED" && !ctx.permissions.has("TRANSACTION_POST")) {
    throw forbidden("Missing permission: TRANSACTION_POST");
  }
  const txn = await decideApproval(ctx, transactionId, body.decision, body.comment ?? null, Boolean(body.post) && body.decision === "APPROVED");
  return json({ transaction: serializeSaved(txn) });
});

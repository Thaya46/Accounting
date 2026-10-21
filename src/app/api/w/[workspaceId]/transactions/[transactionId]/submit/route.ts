import { apiWorkspace, json, route } from "@/lib/api";
import { submitTransaction } from "@/lib/accounting/transactions";
import { assertActionable, serializeSaved } from "@/lib/transactions/access";

/** POST — submit a draft (or rejected) transaction for approval. */
export const POST = route(async (_req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId, ["TRANSACTION_CREATE", "TRANSACTION_EDIT_DRAFT"]);
  await assertActionable(ctx, transactionId);
  const txn = await submitTransaction(ctx, transactionId);
  return json({ transaction: serializeSaved(txn) });
});

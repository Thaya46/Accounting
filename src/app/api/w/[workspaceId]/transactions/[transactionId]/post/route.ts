import { apiWorkspace, json, route } from "@/lib/api";
import { postTransaction } from "@/lib/accounting/transactions";
import { assertActionable, serializeSaved } from "@/lib/transactions/access";

/** POST — post a draft (when no approval is required) or an approved transaction to the ledger. */
export const POST = route(async (_req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_POST");
  await assertActionable(ctx, transactionId, { approverAccess: true });
  const txn = await postTransaction(ctx, transactionId);
  return json({ transaction: serializeSaved(txn) });
});

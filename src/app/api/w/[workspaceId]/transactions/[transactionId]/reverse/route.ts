import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { reverseTransaction } from "@/lib/accounting/transactions";
import { assertActionable, serializeSaved } from "@/lib/transactions/access";
import { reverseBodySchema } from "@/lib/transactions/schemas";

/** POST — reverse a posted transaction with a mirror-image journal entry. A reason is required. */
export const POST = route(async (req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_REVERSE");
  await assertActionable(ctx, transactionId);
  const body = await parseBody(req, reverseBodySchema);
  const txn = await reverseTransaction(ctx, transactionId, body.reason, body.date ?? null);
  return json({ transaction: serializeSaved(txn) });
});

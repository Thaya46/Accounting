import { apiWorkspace, json, notFound, parseBody, route } from "@/lib/api";
import { updateDraft } from "@/lib/accounting/transactions";
import { isoDate } from "@/lib/dates";
import { money2 } from "@/lib/money";
import { assertActionable, serializeSaved } from "@/lib/transactions/access";
import { loadTransactionDetail } from "@/lib/transactions/detail";
import { checkDuplicates } from "@/lib/transactions/duplicates";
import { updateTransactionBodySchema } from "@/lib/transactions/schemas";

/** GET — full transaction detail (own, or any with TRANSACTION_VIEW). Not visible → 404. */
export const GET = route(async (_req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId);
  const detail = await loadTransactionDetail(ctx, transactionId);
  if (!detail) throw notFound("Transaction not found");
  return json({ transaction: detail.view, abilities: detail.abilities });
});

/** PATCH — edit a draft or rejected transaction. Writes an UPDATED audit event with the reason. */
export const PATCH = route(async (req, { workspaceId, transactionId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_EDIT_DRAFT");
  await assertActionable(ctx, transactionId);
  const body = await parseBody(req, updateTransactionBodySchema);
  const txn = await updateDraft(ctx, transactionId, body.input, body.reason ?? null);
  const duplicates = await checkDuplicates(
    ctx,
    { type: txn.type, amount: money2(txn.amount), date: isoDate(txn.date), description: txn.description },
    txn.id,
  );
  return json({ transaction: serializeSaved(txn), duplicates });
});

import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { createTransaction } from "@/lib/accounting/transactions";
import { isoDate } from "@/lib/dates";
import { money2 } from "@/lib/money";
import { serializeSaved } from "@/lib/transactions/access";
import { checkDuplicates } from "@/lib/transactions/duplicates";
import { parseFilters } from "@/lib/transactions/filters";
import { listTransactions } from "@/lib/transactions/queries";
import { createTransactionBodySchema } from "@/lib/transactions/schemas";

/**
 * GET — transaction list. Members with TRANSACTION_VIEW see the whole
 * workspace (and may filter by `by`); everyone else sees only their own
 * entries. `mine=1` restricts to the caller's own entries.
 */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId);
  const sp = req.nextUrl.searchParams;
  const filters = parseFilters(Object.fromEntries(sp.entries()));
  const mineOnly = sp.get("mine") === "1" || !ctx.permissions.has("TRANSACTION_VIEW");
  const result = await listTransactions(ctx, filters, { mineOnly });
  return json({ ...result, scope: mineOnly ? "mine" : "all", filters });
});

/**
 * POST — create a transaction. Attribution comes only from the session; the
 * body cannot carry created-by or workspace fields. Possible duplicates are
 * returned as warnings.
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_CREATE");
  const body = await parseBody(req, createTransactionBodySchema);
  const aiEntry = body.source !== "MANUAL";
  const txn = await createTransaction(ctx, body.input, {
    source: body.source,
    intent: body.intent,
    rawInput: aiEntry ? (body.rawInput ?? null) : null,
    aiConfidence: aiEntry ? (body.aiConfidence ?? null) : null,
  });
  const duplicates = await checkDuplicates(
    ctx,
    { type: txn.type, amount: money2(txn.amount), date: isoDate(txn.date), description: txn.description },
    txn.id,
  );
  return json(
    {
      transaction: serializeSaved(txn),
      duplicates,
      autoPosted: body.intent === "auto" && txn.status === "POSTED",
    },
    201,
  );
});

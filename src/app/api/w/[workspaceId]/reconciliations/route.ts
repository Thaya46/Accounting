import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiWorkspace, json, notFound, parseBody, parseQuery, route } from "@/lib/api";
import { completeReconciliation, isReconcilable, listReconciliations, reconciliationInputSchema } from "@/lib/accounting/reconciliation";

const listQuery = z.object({ accountId: z.string().trim().min(1).max(64) });

/** GET /api/w/:workspaceId/reconciliations?accountId= — reconciliation history for one account. */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, ["REPORTS_VIEW", "ACCOUNTS_MANAGE"]);
  const { accountId } = parseQuery(req, listQuery);
  const account = await prisma.account.findFirst({ where: { id: accountId, workspaceId: ctx.workspace.id }, select: { id: true, subtype: true } });
  if (!account) throw notFound("Account not found");
  const items = isReconcilable(account.subtype) ? await listReconciliations(ctx.workspace.id, account.id, 200) : [];
  return json({ items });
});

/**
 * POST /api/w/:workspaceId/reconciliations
 * Body: { accountId, statementDate: "YYYY-MM-DD", statementBalance: "12345.67", lineIds: string[], acceptDifference?: boolean }
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, reconciliationInputSchema);
  const result = await completeReconciliation(ctx, body);
  return json({ reconciliation: result }, 201);
});

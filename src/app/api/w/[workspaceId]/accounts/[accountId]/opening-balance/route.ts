import { apiWorkspace, badRequest, json, parseBody, route } from "@/lib/api";
import { setOpeningBalance } from "@/lib/accounting/opening";
import { openingBalanceSchema } from "@/lib/workspace-admin/accounts";
import { parseISODate, todayInTimeZone } from "@/lib/dates";

/**
 * POST — set an account's opening balance (posts an OPENING journal against
 * Opening Balance Equity; a previous opening entry is reversed first).
 * Body: { amount: "25000.00" (natural direction, may be negative), date: "YYYY-MM-DD" }
 */
export const POST = route(async (req, { workspaceId, accountId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, openingBalanceSchema);
  try {
    parseISODate(body.date);
  } catch {
    throw badRequest("Choose a valid date");
  }
  if (body.date > todayInTimeZone(ctx.workspace.timeZone)) throw badRequest("The opening balance date cannot be in the future");
  const result = await setOpeningBalance(ctx, accountId!, body.amount, body.date);
  return json(result, 201);
});

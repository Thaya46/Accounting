import { ApiError, apiWorkspace, json, parseBody, route } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { checkDuplicates } from "@/lib/transactions/duplicates";
import { duplicateCheckSchema } from "@/lib/transactions/schemas";

/**
 * POST — possible duplicates for an entry being typed (same type and amount
 * within the workspace's duplicate window, similar description). Matches the
 * caller may not view are redacted.
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, ["TRANSACTION_CREATE", "TRANSACTION_EDIT_DRAFT"]);
  const limit = await rateLimit(`dup-check:${ctx.user.id}`, 240, 60);
  if (!limit.allowed) throw new ApiError(429, `Too many checks. Try again in ${limit.retryAfter}s.`, "RATE_LIMITED");
  const body = await parseBody(req, duplicateCheckSchema);
  const duplicates = await checkDuplicates(ctx, { type: body.type, amount: body.amount, date: body.date, description: body.description }, body.excludeId ?? undefined);
  return json({ duplicates });
});

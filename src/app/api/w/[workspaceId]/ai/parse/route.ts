import { ApiError, apiWorkspace, json, parseBody, route } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { aiProviderStatus, extractTransaction } from "@/lib/ai/provider";
import { buildParseContext } from "@/lib/transactions/ai-context";
import { checkDuplicates } from "@/lib/transactions/duplicates";
import { parseBodySchema } from "@/lib/transactions/schemas";

/**
 * POST — extract a transaction proposal from a typed or dictated sentence.
 * Nothing is saved: the result is shown for review. Missing fields come back
 * as clarification questions instead of guesses.
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_CREATE");
  const limit = await rateLimit(`ai-parse:${ctx.user.id}`, 60, 60);
  if (!limit.allowed) {
    throw new ApiError(429, `You're analysing entries very quickly. Try again in ${limit.retryAfter}s.`, "RATE_LIMITED");
  }
  const body = await parseBody(req, parseBodySchema);
  const parseCtx = await buildParseContext(ctx);
  const parsed = await extractTransaction(body.text, parseCtx);
  const duplicates =
    parsed.type && parsed.amount
      ? await checkDuplicates(ctx, { type: parsed.type, amount: parsed.amount, date: parsed.date, description: parsed.description })
      : [];
  const provider = aiProviderStatus();
  return json({ parsed, duplicates, provider: { provider: provider.provider, configured: provider.configured, model: provider.model } });
});

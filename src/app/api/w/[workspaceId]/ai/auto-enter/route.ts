import { ApiError, apiWorkspace, json, parseBody, route } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { extractTransaction } from "@/lib/ai/provider";
import { buildParseContext } from "@/lib/transactions/ai-context";
import { createTransaction, type TransactionInput } from "@/lib/accounting/transactions";
import { formatMoney } from "@/lib/money";
import { z } from "zod";

const autoEnterSchema = z.object({
  text: z.string().trim().min(2, "Enter at least a few words").max(1000),
  source: z.enum(["VOICE", "TEXT"]).default("TEXT"),
});

export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "TRANSACTION_CREATE");
  const limit = await rateLimit(`auto-enter:${ctx.user.id}`, 60, 60);
  if (!limit.allowed) {
    throw new ApiError(429, `Too many requests. Please wait ${limit.retryAfter}s.`, "RATE_LIMITED");
  }

  const body = await parseBody(req, autoEnterSchema);
  const parseCtx = await buildParseContext(ctx);
  const parsed = await extractTransaction(body.text, parseCtx);

  // If extraction succeeded with high/normal confidence and has type + amount
  if (parsed.type && parsed.amount && (parsed.paymentAccountId || parsed.categoryId || parsed.toAccountId)) {
    const voucherType =
      parsed.type === "EXPENSE"
        ? "PAYMENT"
        : parsed.type === "INCOME"
          ? "RECEIPT"
          : parsed.type === "TRANSFER"
            ? "CONTRA"
            : "JOURNAL";

    const input: TransactionInput = {
      type: parsed.type,
      date: parsed.date,
      amount: parsed.amount,
      currency: parsed.currency || ctx.workspace.defaultCurrency,
      description: parsed.description || (parsed.type === "EXPENSE" ? "Quick Expense" : "Quick Income"),
      categoryId: parsed.categoryId ?? undefined,
      creditAccountId:
        parsed.type === "EXPENSE" || parsed.type === "TRANSFER"
          ? (parsed.paymentAccountId ?? undefined)
          : undefined,
      debitAccountId:
        parsed.type === "INCOME"
          ? (parsed.paymentAccountId ?? undefined)
          : parsed.type === "TRANSFER"
            ? (parsed.toAccountId ?? undefined)
            : undefined,
      paymentMethod: parsed.paymentMethod ?? undefined,
      customerName: parsed.counterpartyRole === "customer" ? parsed.counterparty : undefined,
      vendorName: parsed.counterpartyRole === "vendor" ? parsed.counterparty : undefined,
    };

    try {
      const created = await createTransaction(ctx, input, {
        source: body.source,
        intent: ctx.permissions.has("TRANSACTION_POST") ? "post" : "draft",
        rawInput: body.text,
        aiConfidence: parsed.confidence,
        extra: {
          voucherType,
        },
      });

      const amountFormatted = formatMoney(parsed.amount, ctx.workspace.defaultCurrency);
      const message = `Recorded: ${amountFormatted} for ${parsed.description} via ${parsed.paymentAccountName ?? "Account"} (${voucherType} #${created.number})`;

      return json({
        ok: true,
        posted: created.status === "POSTED",
        transaction: created,
        voucherType,
        message,
        parsed,
      });
    } catch (err: unknown) {
      // If posting failed due to approval required or missing field, return parsed so user can review
      return json({
        ok: true,
        posted: false,
        parsed,
        error: err instanceof Error ? err.message : "Requires review",
      });
    }
  }

  // Not enough information to auto-post, send parsed state with questions
  return json({
    ok: true,
    posted: false,
    parsed,
    clarification: parsed.clarifications[0] ?? "Could not fully understand the entry. Please review details.",
  });
});

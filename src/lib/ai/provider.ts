/**
 * Configurable AI extraction. The model only proposes field values; every value
 * is validated against the workspace's own accounts and categories, and the
 * rule-based parser fills gaps or takes over entirely when the provider is
 * unavailable. Nothing here posts anything — the user reviews first.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { parseISODate } from "@/lib/dates";
import { parseTransactionText, PAYMENT_ACCOUNT_SUBTYPES, type ParseContext, type ParsedEntry } from "./parser";

const llmResultSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).nullable(),
  amount: z.number().positive().nullable(),
  currency: z.string().length(3).nullable(),
  date: z.string().nullable(),
  description: z.string(),
  category: z.string().nullable(),
  paymentAccount: z.string().nullable(),
  toAccount: z.string().nullable(),
  counterparty: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  questions: z.array(z.string()),
});
type LlmResult = z.infer<typeof llmResultSchema>;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

function jsonSchema(ctx: ParseContext) {
  const categoryNames = ctx.categories.map((c) => c.name);
  const accountNames = ctx.accounts.filter((a) => PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? "")).map((a) => a.name);
  return {
    type: "object",
    additionalProperties: false,
    required: ["type", "amount", "currency", "date", "description", "category", "paymentAccount", "toAccount", "counterparty", "paymentMethod", "confidence", "questions"],
    properties: {
      type: nullable({ type: "string", enum: ["EXPENSE", "INCOME", "TRANSFER"] }),
      amount: nullable({ type: "number" }),
      currency: nullable({ type: "string" }),
      date: nullable({ type: "string", description: "YYYY-MM-DD" }),
      description: { type: "string" },
      category: nullable(categoryNames.length ? { type: "string", enum: categoryNames } : { type: "string" }),
      paymentAccount: nullable(accountNames.length ? { type: "string", enum: accountNames } : { type: "string" }),
      toAccount: nullable(accountNames.length ? { type: "string", enum: accountNames } : { type: "string" }),
      counterparty: nullable({ type: "string" }),
      paymentMethod: nullable({ type: "string", enum: ["Bank Transfer", "UPI", "Cash", "Card", "Cheque", "Transfer"] }),
      confidence: { type: "number" },
      questions: { type: "array", items: { type: "string" } },
    },
  };
}

function systemPrompt() {
  return [
    "You extract a single bookkeeping transaction from a short sentence that a user typed or dictated.",
    "Return only the JSON object described by the schema.",
    "Rules:",
    "- type: EXPENSE when money was paid out, INCOME when money was received, TRANSFER when money moved between the user's own accounts. null if unclear.",
    "- amount: the numeric amount (e.g. 75000 for '₹75,000', 250000 for '2.5 lakh'). null if absent or ambiguous.",
    "- date: resolve relative dates (today, yesterday, last Monday) against the provided today's date. null if no date is mentioned.",
    "- category, paymentAccount, toAccount: choose only from the provided lists; null if none clearly applies. Never invent names.",
    "- paymentAccount is the account that paid (expense), received (income), or sent (transfer). toAccount is only for transfers.",
    "- description: a short title-case purpose, e.g. 'Office Electricity' or 'Website Development'.",
    "- counterparty: the customer (income) or vendor (expense) if named, else null.",
    "- questions: one short clarification question for each important field you left null. Do not guess.",
    "- confidence: 0..1 for the whole extraction.",
  ].join("\n");
}

function userPrompt(text: string, ctx: ParseContext) {
  const accounts = ctx.accounts
    .filter((a) => PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? ""))
    .map((a) => `${a.name} (${a.subtype})`)
    .join("; ");
  const expense = ctx.categories.filter((c) => c.kind === "EXPENSE").map((c) => c.name).join("; ");
  const income = ctx.categories.filter((c) => c.kind === "INCOME").map((c) => c.name).join("; ");
  return `Today's date: ${ctx.today}\nDefault currency: ${ctx.currency}\nPayment accounts: ${accounts}\nExpense categories: ${expense}\nIncome categories: ${income}\n\nSentence: """${text.slice(0, 1000)}"""`;
}

let anthropicClient: Anthropic | null = null;

async function extractWithClaude(text: string, ctx: ParseContext): Promise<LlmResult> {
  anthropicClient ??= new Anthropic({ apiKey: env.ai.anthropicKey, timeout: 30_000, maxRetries: 1 });
  const response = await anthropicClient.beta.messages.create({
    model: env.ai.anthropicModel,
    max_tokens: 4000,
    // Server-side fallback: if a safeguard declines, the API retries on a suitable model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(),
    output_config: { effort: "low", format: { type: "json_schema", schema: jsonSchema(ctx) } },
    messages: [{ role: "user", content: userPrompt(text, ctx) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI provider declined this request");
  if (response.stop_reason === "max_tokens") throw new Error("The AI response was cut off");
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("The AI provider returned no text");
  return llmResultSchema.parse(JSON.parse(block.text));
}

async function extractWithOpenAICompatible(text: string, ctx: ParseContext): Promise<LlmResult> {
  const { openaiBaseUrl, openaiKey, openaiModel } = env.ai;
  if (!openaiBaseUrl || !openaiModel) throw new Error("OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL are required");
  const res = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(openaiKey ? { authorization: `Bearer ${openaiKey}` } : {}) },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${systemPrompt()}\nJSON keys: ${Object.keys(llmResultSchema.shape).join(", ")}.` },
        { role: "user", content: userPrompt(text, ctx) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("The AI endpoint returned no content");
  return llmResultSchema.parse(JSON.parse(content));
}

const byName = <T extends { name: string }>(items: T[], name: string | null) =>
  name ? (items.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()) ?? null) : null;

/** Validates the model's proposal against workspace data and fills gaps from the rules parser. */
function reconcile(llm: LlmResult, rules: ParsedEntry, ctx: ParseContext, engine: "anthropic" | "openai"): ParsedEntry {
  const notes: string[] = [];
  const clarifications = [...llm.questions];
  const missing: string[] = [];

  const type = llm.type ?? rules.type;
  if (!llm.type && rules.type) notes.push("Type filled in by the built-in parser.");

  let amount = llm.amount != null ? llm.amount.toFixed(2) : rules.amount;
  if (amount && rules.amount && llm.amount != null && Math.abs(Number(rules.amount) - llm.amount) > 0.005) {
    notes.push(`The AI read ${llm.amount} but the text parser read ${rules.amount} — please check the amount.`);
  }
  if (amount && Number(amount) <= 0) amount = null;

  let date = llm.date;
  let dateAssumed = false;
  try {
    if (date) parseISODate(date);
  } catch {
    date = null;
  }
  if (!date) {
    date = rules.date;
    dateAssumed = rules.dateAssumed;
  }

  const kindCategories = ctx.categories.filter((c) => !type || type === "TRANSFER" || c.kind === type);
  let category = type === "TRANSFER" ? null : byName(kindCategories, llm.category);
  if (!category && type !== "TRANSFER" && rules.categoryId) {
    category = ctx.categories.find((c) => c.id === rules.categoryId && (!type || c.kind === type)) ?? null;
  }
  const paymentAccounts = ctx.accounts.filter((a) => PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? ""));
  const payment = byName(paymentAccounts, llm.paymentAccount) ?? (rules.paymentAccountId ? (ctx.accounts.find((a) => a.id === rules.paymentAccountId) ?? null) : null);
  const to = type === "TRANSFER" ? (byName(paymentAccounts, llm.toAccount) ?? (rules.toAccountId ? (ctx.accounts.find((a) => a.id === rules.toAccountId) ?? null) : null)) : null;

  if (!type) missing.push("type");
  if (!amount) missing.push("amount");
  if ((type === "INCOME" || type === "EXPENSE") && !category) missing.push("category");
  if (!payment) missing.push(type === "INCOME" ? "receiving account" : type === "TRANSFER" ? "from account" : "payment account");
  if (type === "TRANSFER" && !to) missing.push("to account");
  if (missing.length && !clarifications.length) clarifications.push(...rules.clarifications);

  const completeness = 1 - missing.length / 5;
  const confidence = Math.round(Math.min(llm.confidence, 0.98) * completeness * 100) / 100;

  return {
    type,
    amount,
    currency: (llm.currency ?? rules.currency).toUpperCase(),
    date,
    dateAssumed,
    description: llm.description?.trim() || rules.description,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    paymentAccountId: payment?.id ?? null,
    paymentAccountName: payment?.name ?? null,
    toAccountId: to?.id ?? null,
    toAccountName: to?.name ?? null,
    counterparty: llm.counterparty ?? rules.counterparty,
    counterpartyRole: (llm.counterparty ?? rules.counterparty) ? (type === "INCOME" ? "customer" : "vendor") : null,
    paymentMethod: llm.paymentMethod ?? rules.paymentMethod,
    confidence: missing.length ? Math.min(confidence, 0.6) : confidence,
    fieldConfidence: {
      type: type ? 0.9 : 0,
      amount: amount ? 0.95 : 0,
      date: dateAssumed ? 0.6 : 0.95,
      category: category || type === "TRANSFER" ? 0.9 : 0,
      account: payment ? 0.9 : 0,
    },
    missing,
    clarifications: [...new Set(clarifications)],
    notes: [...notes, ...(dateAssumed ? ["No date mentioned — using today's date."] : [])],
    engine,
  };
}

export function aiProviderStatus() {
  const { provider, anthropicKey, anthropicModel, openaiBaseUrl, openaiModel } = env.ai;
  if (provider === "anthropic") return { provider, configured: Boolean(anthropicKey), model: anthropicModel };
  if (provider === "openai") return { provider, configured: Boolean(openaiBaseUrl && openaiModel), model: openaiModel };
  return { provider: "none" as const, configured: true, model: "built-in rules" };
}

/** Extracts a transaction proposal from free text using the configured provider, with rule-based fallback. */
export async function extractTransaction(text: string, ctx: ParseContext): Promise<ParsedEntry> {
  const rules = parseTransactionText(text, ctx);
  const status = aiProviderStatus();
  if (status.provider === "none" || !status.configured) return rules;
  try {
    const llm = status.provider === "anthropic" ? await extractWithClaude(text, ctx) : await extractWithOpenAICompatible(text, ctx);
    return reconcile(llm, rules, ctx, status.provider);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.warn(`[ai] ${status.provider} extraction failed, using rules: ${reason}`);
    return { ...rules, notes: [...rules.notes, "The AI service was unavailable, so the built-in parser was used."] };
  }
}

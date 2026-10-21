/**
 * Interactive-mode conversation logic (pure, runs in the browser): which
 * question comes next, what to ask, and how to understand each answer. Answers
 * that can't be understood produce a gentle retry — never a guess.
 */
import {
  descriptionFromAnswer,
  extractAmounts,
  extractDate,
  isSkipAnswer,
  matchCategory,
  matchPaymentAccount,
  parseSpokenAmount,
  parseTransactionText,
  parseTypeAnswer,
  wordsToNumber,
  type ParseContextAccount,
  type ParseContextCategory,
  type ParsedType,
} from "@/lib/ai/parser";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";

export type AssistantContext = {
  today: string;
  currency: string;
  workspaceName: string;
  accounts: ParseContextAccount[];
  categories: ParseContextCategory[];
  customers: string[];
  vendors: string[];
  canPost: boolean;
  approval: { required: boolean; threshold: string | null };
};

export type Draft = {
  type?: ParsedType;
  amount?: string;
  date?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  /** undefined = not asked yet, null = skipped */
  counterparty?: string | null;
  description?: string;
  suggestedDescription?: string;
};

export type StepId = "type" | "amount" | "date" | "category" | "account" | "toAccount" | "counterparty" | "description" | "confirm";

export type Chip = { label: string; value: string };

export const EDITABLE_FIELDS: { step: Exclude<StepId, "confirm">; label: string }[] = [
  { step: "type", label: "Type" },
  { step: "amount", label: "Amount" },
  { step: "date", label: "Date" },
  { step: "category", label: "Category" },
  { step: "account", label: "Account" },
  { step: "toAccount", label: "To account" },
  { step: "counterparty", label: "Customer / vendor" },
  { step: "description", label: "Description" },
];

export function stepsFor(d: Draft): StepId[] {
  if (d.type === "TRANSFER") return ["type", "amount", "date", "account", "toAccount", "description", "confirm"];
  return ["type", "amount", "date", "category", "account", "counterparty", "description", "confirm"];
}

function isAnswered(step: StepId, d: Draft): boolean {
  switch (step) {
    case "type":
      return Boolean(d.type);
    case "amount":
      return Boolean(d.amount);
    case "date":
      return Boolean(d.date);
    case "category":
      return Boolean(d.categoryId);
    case "account":
      return Boolean(d.fromAccountId);
    case "toAccount":
      return Boolean(d.toAccountId);
    case "counterparty":
      return d.counterparty !== undefined;
    case "description":
      return Boolean(d.description);
    case "confirm":
      return false;
  }
}

export function nextStep(d: Draft): StepId {
  return stepsFor(d).find((s) => !isAnswered(s, d)) ?? "confirm";
}

export function progress(d: Draft) {
  const steps = stepsFor(d).filter((s) => s !== "confirm");
  const done = steps.filter((s) => isAnswered(s, d)).length;
  return { done, total: steps.length };
}

/** Clears a field (and anything that depends on it) so it is asked again. */
export function clearField(d: Draft, step: StepId): Draft {
  const next = { ...d };
  switch (step) {
    case "type":
      return { amount: d.amount, date: d.date, description: d.description };
    case "amount":
      delete next.amount;
      break;
    case "date":
      delete next.date;
      break;
    case "category":
      delete next.categoryId;
      break;
    case "account":
      delete next.fromAccountId;
      if (d.type === "TRANSFER") delete next.toAccountId;
      break;
    case "toAccount":
      delete next.toAccountId;
      break;
    case "counterparty":
      delete next.counterparty;
      break;
    case "description":
      delete next.description;
      break;
  }
  return next;
}

function accountsFor(step: "account" | "toAccount", d: Draft, ctx: AssistantContext) {
  return ctx.accounts.filter((a) => {
    if (step === "toAccount") return a.id !== d.fromAccountId && ["BANK", "CASH", "WALLET", "CREDIT_CARD"].includes(a.subtype ?? "");
    if (d.type === "INCOME") return !["CREDIT_CARD", "PAYABLE"].includes(a.subtype ?? "");
    if (d.type === "EXPENSE") return a.subtype !== "RECEIVABLE";
    return ["BANK", "CASH", "WALLET", "CREDIT_CARD"].includes(a.subtype ?? "");
  });
}

const accountName = (ctx: AssistantContext, id?: string) => ctx.accounts.find((a) => a.id === id)?.name ?? "";
const categoryName = (ctx: AssistantContext, id?: string) => ctx.categories.find((c) => c.id === id)?.name ?? "";

export function question(step: StepId, d: Draft, ctx: AssistantContext): { text: string; chips: Chip[] } {
  const t = d.type;
  switch (step) {
    case "type":
      return {
        text: "Is this an income, an expense, or a transfer between your accounts?",
        chips: [
          { label: "Expense", value: "expense" },
          { label: "Income", value: "income" },
          { label: "Transfer", value: "transfer" },
        ],
      };
    case "amount":
      return {
        text: t === "INCOME" ? "How much did you receive?" : t === "TRANSFER" ? "How much did you move?" : "How much did you spend?",
        chips: [],
      };
    case "date":
      return {
        text: "When did it happen? You can say today, yesterday, or a date.",
        chips: [
          { label: "Today", value: "today" },
          { label: "Yesterday", value: "yesterday" },
          { label: "2 days ago", value: "2 days ago" },
        ],
      };
    case "category": {
      const kind = t === "INCOME" ? "INCOME" : "EXPENSE";
      const options = ctx.categories.filter((c) => c.kind === kind);
      return {
        text:
          kind === "INCOME"
            ? "What was this income for? For example services, sales or interest."
            : "What was it for? For example rent, electricity, fuel or salaries.",
        chips: options.slice(0, 14).map((c) => ({ label: c.name, value: c.name })),
      };
    }
    case "account":
      return {
        text: t === "INCOME" ? "Which account received the money?" : t === "TRANSFER" ? "Which account did the money come from?" : "Which account did you pay from?",
        chips: accountsFor("account", d, ctx).map((a) => ({ label: a.name, value: a.name })),
      };
    case "toAccount":
      return { text: "And which account did it go to?", chips: accountsFor("toAccount", d, ctx).map((a) => ({ label: a.name, value: a.name })) };
    case "counterparty": {
      const known = (t === "INCOME" ? ctx.customers : ctx.vendors).slice(0, 4);
      return {
        text: t === "INCOME" ? "Who paid you? Say skip if you don't want to add a customer." : "Who did you pay? Say skip if you don't want to add a vendor.",
        chips: [{ label: "Skip", value: "skip" }, ...known.map((n) => ({ label: n, value: n }))],
      };
    }
    case "description": {
      const suggestion = d.suggestedDescription || categoryName(ctx, d.categoryId) || (t === "TRANSFER" ? `Transfer to ${accountName(ctx, d.toAccountId)}` : "");
      return {
        text: suggestion ? `Last one: a short description. Say skip and I'll use "${suggestion}".` : "Last one: please give a short description.",
        chips: suggestion ? [{ label: `Use "${suggestion}"`, value: "skip" }] : [],
      };
    }
    case "confirm":
      return { text: `${summary(d, ctx)} Shall I save it?`, chips: [] };
  }
}

export type Interpretation = { ok: true; patch: Partial<Draft>; ack?: string } | { ok: false; retry: string };

const TYPE_ACK: Record<ParsedType, string> = { EXPENSE: "Got it, an expense.", INCOME: "Great, an income.", TRANSFER: "Okay, a transfer." };

function titleCase(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function interpret(step: StepId, answer: string, d: Draft, ctx: AssistantContext): Interpretation {
  const text = answer.trim();
  if (!text) return { ok: false, retry: "Sorry, I didn't hear anything. Could you say that again?" };

  switch (step) {
    case "type": {
      const type = parseTypeAnswer(text);
      if (!type) return { ok: false, retry: "Sorry, was that an income, an expense or a transfer?" };
      const patch: Partial<Draft> = { type };
      // A full sentence ("I spent 500 on petrol yesterday") can answer several questions at once.
      if (text.split(/\s+/).length >= 3) {
        const p = parseTransactionText(text, ctx);
        if (p.type === type) {
          if (p.amount) patch.amount = p.amount;
          if (!p.dateAssumed) patch.date = p.date;
          if (p.categoryId) patch.categoryId = p.categoryId;
          if (p.paymentAccountId) patch.fromAccountId = p.paymentAccountId;
          if (p.toAccountId) patch.toAccountId = p.toAccountId;
          if (p.counterparty) patch.counterparty = p.counterparty;
          if (p.description && p.categoryId) patch.suggestedDescription = p.description;
        }
      }
      return { ok: true, patch, ack: TYPE_ACK[type] };
    }
    case "amount": {
      const spoken = parseSpokenAmount(text);
      if (spoken && "ambiguous" in spoken) {
        return { ok: false, retry: `I only heard “${spoken.text}”. Please say the full amount, for example fifteen thousand five hundred.` };
      }
      if (spoken && "multiple" in spoken) {
        return { ok: false, retry: `I heard more than one number: ${spoken.multiple.join(" and ")}. Which one is the amount?` };
      }
      if (spoken && "value" in spoken) {
        if (spoken.value > 1e11) return { ok: false, retry: "That amount looks too large. Could you say it again?" };
        return { ok: true, patch: { amount: spoken.value.toFixed(2) }, ack: `${formatMoney(spoken.value.toFixed(2), ctx.currency)}.` };
      }
      const hits = extractAmounts(text);
      const marked = hits.filter((h) => h.marked);
      const pool = marked.length ? marked : hits;
      const values = [...new Set(pool.map((h) => h.value))];
      if (values.length > 1) return { ok: false, retry: `I heard more than one amount: ${pool.map((h) => h.raw).join(" and ")}. Which one is it?` };
      const value = values[0] ?? wordsToNumber(text)?.value;
      if (!value || value <= 0) return { ok: false, retry: "Sorry, I didn't catch the amount. Please say a number, like 2,500." };
      if (value > 1e11) return { ok: false, retry: "That amount looks too large. Could you say it again?" };
      return { ok: true, patch: { amount: value.toFixed(2) }, ack: `${formatMoney(value.toFixed(2), ctx.currency)}.` };
    }
    case "date": {
      const r = extractDate(text, ctx.today);
      if (r.assumed) return { ok: false, retry: "I didn't understand the date. Say today, yesterday, or a date like 12 October." };
      if (r.date > ctx.today) return { ok: false, retry: "That date is in the future. When did it actually happen?" };
      return { ok: true, patch: { date: r.date }, ack: r.date === ctx.today ? "Today." : `${formatDate(r.date)}.` };
    }
    case "category": {
      const kind = d.type === "INCOME" ? "INCOME" : "EXPENSE";
      const c = matchCategory(text, ctx.categories, kind);
      if (!c) return { ok: false, retry: "I couldn't match that to a category. Please pick one of the options below." };
      const isJustTheName = text.toLowerCase() === c.name.toLowerCase();
      const suggestion = isJustTheName ? c.name : descriptionFromAnswer(text) || c.name;
      return { ok: true, patch: { categoryId: c.id, suggestedDescription: suggestion }, ack: `${c.name}.` };
    }
    case "account":
    case "toAccount": {
      const options = accountsFor(step, d, ctx);
      const a = matchPaymentAccount(text, options);
      if (!a) return { ok: false, retry: "I couldn't find that account. Please choose one of the options below." };
      return { ok: true, patch: step === "account" ? { fromAccountId: a.id } : { toAccountId: a.id }, ack: `${a.name}.` };
    }
    case "counterparty": {
      if (isSkipAnswer(text)) return { ok: true, patch: { counterparty: null }, ack: "No problem." };
      const known = d.type === "INCOME" ? ctx.customers : ctx.vendors;
      const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\b(pvt|private|ltd|limited|llp|inc)\b/g, "").replace(/\s+/g, " ").trim();
      const name = known.find((k) => norm(k) === norm(text)) ?? titleCase(text.replace(/^(to|from|paid|it was)\s+/i, "")).slice(0, 120);
      return { ok: true, patch: { counterparty: name }, ack: `${name}.` };
    }
    case "description": {
      const suggestion = d.suggestedDescription || categoryName(ctx, d.categoryId) || (d.type === "TRANSFER" ? `Transfer to ${accountName(ctx, d.toAccountId)}` : "");
      if (isSkipAnswer(text) || /^use\b/i.test(text)) {
        if (!suggestion) return { ok: false, retry: "Please give a short description." };
        return { ok: true, patch: { description: suggestion } };
      }
      const desc = text.replace(/[.!?]+$/, "").slice(0, 200);
      return { ok: true, patch: { description: desc[0].toUpperCase() + desc.slice(1) } };
    }
    case "confirm":
      return { ok: false, retry: "" };
  }
}

export function summary(d: Draft, ctx: AssistantContext): string {
  const kind = d.type === "INCOME" ? "An income" : d.type === "TRANSFER" ? "A transfer" : "An expense";
  const amount = d.amount ? formatMoney(d.amount, ctx.currency) : "";
  const when = d.date ? (d.date === ctx.today ? "today" : `on ${formatDate(d.date)}`) : "";
  const cat = d.categoryId ? ` for ${categoryName(ctx, d.categoryId)}` : "";
  const acct =
    d.type === "TRANSFER"
      ? ` from ${accountName(ctx, d.fromAccountId)} to ${accountName(ctx, d.toAccountId)}`
      : d.type === "INCOME"
        ? `, received in ${accountName(ctx, d.fromAccountId)}`
        : `, paid from ${accountName(ctx, d.fromAccountId)}`;
  const cp = d.counterparty ? (d.type === "INCOME" ? `, from ${d.counterparty}` : `, to ${d.counterparty}`) : "";
  return `${kind} of ${amount} ${when}${cat}${acct}${cp}.`;
}

export function summaryRows(d: Draft, ctx: AssistantContext): { label: string; value: string; step: StepId }[] {
  const rows: { label: string; value: string; step: StepId }[] = [
    { label: "Type", value: d.type === "INCOME" ? "Income" : d.type === "TRANSFER" ? "Transfer" : "Expense", step: "type" },
    { label: "Amount", value: d.amount ? formatMoney(d.amount, ctx.currency, { decimals: true }) : "—", step: "amount" },
    { label: "Date", value: d.date ? formatDate(d.date) : "—", step: "date" },
  ];
  if (d.type !== "TRANSFER") rows.push({ label: "Category", value: categoryName(ctx, d.categoryId) || "—", step: "category" });
  rows.push({ label: d.type === "INCOME" ? "Received in" : d.type === "TRANSFER" ? "From" : "Paid from", value: accountName(ctx, d.fromAccountId) || "—", step: "account" });
  if (d.type === "TRANSFER") rows.push({ label: "To", value: accountName(ctx, d.toAccountId) || "—", step: "toAccount" });
  if (d.type !== "TRANSFER") rows.push({ label: d.type === "INCOME" ? "Customer" : "Vendor", value: d.counterparty || "—", step: "counterparty" });
  rows.push({ label: "Description", value: d.description || "—", step: "description" });
  return rows;
}

export function needsApproval(d: Draft, ctx: AssistantContext) {
  if (ctx.approval.required) return true;
  return Boolean(ctx.approval.threshold && d.amount && dec(d.amount).gte(dec(ctx.approval.threshold)));
}

const METHOD: Record<string, string> = { BANK: "Bank Transfer", CASH: "Cash", WALLET: "UPI", CREDIT_CARD: "Card" };

/** The API payload for the confirmed draft (attribution is added by the server from the session). */
export function toTransactionInput(d: Draft, ctx: AssistantContext) {
  const from = ctx.accounts.find((a) => a.id === d.fromAccountId);
  const base = { type: d.type!, date: d.date!, amount: d.amount!, description: d.description! };
  if (d.type === "TRANSFER") return { ...base, debitAccountId: d.toAccountId, creditAccountId: d.fromAccountId, paymentMethod: "Transfer" };
  const common = { ...base, categoryId: d.categoryId, paymentMethod: METHOD[from?.subtype ?? ""] ?? null };
  if (d.type === "INCOME") return { ...common, debitAccountId: d.fromAccountId, ...(d.counterparty ? { customerName: d.counterparty } : {}) };
  return { ...common, creditAccountId: d.fromAccountId, ...(d.counterparty ? { vendorName: d.counterparty } : {}) };
}

/**
 * Rule-based natural-language transaction extraction. Always available — it is
 * the fallback when no AI provider is configured or the provider fails.
 *
 * Principle: never guess. When the amount, type, category or account cannot be
 * determined with confidence, the field is left empty and a clarification
 * question is returned instead.
 */
import { addDays, isoDate, parseISODate } from "@/lib/dates";

export type ParseContextAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string | null;
  bankName?: string | null;
};

export type ParseContextCategory = {
  id: string;
  name: string;
  kind: "INCOME" | "EXPENSE";
  accountId: string;
  keywords: string[];
};

export type ParseContext = {
  today: string; // YYYY-MM-DD in the workspace time zone
  currency: string; // workspace default
  accounts: ParseContextAccount[];
  categories: ParseContextCategory[];
  customers?: string[];
  vendors?: string[];
};

export type ParsedType = "EXPENSE" | "INCOME" | "TRANSFER";

export type ParsedEntry = {
  type: ParsedType | null;
  amount: string | null;
  currency: string;
  date: string;
  dateAssumed: boolean;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  /** Expense: paying account (credit). Income: receiving account (debit). Transfer: source. */
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  /** Transfer destination. */
  toAccountId: string | null;
  toAccountName: string | null;
  counterparty: string | null;
  counterpartyRole: "customer" | "vendor" | null;
  paymentMethod: string | null;
  confidence: number;
  fieldConfidence: Record<"type" | "amount" | "date" | "category" | "account", number>;
  missing: string[];
  clarifications: string[];
  notes: string[];
  engine: "rules" | "anthropic" | "openai";
};

export const PAYMENT_ACCOUNT_SUBTYPES = ["BANK", "CASH", "WALLET", "CREDIT_CARD", "RECEIVABLE", "PAYABLE"];

// ───────────────────────────── Amounts ─────────────────────────────

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/₹|\brs\.?|\binr\b|\brupees?\b/i, "INR"],
  [/\$|\busd\b|\bdollars?\b/i, "USD"],
  [/€|\beur\b|\beuros?\b/i, "EUR"],
  [/£|\bgbp\b|\bpounds?\b/i, "GBP"],
  [/\baed\b|\bdirhams?\b/i, "AED"],
];

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
};

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const WORD_SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, crore: 1e7, crores: 1e7, million: 1e6 };

/** "two thousand five hundred" → 2500 (voice transcripts sometimes spell numbers). */
export function wordsToNumber(text: string): { value: number; match: string } | null {
  const re = /\b((?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|crores?|million|and)[\s-]*)+)\b/i;
  const m = re.exec(text);
  if (!m) return null;
  const words = m[1].toLowerCase().split(/[\s-]+/).filter((w) => w && w !== "and");
  if (!words.some((w) => w in WORD_NUMBERS)) return null;
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (w in WORD_NUMBERS) current += WORD_NUMBERS[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w in WORD_SCALES) {
      total += (current || 1) * WORD_SCALES[w];
      current = 0;
    }
  }
  const value = total + current;
  return value > 0 ? { value, match: m[1].trim() } : null;
}

type AmountHit = { value: number; currency: string | null; index: number; raw: string; marked: boolean };

export function extractAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const re =
    /(₹|rs\.?|inr|\$|usd|€|eur|£|gbp|aed)?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(k|thousand|lakhs?|lacs?|crores?|cr|mn|million|m)?\b\s?(rupees?|rs\.?|inr|dollars?|usd|euros?|eur|pounds?|gbp|dirhams?|aed)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [raw, pre, num, mult, post] = m;
    if (!num) continue;
    const after = text.slice(m.index + raw.length, m.index + raw.length + 6).toLowerCase();
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    // Skip things that look like dates or ordinals: "15th", "15/10", "2026-10-15", "10:30".
    if (/^(st|nd|rd|th)\b/.test(after) || /^[\/\-:]\d/.test(after) || /[\/\-:]$/.test(before)) continue;
    if (!pre && !mult && !post && /^(19|20)\d{2}$/.test(num)) continue; // bare years
    let value = Number(num.replace(/,/g, ""));
    if (mult) value *= MULTIPLIERS[mult.toLowerCase()] ?? 1;
    const curTok = (pre || post || "").trim();
    let currency: string | null = null;
    for (const [rx, code] of CURRENCY_TOKENS) if (curTok && rx.test(curTok)) currency = code;
    hits.push({ value, currency, index: m.index, raw: raw.trim(), marked: Boolean(pre || post || mult) });
  }
  if (!hits.length) {
    const w = wordsToNumber(text);
    if (w) {
      const idx = text.toLowerCase().indexOf(w.match.toLowerCase());
      const tail = text.slice(idx + w.match.length, idx + w.match.length + 10);
      let currency: string | null = null;
      for (const [rx, code] of CURRENCY_TOKENS) if (rx.test(tail)) currency = code;
      hits.push({ value: w.value, currency, index: idx, raw: w.match, marked: true });
    }
  }
  return hits.filter((h) => h.value > 0 && Number.isFinite(h.value));
}

// ───────────────────────────── Dates ─────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function safeDate(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  try {
    parseISODate(s);
    return s;
  } catch {
    return null;
  }
}

export function extractDate(text: string, today: string): { date: string; assumed: boolean; matched?: string } {
  const t = text.toLowerCase();
  const year = Number(today.slice(0, 4));
  const pickYear = (m: number, d: number) => {
    const s = safeDate(year, m, d);
    // A date without a year that lands in the future most likely refers to last year.
    if (s && s > addDays(today, 1)) return safeDate(year - 1, m, d);
    return s;
  };

  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) {
    const s = safeDate(+m[1], +m[2], +m[3]);
    if (s) return { date: s, assumed: false, matched: m[0] };
  }
  m = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(t); // day-first (DD/MM/YYYY)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const s = safeDate(y, +m[2], +m[1]);
    if (s) return { date: s, assumed: false, matched: m[0] };
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b,?\s*(\d{4})?/.exec(t);
  if (m) {
    const s = m[3] ? safeDate(+m[3], MONTHS[m[2]], +m[1]) : pickYear(MONTHS[m[2]], +m[1]);
    if (s) return { date: s, assumed: false, matched: m[0] };
  }
  m = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(\d{4})?/.exec(t);
  if (m) {
    const s = m[3] ? safeDate(+m[3], MONTHS[m[1]], +m[2]) : pickYear(MONTHS[m[1]], +m[2]);
    if (s) return { date: s, assumed: false, matched: m[0] };
  }
  if (/\bday before yesterday\b/.test(t)) return { date: addDays(today, -2), assumed: false, matched: "day before yesterday" };
  if (/\byesterday\b/.test(t)) return { date: addDays(today, -1), assumed: false, matched: "yesterday" };
  m = /\b(\d+|one|two|three|four|five|six|seven)\s+days?\s+ago\b/.exec(t);
  if (m) {
    const n = Number.isNaN(+m[1]) ? WORD_NUMBERS[m[1]] : +m[1];
    return { date: addDays(today, -n), assumed: false, matched: m[0] };
  }
  m = /\b(last|on|this past)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const cur = parseISODate(today).getUTCDay();
    let delta = (cur - target + 7) % 7;
    if (delta === 0 && m[1] === "last") delta = 7;
    return { date: addDays(today, -delta), assumed: false, matched: m[0] };
  }
  if (/\b(today|this morning|this afternoon|this evening|tonight|just now|now)\b/.test(t)) {
    return { date: today, assumed: false, matched: "today" };
  }
  return { date: today, assumed: true };
}

// ───────────────────────────── Type ─────────────────────────────

const EXPENSE_WORDS = /\b(spent|spend|spending|paid|pay|paying|bought|buy|purchased?|expenses?|bill|cost|costs|charged|debited|gave|settled|donated|reimbursed to)\b/;
const INCOME_WORDS = /\b(received|receive|receiving|got|earned|earn|collected|collect|income|credited|sold|revenue|deposit from|payment from|invoice paid|advance from)\b/;
const TRANSFER_WORDS = /\b(transferr?ed|transfer|moved|move|withdrew|withdraw|withdrawn|withdrawal|deposited cash|cash deposit|topped up|top up|top-up)\b/;

// ───────────────────────────── Accounts ─────────────────────────────

const SUBTYPE_ALIASES: Record<string, string[]> = {
  CASH: ["cash", "petty cash", "cash in hand"],
  WALLET: ["upi", "gpay", "google pay", "phonepe", "phone pe", "paytm", "wallet", "bhim"],
  CREDIT_CARD: ["credit card", "company card", "corporate card"],
  RECEIVABLE: [],
  PAYABLE: ["on credit", "unpaid", "to be paid later"],
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasesFor(a: ParseContextAccount): string[] {
  const out = new Set<string>();
  const name = a.name.toLowerCase();
  out.add(name);
  out.add(a.code.toLowerCase());
  if (a.bankName) out.add(a.bankName.toLowerCase());
  const stripped = name.replace(/\b(account|a\/c|acct|current|savings?|primary)\b/g, "").replace(/\s+/g, " ").trim();
  // A bare generic word ("bank", "card") must not single out one account.
  const generic = ["bank", "card", "wallet", "credit card", "bank card"];
  if (stripped.length > 2 && !generic.includes(stripped)) out.add(stripped);
  if (a.subtype === "BANK") {
    const first = stripped.split(" ")[0];
    if (first && first.length >= 3 && !["bank", "the", "main", "primary", "business"].includes(first)) out.add(first);
  }
  for (const alias of SUBTYPE_ALIASES[a.subtype ?? ""] ?? []) out.add(alias);
  return [...out].filter((s) => s.length >= 2);
}

type AccountMention = { account: ParseContextAccount; index: number; alias: string };

function findAccountMentions(text: string, accounts: ParseContextAccount[]): AccountMention[] {
  const t = text.toLowerCase();
  const mentions: AccountMention[] = [];
  for (const a of accounts) {
    if (!PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? "")) continue;
    let best: AccountMention | null = null;
    for (const alias of aliasesFor(a)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(alias)}([^a-z0-9]|$)`, "i");
      const m = re.exec(t);
      if (m && (!best || alias.length > best.alias.length)) best = { account: a, index: m.index + m[1].length, alias };
    }
    if (best) mentions.push(best);
  }
  // Drop mentions fully contained in a longer mention (e.g. "cash" inside "petty cash").
  return mentions
    .filter((m) => !mentions.some((o) => o !== m && o.alias.length > m.alias.length && o.index <= m.index && o.index + o.alias.length >= m.index + m.alias.length))
    .sort((a, b) => a.index - b.index);
}

// ───────────────────────────── Category ─────────────────────────────

function scoreCategories(text: string, categories: ParseContextCategory[], kind: "INCOME" | "EXPENSE", ignore: string[]) {
  let t = ` ${text.toLowerCase()} `;
  for (const phrase of ignore) t = t.split(phrase.toLowerCase()).join(" ");
  const scored = categories
    .filter((c) => c.kind === kind)
    .map((c) => {
      let score = 0;
      const phrases = [c.name.toLowerCase(), ...c.keywords.map((k) => k.toLowerCase())];
      for (const p of phrases) {
        if (!p) continue;
        const re = new RegExp(`(^|[^a-z0-9])${escapeRe(p)}(s|es)?([^a-z0-9]|$)`, "i");
        if (re.test(t)) score += 1 + p.split(" ").length * 0.5 + (p === c.name.toLowerCase() ? 1 : 0);
      }
      // Name words (e.g. "electricity" from "Electricity Expense") count a little.
      for (const w of c.name.toLowerCase().split(/\W+/)) {
        if (w.length > 3 && !["expense", "expenses", "revenue", "income"].includes(w) && new RegExp(`\\b${escapeRe(w)}`).test(t)) score += 0.5;
      }
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored;
}

// ───────────────────────────── Text helpers ─────────────────────────────

const STOP_AFTER = "(?:through|via|using|from|by|with|on|in|into|at|to|towards|paid|today|yesterday|last|this|and|,|\\.|;|$)";

function titleCase(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length <= 2 && w !== w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function extractPurpose(text: string): string | null {
  const re = new RegExp(`\\bfor\\s+(?:the\\s+|our\\s+|my\\s+)?(.+?)\\s*${STOP_AFTER}`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const purpose = m[1].replace(/[₹$€£]\s?[\d,]+(\.\d+)?/g, "").trim();
  return purpose.length >= 2 && purpose.length <= 80 ? titleCase(purpose) : null;
}

function extractCounterparty(text: string, type: ParsedType | null, accountAliases: string[]): string | null {
  const patterns =
    type === "INCOME"
      ? [/\bfrom\s+([A-Za-z0-9&.' -]+?)\s*(?=\bfor\b|\bvia\b|\bthrough\b|\bby\b|\bon\b|\binto\b|\bin\b|\bas\b|,|\.|;|$)/i, /\bby\s+([A-Z][A-Za-z0-9&.' -]+?)\s*(?=\bfor\b|,|\.|$)/]
      : [/\b(?:to|paid)\s+([A-Za-z0-9&.' -]+?)\s*(?=\bfor\b|\bvia\b|\bthrough\b|\bfrom\b|\busing\b|\bby\b|\bon\b|,|\.|;|$)/i, /\bat\s+([A-Z][A-Za-z0-9&.' -]+?)\s*(?=\bfor\b|\bvia\b|\bthrough\b|\bfrom\b|,|\.|$)/];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const numberWords = [...Object.keys(WORD_NUMBERS), ...Object.keys(WORD_SCALES), "and", "rupees?", "rs", "inr", "dollars?", "only"].join("|");
    const name = m[1]
      .replace(/^(the|a|an|my|our)\s+/i, "")
      .replace(/[₹$€£]?\s?\d[\d,.]*\s*(k|lakh|rupees|rs)?/gi, "")
      .replace(new RegExp(`(\\s+(${numberWords}))+\\s*$`, "i"), "")
      .trim();
    if (!name || name.length < 2) continue;
    const lower = name.toLowerCase();
    if (accountAliases.some((a) => lower === a || lower.startsWith(`${a} `) || lower.endsWith(` ${a}`))) continue;
    if (/^(office|home|work|cash|bank|me|him|her|them|us|vendor|customer|client|someone)$/i.test(name)) continue;
    // Expense "paid <thing>" usually names a purpose ("paid rent"), not a person: require a capital letter.
    if (type !== "INCOME" && !/[A-Z]/.test(name)) continue;
    return titleCase(name);
  }
  return null;
}

function detectPaymentMethod(text: string, account: ParseContextAccount | null): string | null {
  const t = text.toLowerCase();
  if (/\b(neft|rtgs|imps|bank transfer|wire|net ?banking)\b/.test(t)) return "Bank Transfer";
  if (/\b(upi|gpay|google pay|phonepe|phone pe|paytm|bhim)\b/.test(t)) return "UPI";
  if (/\b(cheque|check)\b/.test(t)) return "Cheque";
  if (/\b(credit card|debit card|card)\b/.test(t)) return "Card";
  if (/\bcash\b/.test(t)) return "Cash";
  switch (account?.subtype) {
    case "BANK":
      return "Bank Transfer";
    case "CASH":
      return "Cash";
    case "WALLET":
      return "UPI";
    case "CREDIT_CARD":
      return "Card";
    default:
      return null;
  }
}

/** Normalises company names for comparison ("ABC Technologies Pvt. Ltd." → "abc technologies"). */
function normalizeName(s: string) {
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|corp|corporation|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Uses an existing contact's exact spelling only when the names match exactly (ignoring case and legal suffixes). */
function matchKnownName(name: string | null, known: string[] = []): string | null {
  if (!name) return null;
  const target = normalizeName(name);
  return known.find((k) => normalizeName(k) === target) ?? name;
}

// ───────────────────────────── Main ─────────────────────────────

export function parseTransactionText(input: string, ctx: ParseContext): ParsedEntry {
  const text = input.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const notes: string[] = [];
  const clarifications: string[] = [];
  const missing: string[] = [];
  const fc = { type: 0, amount: 0, date: 0, category: 0, account: 0 };

  // Accounts mentioned
  const mentions = findAccountMentions(text, ctx.accounts);
  const aliasList = ctx.accounts.flatMap(aliasesFor);

  // Type
  let type: ParsedType | null = null;
  const isExpense = EXPENSE_WORDS.test(lower);
  const isIncome = INCOME_WORDS.test(lower);
  const isTransfer = TRANSFER_WORDS.test(lower) && mentions.length >= 1 && (mentions.length >= 2 || /\b(cash|withdr|deposit)/.test(lower));
  if (isTransfer && mentions.length >= 2) {
    type = "TRANSFER";
    fc.type = 0.9;
  } else if (isTransfer && /\b(withdr|deposited cash|cash deposit)/.test(lower)) {
    type = "TRANSFER";
    fc.type = 0.8;
  } else if (isExpense && !isIncome) {
    type = "EXPENSE";
    fc.type = 0.95;
  } else if (isIncome && !isExpense) {
    type = "INCOME";
    fc.type = 0.95;
  } else if (isIncome && isExpense) {
    // "received bill" vs "paid by client" — weigh the first verb.
    const ie = lower.search(INCOME_WORDS);
    const ee = lower.search(EXPENSE_WORDS);
    type = ie < ee ? "INCOME" : "EXPENSE";
    fc.type = 0.6;
    notes.push(`Interpreted as ${type === "INCOME" ? "income" : "an expense"} — please confirm.`);
  } else {
    // No verb: infer from category vocabulary only when it points one way.
    const ignore = mentions.map((m) => m.alias);
    const exp = scoreCategories(text, ctx.categories, "EXPENSE", ignore);
    const inc = scoreCategories(text, ctx.categories, "INCOME", ignore);
    if (exp.length && !inc.length) type = "EXPENSE";
    else if (inc.length && !exp.length) type = "INCOME";
    if (type) {
      fc.type = 0.6;
      notes.push(`No "paid" or "received" wording — treated as ${type === "INCOME" ? "income" : "an expense"} from the category. Please confirm.`);
    } else {
      clarifications.push("Was this money received (income) or paid out (expense)?");
      missing.push("type");
    }
  }

  // Amount
  let amount: string | null = null;
  let currency = ctx.currency;
  const amounts = extractAmounts(text);
  const marked = amounts.filter((a) => a.marked);
  const pool = marked.length ? marked : amounts;
  const distinct = [...new Set(pool.map((a) => a.value))];
  if (distinct.length === 1) {
    amount = pool[0].value.toFixed(2);
    currency = pool[0].currency ?? ctx.currency;
    fc.amount = marked.length ? 1 : 0.8;
  } else if (distinct.length > 1) {
    clarifications.push(`I found more than one amount (${pool.map((a) => a.raw).join(", ")}). Which is the transaction amount?`);
    missing.push("amount");
  } else {
    clarifications.push("How much was it?");
    missing.push("amount");
  }
  if (currency !== ctx.currency) notes.push(`Amount is in ${currency}; enter the exchange rate to ${ctx.currency} before posting.`);

  // Date
  const d = extractDate(text, ctx.today);
  fc.date = d.assumed ? 0.6 : 1;
  if (d.assumed) notes.push("No date mentioned — using today's date.");
  if (d.date > ctx.today) notes.push("The date is in the future — please check it.");

  // Accounts
  let paymentAccount: ParseContextAccount | null = null;
  let toAccount: ParseContextAccount | null = null;
  const bankAccounts = ctx.accounts.filter((a) => a.subtype === "BANK");
  if (type === "TRANSFER") {
    const fromM = /\bfrom\s+(.+?)(?=\bto\b|\binto\b|$)/i.exec(text);
    const toM = /\b(?:to|into|in)\s+(.+?)(?=\bfrom\b|,|\.|$)/i.exec(text);
    const inSpan = (span: RegExpExecArray | null, m: AccountMention) =>
      span ? m.index >= span.index && m.index < span.index + span[0].length : false;
    paymentAccount = mentions.find((m) => inSpan(fromM, m))?.account ?? null;
    toAccount = mentions.find((m) => inSpan(toM, m) && m.account.id !== paymentAccount?.id)?.account ?? null;
    const cash = ctx.accounts.find((a) => a.subtype === "CASH") ?? null;
    if (/\bwithdr/.test(lower)) {
      toAccount ??= cash;
      paymentAccount ??= mentions.find((m) => m.account.subtype !== "CASH")?.account ?? null;
    }
    if (/\bdeposit/.test(lower)) {
      paymentAccount ??= cash;
      toAccount ??= mentions.find((m) => m.account.subtype !== "CASH")?.account ?? null;
    }
    if (!paymentAccount && mentions.length >= 2) paymentAccount = mentions[0].account;
    if (!toAccount && mentions.length >= 2) toAccount = mentions.find((m) => m.account.id !== paymentAccount?.id)?.account ?? null;
    if (!paymentAccount) {
      clarifications.push("Which account did the money come from?");
      missing.push("from account");
    }
    if (!toAccount) {
      clarifications.push("Which account did the money go to?");
      missing.push("to account");
    }
    fc.account = paymentAccount && toAccount ? 0.9 : 0.3;
  } else {
    const usable = mentions.filter((m) => (type === "INCOME" ? m.account.subtype !== "PAYABLE" && m.account.subtype !== "CREDIT_CARD" : m.account.subtype !== "RECEIVABLE"));
    if (usable.length === 1) {
      paymentAccount = usable[0].account;
      fc.account = 0.95;
    } else if (usable.length > 1) {
      // Prefer the account introduced by a payment preposition.
      const prepositional = usable.find((m) => /\b(through|via|using|from|by|with|into|in|to)\s+(the\s+|my\s+|our\s+)?$/i.test(text.slice(0, m.index)));
      paymentAccount = (prepositional ?? usable[usable.length - 1]).account;
      fc.account = 0.7;
      notes.push(`Several accounts were mentioned; using ${paymentAccount.name}.`);
    } else if (/\bbank\b/.test(lower) && bankAccounts.length === 1) {
      paymentAccount = bankAccounts[0];
      fc.account = 0.75;
      notes.push(`"Bank" matched your only bank account, ${paymentAccount.name}.`);
    } else if (/\bbank\b/.test(lower) && bankAccounts.length > 1) {
      clarifications.push(`Which bank account? (${bankAccounts.map((b) => b.name).join(", ")})`);
      missing.push(type === "INCOME" ? "receiving account" : "payment account");
    } else if (type) {
      clarifications.push(type === "INCOME" ? "Which account received the money (e.g. bank or cash)?" : "Which account was it paid from (e.g. bank, cash, UPI or card)?");
      missing.push(type === "INCOME" ? "receiving account" : "payment account");
    }
  }

  // Category
  let category: ParseContextCategory | null = null;
  if (type === "INCOME" || type === "EXPENSE") {
    const ignore = mentions.map((m) => m.alias);
    const scored = scoreCategories(text, ctx.categories, type, ignore);
    if (scored.length) {
      const [top, second] = scored;
      category = top.c;
      fc.category = second && second.score >= top.score ? 0.55 : Math.min(0.95, 0.6 + top.score * 0.1);
      if (second && second.score >= top.score) notes.push(`Category could also be ${second.c.name}.`);
    } else {
      const options = ctx.categories.filter((c) => c.kind === type).slice(0, 4).map((c) => c.name);
      clarifications.push(`Which category fits best${options.length ? ` (for example ${options.join(", ")})` : ""}?`);
      missing.push("category");
    }
  } else if (type === "TRANSFER") {
    fc.category = 1;
  }

  // Counterparty, description, payment method
  const counterpartyRaw = extractCounterparty(text, type, aliasList);
  const counterparty = type === "INCOME" ? matchKnownName(counterpartyRaw, ctx.customers) : matchKnownName(counterpartyRaw, ctx.vendors);
  const purpose = extractPurpose(text);
  const description =
    purpose ??
    (type === "TRANSFER" && paymentAccount && toAccount
      ? `Transfer from ${paymentAccount.name} to ${toAccount.name}`
      : category?.name ?? (counterparty ? `${type === "INCOME" ? "Payment from" : "Payment to"} ${counterparty}` : titleCase(text.slice(0, 60))));
  const paymentMethod = type === "TRANSFER" ? "Transfer" : detectPaymentMethod(text, paymentAccount);

  const weights = { type: 0.2, amount: 0.3, date: 0.1, category: 0.2, account: 0.2 };
  const confidence =
    Math.round(
      (Object.keys(weights) as (keyof typeof weights)[]).reduce((s, k) => s + weights[k] * fc[k], 0) * 100,
    ) / 100;

  return {
    type,
    amount,
    currency,
    date: d.date,
    dateAssumed: d.assumed,
    description,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    paymentAccountId: paymentAccount?.id ?? null,
    paymentAccountName: paymentAccount?.name ?? null,
    toAccountId: toAccount?.id ?? null,
    toAccountName: toAccount?.name ?? null,
    counterparty,
    counterpartyRole: counterparty ? (type === "INCOME" ? "customer" : "vendor") : null,
    paymentMethod,
    confidence: missing.length ? Math.min(confidence, 0.6) : confidence,
    fieldConfidence: fc,
    missing,
    clarifications,
    notes,
    engine: "rules",
  };
}

/** Maps a parsed entry onto debit/credit accounts for the transaction form. */
export function toTransactionDraft(p: ParsedEntry) {
  if (!p.type) return null;
  if (p.type === "EXPENSE") return { type: p.type, debitAccountId: null as string | null, creditAccountId: p.paymentAccountId };
  if (p.type === "INCOME") return { type: p.type, debitAccountId: p.paymentAccountId, creditAccountId: null as string | null };
  return { type: p.type, debitAccountId: p.toAccountId, creditAccountId: p.paymentAccountId };
}

// ───────────────────────── Single-answer helpers (interactive mode) ─────────────────────────
// Used in the browser to understand one short answer at a time ("expense",
// "yesterday", "HDFC", "office electricity"). They never guess: null = ask again.

/** "income" / "I spent…" / "transfer" → type, or null when unclear. */
export function parseTypeAnswer(text: string): ParsedType | null {
  const t = text.toLowerCase();
  const transfer = /\b(transfer|transferred|move|moved|withdr\w*|deposit\w*|contra|between)\b/.test(t);
  const income = /\b(income|received?|receiving|got|earn\w*|credit(ed)?|sale|sold|revenue|money in|incoming)\b/.test(t);
  const expense = /\b(expense|expenses|spent|spend|paid|pay|payment|bought|purchase\w*|bill|debit(ed)?|cost|money out|outgoing)\b/.test(t);
  if (transfer && !income && !expense) return "TRANSFER";
  if (income && !expense) return "INCOME";
  if (expense && !income) return "EXPENSE";
  if (transfer) return "TRANSFER";
  return null;
}

const SPOKEN_SCALES: Record<string, number> = {
  thousand: 1e3,
  thousands: 1e3,
  k: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  lak: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  million: 1e6,
  millions: 1e6,
  mn: 1e6,
};

export type SpokenAmount = { value: number; text: string } | { ambiguous: "bare-scale"; text: string } | { multiple: string[] } | null;

/**
 * Reads one spoken amount, however speech recognition happens to write it:
 * "15,500", "15 thousand 500", "fifteen thousand five hundred", "fifteen hundred",
 * "1.5 lakh", "two point five lakh", "₹2,500 only", "15k".
 * A scale word on its own ("thousand") is reported as ambiguous — the first
 * word was probably cut off — and two separate numbers as multiple.
 */
export function parseSpokenAmount(input: string): SpokenAmount {
  const cleaned = input
    .toLowerCase()
    .replace(/₹/g, " ")
    .replace(/\b(rs\.?|inr|rupees?|only|bucks)\b/g, " ")
    .replace(/\/-/g, " ")
    .replace(/(\d)\s*(k|lakhs?|lacs?|crores?|cr|mn)\b/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/[^\w.,\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  type Tok = { kind: "digit" | "unit" | "hundred" | "scale" | "and" | "point" | "a"; raw: string; value: number };
  const classify = (t: string): Tok | null => {
    if (/^\d{1,3}(,\d{2,3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(t)) return { kind: "digit", raw: t, value: Number(t.replace(/,/g, "")) };
    if (t in WORD_NUMBERS) return { kind: "unit", raw: t, value: WORD_NUMBERS[t] };
    if (t === "hundred" || t === "hundreds") return { kind: "hundred", raw: t, value: 100 };
    if (t in SPOKEN_SCALES) return { kind: "scale", raw: t, value: SPOKEN_SCALES[t] };
    if (t === "and") return { kind: "and", raw: t, value: 0 };
    if (t === "point") return { kind: "point", raw: t, value: 0 };
    if (t === "a" || t === "an") return { kind: "a", raw: t, value: 1 };
    return null;
  };

  // Split into runs of number words; a new run starts where two plain numbers sit side by side.
  const runs: Tok[][] = [];
  let run: Tok[] = [];
  const flush = () => {
    while (run.length && ["and", "a", "point"].includes(run[run.length - 1].kind)) run.pop();
    if (run.some((t) => t.kind !== "and" && t.kind !== "a")) runs.push(run);
    run = [];
  };
  for (const raw of tokens) {
    const tok = classify(raw);
    if (!tok) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    const plain = (t?: Tok) => t && (t.kind === "digit" || (t.kind === "unit" && t.value < 10));
    const afterPoint = run.some((t) => t.kind === "point") && !run.slice(run.findIndex((t) => t.kind === "point")).some((t) => t.kind === "scale");
    if (prev && !afterPoint && ((tok.kind === "digit" && prev.kind === "digit") || (plain(tok) && plain(prev) && tok.kind === prev.kind) || (tok.kind === "unit" && prev.kind === "unit" && tok.value >= 10))) {
      flush();
    }
    if (tok.kind === "a" && run.length) flush();
    // "and" joins parts of one number only after hundred/thousand ("three hundred and fifty");
    // between two plain numbers ("500 and 700") it separates two amounts.
    if (prev?.kind === "and" && tok.kind !== "and") {
      const beforeAnd = run[run.length - 2];
      if (beforeAnd && (beforeAnd.kind === "digit" || beforeAnd.kind === "unit")) flush();
    }
    run.push(tok);
  }
  flush();

  const evaluate = (r: Tok[]): number => {
    let total = 0;
    let current = 0;
    let decimals = "";
    let inDecimal = false;
    for (const t of r) {
      switch (t.kind) {
        case "digit":
          if (inDecimal) decimals += t.raw.replace(/\D/g, "");
          else current += t.value;
          break;
        case "unit":
          if (inDecimal && t.value < 10) decimals += String(t.value);
          else current += t.value;
          break;
        case "a":
          current = current || 1;
          break;
        case "hundred":
          current = (current || 1) * 100;
          break;
        case "scale": {
          const base = (current || 1) + (decimals ? Number(`0.${decimals}`) : 0);
          total += base * t.value;
          current = 0;
          decimals = "";
          inDecimal = false;
          break;
        }
        case "point":
          inDecimal = true;
          break;
        case "and":
          break;
      }
    }
    return total + current + (decimals ? Number(`0.${decimals}`) : 0);
  };

  if (!runs.length) return null;
  if (runs.length > 1) return { multiple: runs.map((r) => r.map((t) => t.raw).join(" ")) };
  const only = runs[0];
  const text = only.map((t) => t.raw).join(" ");
  const hasQuantity = only.some((t) => t.kind === "digit" || t.kind === "unit" || t.kind === "a");
  if (!hasQuantity) return { ambiguous: "bare-scale", text };
  const value = Math.round(evaluate(only) * 100) / 100;
  return value > 0 ? { value, text } : null;
}

/** "skip", "no", "none", "not needed"… */
export function isSkipAnswer(text: string): boolean {
  return /^\s*(skip|no|nope|none|nothing|nobody|no one|not needed|not required|n\/a|na|leave it|leave blank|pass)\s*[.!]?\s*$/i.test(text);
}

/** Yes / no for confirmations. */
export function parseYesNo(text: string): boolean | null {
  if (/\b(yes|yeah|yep|sure|ok(ay)?|correct|right|confirm|save|post|go ahead|do it|perfect)\b/i.test(text)) return true;
  if (/\b(no|nope|cancel|stop|wrong|not right|don'?t)\b/i.test(text)) return false;
  return null;
}

/** Best category for an answer, restricted to one kind. */
export function matchCategory(text: string, categories: ParseContextCategory[], kind: "INCOME" | "EXPENSE"): ParseContextCategory | null {
  const scored = scoreCategories(text, categories, kind, []);
  if (scored.length) return scored[0].c;
  const t = text.toLowerCase().trim();
  if (!t) return null;
  const pool = categories.filter((c) => c.kind === kind);
  return (
    pool.find((c) => c.name.toLowerCase() === t) ??
    pool.find((c) => c.name.toLowerCase().includes(t) && t.length >= 3) ??
    pool.find((c) => c.name.toLowerCase().split(/\W+/).some((w) => w.length > 3 && t.includes(w))) ??
    null
  );
}

/** Payment account named in an answer ("HDFC", "cash", "UPI"), optionally excluding some ids. */
export function matchPaymentAccount(text: string, accounts: ParseContextAccount[], exclude: string[] = []): ParseContextAccount | null {
  const usable = accounts.filter((a) => !exclude.includes(a.id) && PAYMENT_ACCOUNT_SUBTYPES.includes(a.subtype ?? ""));
  const mentions = findAccountMentions(text, usable);
  if (mentions.length) return mentions[0].account;
  const t = text.toLowerCase().trim();
  if (!t) return null;
  const byName = usable.find((a) => a.name.toLowerCase() === t) ?? usable.find((a) => t.length >= 3 && a.name.toLowerCase().includes(t));
  if (byName) return byName;
  if (/\bbank\b/.test(t)) {
    const banks = usable.filter((a) => a.subtype === "BANK");
    if (banks.length === 1) return banks[0];
  }
  return null;
}

/** A short title-case description from an answer ("for office electricity" → "Office Electricity"). */
export function descriptionFromAnswer(text: string): string {
  const purpose = extractPurpose(`${text} `);
  const cleaned = (purpose ?? text)
    .replace(/^(it was|it's|its|this was|this is|for|the|a|an)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  return cleaned ? titleCase(cleaned).slice(0, 120) : "";
}

export { isoDate };

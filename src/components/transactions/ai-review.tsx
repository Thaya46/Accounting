"use client";

import * as React from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, CheckCircle2, CircleHelp, Cpu, Info, Mic, Quote, Send, Sparkles, Type, X } from "lucide-react";
import type { ParsedEntry } from "@/lib/ai/parser";
import { apiFetch, ClientApiError } from "@/lib/client/api";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  AI_ENGINE_LABELS,
  PAYMENT_METHODS,
  type DuplicateWarning,
  type FormOptions,
  type SavedTransaction,
} from "@/lib/transactions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, FormField } from "@/components/ui/feedback";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ConfidenceDot, ConfidenceMeter } from "./display";
import { AccountSelect, DuplicatePanel, EnteredByStamp, GuardedButton, SegmentedControl, duplicateProbe, useDuplicateCheck } from "./form-parts";
import { approvalRequired, groupPaymentAccounts, isPaymentAccount, isValidAmount, isValidRate, normalizeAmount } from "./form-utils";

export type ParseResult = {
  parsed: ParsedEntry;
  duplicates: DuplicateWarning[];
  provider: { provider: string; configured: boolean; model: string };
};

type EntryType = "EXPENSE" | "INCOME" | "TRANSFER";
type FieldKey = "type" | "amount" | "date" | "description" | "category" | "payment" | "to" | "rate";

type ReviewState = {
  type: EntryType | "";
  amount: string;
  currency: string;
  exchangeRate: string;
  date: string;
  description: string;
  categoryId: string;
  paymentAccountId: string;
  toAccountId: string;
  counterparty: string;
  paymentMethod: string;
  notes: string;
};

function fromParsed(p: ParsedEntry): ReviewState {
  return {
    type: p.type ?? "",
    amount: p.amount ?? "",
    currency: p.currency,
    exchangeRate: "",
    date: p.date,
    description: p.description,
    categoryId: p.categoryId ?? "",
    paymentAccountId: p.paymentAccountId ?? "",
    toAccountId: p.toAccountId ?? "",
    counterparty: p.counterparty ?? "",
    paymentMethod: p.paymentMethod ?? "",
    notes: "",
  };
}

function fieldForMissing(m: string): FieldKey | null {
  if (m === "type") return "type";
  if (m === "amount") return "amount";
  if (m === "category") return "category";
  if (m === "to account") return "to";
  if (/account/.test(m)) return "payment";
  return null;
}

function fieldForQuestion(q: string): FieldKey | null {
  const s = q.toLowerCase();
  if (/income\)|\(expense|received .*or paid|paid out|money received/.test(s)) return "type";
  if (/how much|amount/.test(s)) return "amount";
  if (/category/.test(s)) return "category";
  if (/go to|went to|destination|to which|into which/.test(s)) return "to";
  if (/account|bank|paid from|come from|received the money|card|cash|upi/.test(s)) return "payment";
  if (/date|when/.test(s)) return "date";
  if (/descri|what was it for|purpose/.test(s)) return "description";
  return null;
}

const TYPE_OPTIONS = [
  { value: "EXPENSE" as const, label: "Expense", icon: ArrowUpRight, activeClass: "text-expense" },
  { value: "INCOME" as const, label: "Income", icon: ArrowDownLeft, activeClass: "text-income" },
  { value: "TRANSFER" as const, label: "Transfer", icon: ArrowLeftRight, activeClass: "text-info" },
];

/**
 * Review card for an AI-extracted entry. Every field is editable; required
 * fields the AI could not determine are flagged with its clarification
 * question and must be filled before submitting or posting.
 */
export function AiReview({
  options,
  result,
  rawInput,
  source,
  onSaved,
  onDiscard,
}: {
  options: FormOptions;
  result: ParseResult;
  rawInput: string;
  source: "TEXT" | "VOICE";
  onSaved: (saved: SavedTransaction, extra: { autoPosted: boolean; duplicates: DuplicateWarning[] }) => void;
  onDiscard: () => void;
}) {
  const { parsed } = result;
  const base = options.currency;
  const [s, setS] = React.useState<ReviewState>(() => fromParsed(parsed));
  const [attempted, setAttempted] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const set = <K extends keyof ReviewState>(k: K, v: ReviewState[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const parsedMissing = React.useMemo(() => new Set(parsed.missing.map(fieldForMissing).filter(Boolean) as FieldKey[]), [parsed.missing]);
  const questions = React.useMemo(
    () => parsed.clarifications.map((q) => ({ q, field: fieldForQuestion(q) })),
    [parsed.clarifications],
  );
  const questionFor = (f: FieldKey) => questions.find((q) => q.field === f)?.q;

  const foreign = s.currency !== base;
  const isMoneyType = s.type === "EXPENSE" || s.type === "INCOME";
  const payment = options.accounts.filter(isPaymentAccount);
  const paymentGroups = groupPaymentAccounts(payment, s.type === "INCOME" ? ["PAYABLE", "CREDIT_CARD"] : s.type === "EXPENSE" ? ["RECEIVABLE"] : ["RECEIVABLE", "PAYABLE"]);
  const categories = options.categories.filter((c) => c.kind === s.type);

  // Field completeness.
  const filled: Record<FieldKey, boolean> = {
    type: Boolean(s.type),
    amount: isValidAmount(s.amount),
    date: /^\d{4}-\d{2}-\d{2}$/.test(s.date),
    description: s.description.trim().length > 0,
    category: !isMoneyType || Boolean(s.categoryId),
    payment: Boolean(s.paymentAccountId),
    to: s.type !== "TRANSFER" || (Boolean(s.toAccountId) && s.toAccountId !== s.paymentAccountId),
    rate: !foreign || isValidRate(s.exchangeRate),
  };
  const draftFields: FieldKey[] = ["type", "amount", "date", "description", "rate"];
  const allFields: FieldKey[] = ["type", "amount", "date", "description", "category", "payment", "to", "rate"];
  const draftReady = draftFields.every((f) => filled[f]) && !(s.type === "TRANSFER" && s.toAccountId && s.toAccountId === s.paymentAccountId);
  const complete = allFields.every((f) => filled[f]);

  const MESSAGES: Record<FieldKey, string> = {
    type: "Choose expense, income or transfer.",
    amount: "Enter an amount greater than zero (max 2 decimals).",
    date: "Choose the transaction date.",
    description: "Describe the transaction.",
    category: "Choose a category.",
    payment: s.type === "INCOME" ? "Choose the account that received the money." : s.type === "TRANSFER" ? "Choose the account the money came from." : "Choose the account it was paid from.",
    to: s.toAccountId && s.toAccountId === s.paymentAccountId ? "The destination must differ from the source account." : "Choose the account the money went to.",
    rate: `Enter the ${s.currency} → ${base} exchange rate.`,
  };

  /** Inline message: the AI's question for fields it could not fill, or a validation hint after an attempt. */
  const fieldNote = (f: FieldKey): { tone: "ask" | "error"; text: string } | null => {
    if (filled[f]) return null;
    if (parsedMissing.has(f) || questionFor(f)) return { tone: "ask", text: questionFor(f) ?? MESSAGES[f] };
    if (attempted) return { tone: "error", text: MESSAGES[f] };
    return null;
  };

  const dup = useDuplicateCheck(options.workspaceId, s.type ? duplicateProbe(s.type, s.amount, s.date, s.description) : null, { initial: result.duplicates });
  const needsApproval = approvalRequired(options.settings, s.amount);
  const engine = AI_ENGINE_LABELS[parsed.engine] ?? parsed.engine;
  const dateAssumed = parsed.dateAssumed && s.date === parsed.date;
  // Questions tied to a field close when the field is filled; free-form ones close once the entry is complete.
  const openQuestions = questions.filter((q) => (q.field ? !filled[q.field] : !complete));

  function changeType(t: EntryType) {
    setS((prev) => {
      const next = { ...prev, type: t };
      const cat = options.categories.find((c) => c.id === prev.categoryId);
      if (cat && cat.kind !== t) next.categoryId = "";
      if (t !== "TRANSFER") next.toAccountId = "";
      const pay = options.accounts.find((a) => a.id === prev.paymentAccountId);
      const excluded = t === "INCOME" ? ["PAYABLE", "CREDIT_CARD"] : t === "EXPENSE" ? ["RECEIVABLE"] : ["RECEIVABLE", "PAYABLE"];
      if (pay && excluded.includes(pay.subtype ?? "")) next.paymentAccountId = "";
      if (t === "TRANSFER") {
        next.categoryId = "";
        next.counterparty = "";
        if (!prev.paymentMethod) next.paymentMethod = "Transfer";
      }
      return next;
    });
  }

  function buildInput() {
    const common = {
      type: s.type as EntryType,
      date: s.date,
      amount: normalizeAmount(s.amount),
      currency: s.currency,
      exchangeRate: foreign ? s.exchangeRate.trim() : undefined,
      description: s.description.trim(),
      paymentMethod: s.paymentMethod || null,
      notes: s.notes.trim() || null,
    };
    if (s.type === "EXPENSE") return { ...common, categoryId: s.categoryId || null, debitAccountId: null, creditAccountId: s.paymentAccountId || null, vendorName: s.counterparty.trim() || null };
    if (s.type === "INCOME") return { ...common, categoryId: s.categoryId || null, debitAccountId: s.paymentAccountId || null, creditAccountId: null, customerName: s.counterparty.trim() || null };
    return { ...common, categoryId: null, debitAccountId: s.toAccountId || null, creditAccountId: s.paymentAccountId || null };
  }

  async function save(intent: "draft" | "submit" | "post") {
    setAttempted(true);
    if (intent === "draft" ? !draftReady : !complete) {
      toast.error(intent === "draft" ? "Fill in the type, amount, date and description first." : "Answer the open questions and fill the required fields first.");
      return;
    }
    if (dup.needsAck) {
      toast.error("Confirm this is not a duplicate before saving.");
      return;
    }
    setBusy(intent);
    try {
      const r = await apiFetch<{ transaction: SavedTransaction; duplicates: DuplicateWarning[]; autoPosted: boolean }>(`/api/w/${options.workspaceId}/transactions`, {
        body: { input: buildInput(), intent, source, rawInput, aiConfidence: parsed.confidence },
      });
      onSaved(r.transaction, { autoPosted: r.autoPosted, duplicates: r.duplicates });
    } catch (e) {
      toast.error(e instanceof ClientApiError || e instanceof Error ? e.message : "Could not save the transaction");
    } finally {
      setBusy(null);
    }
  }

  const SourceIcon = source === "VOICE" ? Mic : Type;
  const note = (f: FieldKey) => {
    const n = fieldNote(f);
    if (!n) return null;
    return (
      <p className={cn("flex items-start gap-1 text-xs", n.tone === "ask" ? "font-medium text-warning" : "text-expense")}>
        {n.tone === "ask" && <CircleHelp className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
        {n.text}
      </p>
    );
  };
  const ring = (f: FieldKey) => (fieldNote(f)?.tone === "ask" ? "border-warning ring-2 ring-warning/20" : undefined);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card>
        <CardHeader className="gap-3 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" /> Review before saving
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Nothing has been saved yet. Check every field — you can change anything.</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <ConfidenceMeter value={parsed.confidence} />
              <Badge variant="outline" className="gap-1">
                <Cpu className="h-3 w-3" /> {engine}
              </Badge>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 break-words italic text-foreground/90">{rawInput}</p>
            <Badge variant="muted" className="shrink-0 gap-1">
              <SourceIcon className="h-3 w-3" /> {source === "VOICE" ? "Voice" : "Text"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {openQuestions.length > 0 && (
            <Alert variant="warning" title="A few details are needed — I won't guess these">
              <ul className="mt-1 space-y-1">
                {openQuestions.map((q) => (
                  <li key={q.q} className="flex items-start gap-1.5">
                    <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {q.q}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {questions.length > 0 && openQuestions.length === 0 && (
            <Alert variant="success" title="All questions answered">
              Thanks — the missing details are filled in.
            </Alert>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              Type <span className="text-expense">*</span> <ConfidenceDot value={parsed.fieldConfidence.type} />
            </div>
            <SegmentedControl ariaLabel="Transaction type" value={s.type} onChange={changeType} options={TYPE_OPTIONS} className={cn(fieldNote("type")?.tone === "ask" && "ring-2 ring-warning/40")} />
            {note("type")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ai-amount" className="flex items-center gap-2 text-sm font-medium">
                Amount <span className="text-expense">*</span> <ConfidenceDot value={parsed.fieldConfidence.amount} />
              </label>
              <div className="flex gap-2">
                <Input
                  id="ai-amount"
                  inputMode="decimal"
                  value={s.amount}
                  onChange={(e) => set("amount", e.target.value)}
                  placeholder="0.00"
                  className={cn("tabular flex-1", ring("amount"))}
                  aria-invalid={Boolean(fieldNote("amount")) || undefined}
                />
                <NativeSelect value={s.currency} onChange={(e) => set("currency", e.target.value)} className="w-24" aria-label="Currency">
                  {[...new Set([base, s.currency, ...CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {note("amount")}
              {isValidAmount(s.amount) && (
                <p className="text-xs text-muted-foreground">{formatMoney(normalizeAmount(s.amount), s.currency, { decimals: true })}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ai-date" className="flex items-center gap-2 text-sm font-medium">
                Date <span className="text-expense">*</span> <ConfidenceDot value={parsed.fieldConfidence.date} />
                {dateAssumed && (
                  <Badge variant="warning" className="gap-1">
                    <CalendarClock className="h-3 w-3" /> Assumed today
                  </Badge>
                )}
              </label>
              <Input id="ai-date" type="date" value={s.date} onChange={(e) => set("date", e.target.value)} aria-invalid={Boolean(fieldNote("date")) || undefined} />
              {dateAssumed && <p className="text-xs text-muted-foreground">No date was mentioned, so today is used. Change it if needed.</p>}
              {s.date > options.today && <p className="text-xs text-warning">This date is in the future.</p>}
              {note("date")}
            </div>

            {foreign && (
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="ai-rate" className="text-sm font-medium">
                  Exchange rate ({s.currency} → {base}) <span className="text-expense">*</span>
                </label>
                <Input id="ai-rate" inputMode="decimal" value={s.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} placeholder="e.g. 83.25" className={cn("tabular", ring("rate"))} />
                {isValidAmount(s.amount) && isValidRate(s.exchangeRate) ? (
                  <p className="text-xs text-muted-foreground">
                    Books as {formatMoney((Number(normalizeAmount(s.amount)) * Number(s.exchangeRate)).toFixed(2), base, { decimals: true })}
                  </p>
                ) : (
                  note("rate") ?? <p className="text-xs text-muted-foreground">Required for amounts not in {base}.</p>
                )}
              </div>
            )}

            <FormField label="Description" htmlFor="ai-desc" required className="sm:col-span-2">
              <Input id="ai-desc" value={s.description} maxLength={500} onChange={(e) => set("description", e.target.value)} aria-invalid={Boolean(fieldNote("description")) || undefined} />
              {note("description")}
            </FormField>

            {isMoneyType && (
              <div className="space-y-1.5">
                <label htmlFor="ai-category" className="flex items-center gap-2 text-sm font-medium">
                  Category <span className="text-expense">*</span> <ConfidenceDot value={parsed.fieldConfidence.category} />
                </label>
                <NativeSelect id="ai-category" value={s.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={ring("category")} aria-invalid={Boolean(fieldNote("category")) || undefined}>
                  <option value="">{s.type === "INCOME" ? "Choose an income category…" : "Choose an expense category…"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
                {note("category")}
                {s.categoryId && <p className="text-xs text-muted-foreground">Ledger account: {categories.find((c) => c.id === s.categoryId)?.accountName}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="ai-payment" className="flex items-center gap-2 text-sm font-medium">
                {s.type === "INCOME" ? "Received into" : s.type === "TRANSFER" ? "From account" : "Paid from"} <span className="text-expense">*</span>
                <ConfidenceDot value={parsed.fieldConfidence.account} />
              </label>
              <AccountSelect
                id="ai-payment"
                groups={paymentGroups}
                value={s.paymentAccountId}
                onChange={(v) => set("paymentAccountId", v)}
                placeholder="Choose an account…"
                className={ring("payment")}
                invalid={Boolean(fieldNote("payment"))}
              />
              {note("payment")}
            </div>

            {s.type === "TRANSFER" && (
              <div className="space-y-1.5">
                <label htmlFor="ai-to" className="text-sm font-medium">
                  To account <span className="text-expense">*</span>
                </label>
                <AccountSelect
                  id="ai-to"
                  groups={groupPaymentAccounts(payment.filter((a) => a.id !== s.paymentAccountId), ["RECEIVABLE", "PAYABLE"])}
                  value={s.toAccountId}
                  onChange={(v) => set("toAccountId", v)}
                  placeholder="Choose an account…"
                  className={ring("to")}
                  invalid={Boolean(fieldNote("to"))}
                />
                {note("to")}
              </div>
            )}

            {isMoneyType && (
              <FormField label={s.type === "INCOME" ? "Customer" : "Vendor"} htmlFor="ai-party" hint={s.counterparty && !(s.type === "INCOME" ? options.customers : options.vendors).includes(s.counterparty.trim()) ? "New — it will be added to your contacts." : undefined}>
                <Input id="ai-party" list={s.type === "INCOME" ? "ai-customers" : "ai-vendors"} value={s.counterparty} maxLength={160} onChange={(e) => set("counterparty", e.target.value)} placeholder="Optional" />
                <datalist id="ai-customers">
                  {options.customers.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <datalist id="ai-vendors">
                  {options.vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </FormField>
            )}

            <FormField label="Payment method" htmlFor="ai-method">
              <NativeSelect id="ai-method" value={s.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                <option value="">Not specified</option>
                {[...new Set([...PAYMENT_METHODS, ...(s.paymentMethod ? [s.paymentMethod] : [])])].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField label="Notes" htmlFor="ai-notes" className="sm:col-span-2">
              <Textarea id="ai-notes" rows={2} maxLength={2000} value={s.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional — anything an approver should know" className="min-h-[60px]" />
            </FormField>
          </div>

          {parsed.notes.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {parsed.notes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {n}
                </li>
              ))}
            </ul>
          )}

          <DuplicatePanel workspaceId={options.workspaceId} currency={s.currency} duplicates={dup.duplicates} ack={dup.ack} onAck={dup.setAck} checking={dup.checking} />

          {needsApproval && options.permissions.canPost && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {options.settings.requireApproval
                ? "This workspace requires approval before posting."
                : `Amounts of ${formatMoney(options.settings.approvalThreshold ?? "0", base)} or more need approval before posting.`}
            </p>
          )}
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
          <EnteredByStamp name={options.user.name} userRef={options.user.ref} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onDiscard} disabled={Boolean(busy)}>
              <X /> Discard
            </Button>
            <Button variant="outline" onClick={() => save("draft")} loading={busy === "draft"} disabled={Boolean(busy) && busy !== "draft"}>
              Save draft
            </Button>
            <Button variant={options.permissions.canPost ? "secondary" : "default"} onClick={() => save("submit")} loading={busy === "submit"} disabled={Boolean(busy) && busy !== "submit"}>
              <Send /> Submit for approval
            </Button>
            {options.permissions.canPost && (
              <GuardedButton
                blockedReason={needsApproval ? "Approval is required for this entry. Submit it for approval instead." : null}
                onClick={() => save("post")}
                loading={busy === "post"}
                disabled={Boolean(busy) && busy !== "post"}
              >
                <CheckCircle2 /> Post now
              </GuardedButton>
            )}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, CheckCircle2, ChevronDown, Info, Save, Send } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { CURRENCIES, dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS,
  type DuplicateWarning,
  type FormInitial,
  type FormOptions,
  type SavedTransaction,
  type TransactionTypeKey,
} from "@/lib/transactions/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, FormField } from "@/components/ui/feedback";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { AccountSelect, DuplicatePanel, EnteredByStamp, GuardedButton, SegmentedControl, duplicateProbe, useDuplicateCheck } from "./form-parts";
import { approvalRequired, groupByType, groupPaymentAccounts, isPaymentAccount, isValidAmount, isValidRate, normalizeAmount } from "./form-utils";
import { JournalLinesEditor, journalTotals, newLine, type EditorLine } from "./journal-lines-editor";

type FormState = {
  type: TransactionTypeKey;
  date: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  description: string;
  categoryId: string;
  paymentAccountId: string;
  toAccountId: string;
  accountOverrideId: string;
  lines: EditorLine[];
  isAdjustment: boolean;
  paymentMethod: string;
  reference: string;
  notes: string;
  customerName: string;
  vendorName: string;
  reason: string;
};

type Intent = "draft" | "submit" | "post";

const TYPE_OPTIONS = [
  { value: "EXPENSE" as const, label: "Expense", icon: ArrowUpRight, activeClass: "text-expense" },
  { value: "INCOME" as const, label: "Income", icon: ArrowDownLeft, activeClass: "text-income" },
  { value: "TRANSFER" as const, label: "Transfer", icon: ArrowLeftRight, activeClass: "text-info" },
  { value: "JOURNAL" as const, label: "Journal", icon: BookOpen },
];

function initialState(options: FormOptions, initial?: FormInitial): FormState {
  if (!initial) {
    return {
      type: "EXPENSE",
      date: options.today,
      amount: "",
      currency: options.currency,
      exchangeRate: "",
      description: "",
      categoryId: "",
      paymentAccountId: "",
      toAccountId: "",
      accountOverrideId: "",
      lines: [newLine(), newLine()],
      isAdjustment: false,
      paymentMethod: "",
      reference: "",
      notes: "",
      customerName: "",
      vendorName: "",
      reason: "",
    };
  }
  const t = initial.type;
  return {
    type: t,
    date: initial.date,
    amount: initial.amount,
    currency: initial.currency,
    exchangeRate: initial.currency === options.currency ? "" : initial.exchangeRate,
    description: initial.description,
    categoryId: initial.categoryId,
    paymentAccountId: t === "INCOME" ? initial.debitAccountId : t === "JOURNAL" ? "" : initial.creditAccountId,
    toAccountId: t === "TRANSFER" ? initial.debitAccountId : "",
    accountOverrideId: initial.accountOverrideId,
    lines: initial.lines.length ? initial.lines.map((l) => newLine(l)) : [newLine(), newLine()],
    isAdjustment: initial.isAdjustment,
    paymentMethod: initial.paymentMethod,
    reference: initial.reference,
    notes: initial.notes,
    customerName: initial.customerName,
    vendorName: initial.vendorName,
    reason: "",
  };
}

/**
 * Manual transaction entry (Expense / Income / Transfer / Journal), reused to
 * edit drafts. Attribution is never part of the form: the server takes it
 * from the session.
 */
export function TransactionForm({
  options,
  mode,
  transactionId,
  transactionRef,
  initial,
  creator,
}: {
  options: FormOptions;
  mode: "create" | "edit";
  transactionId?: string;
  transactionRef?: string;
  initial?: FormInitial;
  /** Original creator when editing (attribution never changes). */
  creator?: { name: string; ref: string };
}) {
  const router = useRouter();
  const [s, setS] = React.useState<FormState>(() => initialState(options, initial));
  const [attempted, setAttempted] = React.useState<"none" | "draft" | "full">("none");
  const [busy, setBusy] = React.useState<Intent | null>(null);
  const [advanced, setAdvanced] = React.useState(Boolean(initial?.accountOverrideId));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));

  const base = options.currency;
  const isJournal = s.type === "JOURNAL";
  const isMoney = s.type === "EXPENSE" || s.type === "INCOME";
  const currency = isJournal ? base : s.currency;
  const foreign = currency !== base;
  const payment = options.accounts.filter(isPaymentAccount);
  const categories = options.categories.filter((c) => c.kind === s.type);
  const category = options.categories.find((c) => c.id === s.categoryId) ?? null;
  const accountById = React.useMemo(() => new Map(options.accounts.map((a) => [a.id, a])), [options.accounts]);
  const jt = journalTotals(s.lines);
  const effectiveAmount = isJournal ? (jt.debit.gt(0) ? jt.debit.toFixed(2) : "") : normalizeAmount(s.amount);

  // ── Validation ──
  const errors: Partial<Record<string, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) errors.date = "Choose a date.";
  if (!s.description.trim()) errors.description = "Describe the transaction.";
  if (!isJournal && !isValidAmount(s.amount)) errors.amount = "Enter an amount greater than zero (max 2 decimals).";
  if (!isJournal && foreign && !isValidRate(s.exchangeRate)) errors.exchangeRate = `Enter the ${s.currency} → ${base} exchange rate.`;
  if (isJournal && !jt.valid) errors.lines = jt.errors[0] ?? "Balance the journal lines.";
  if (s.type === "TRANSFER" && s.paymentAccountId && s.paymentAccountId === s.toAccountId) errors.toAccountId = "Choose two different accounts.";
  const draftValid = Object.keys(errors).length === 0;

  const postErrors: Partial<Record<string, string>> = {};
  if (isMoney && !s.categoryId && !s.accountOverrideId) postErrors.categoryId = "Choose a category.";
  if (!isJournal && !s.paymentAccountId)
    postErrors.paymentAccountId = s.type === "INCOME" ? "Choose the account that received the money." : s.type === "TRANSFER" ? "Choose the source account." : "Choose the account it was paid from.";
  if (s.type === "TRANSFER" && !s.toAccountId) postErrors.toAccountId = "Choose the destination account.";
  const complete = draftValid && Object.keys(postErrors).length === 0;
  const err = (k: string) => (attempted === "none" ? undefined : (errors[k] ?? (attempted === "full" ? postErrors[k] : undefined)));

  const dup = useDuplicateCheck(options.workspaceId, duplicateProbe(s.type, effectiveAmount, s.date, s.description), { excludeId: transactionId });
  const needsApproval = approvalRequired(options.settings, effectiveAmount || "0");

  function changeType(t: TransactionTypeKey) {
    setS((p) => {
      const next: FormState = { ...p, type: t };
      if (category && category.kind !== t) next.categoryId = "";
      if (t !== "TRANSFER") next.toAccountId = "";
      if (t === "TRANSFER" && !p.paymentMethod) next.paymentMethod = "Transfer";
      if (t !== "EXPENSE" && t !== "INCOME") next.accountOverrideId = "";
      return next;
    });
  }

  function buildInput() {
    const common = {
      type: s.type,
      date: s.date,
      description: s.description.trim(),
      reference: s.reference.trim() || null,
      notes: s.notes.trim() || null,
    };
    if (isJournal) {
      return {
        ...common,
        currency: base,
        lines: s.lines.map((l) => ({
          accountId: l.accountId,
          debit: normalizeAmount(l.debit) || "0",
          credit: normalizeAmount(l.credit) || "0",
          description: l.description.trim() || null,
        })),
        isAdjustment: s.isAdjustment,
      };
    }
    const money = {
      ...common,
      amount: normalizeAmount(s.amount),
      currency: s.currency,
      exchangeRate: foreign ? s.exchangeRate.trim() : undefined,
      paymentMethod: s.paymentMethod || null,
    };
    if (s.type === "EXPENSE") {
      return { ...money, categoryId: s.categoryId || null, debitAccountId: s.accountOverrideId || null, creditAccountId: s.paymentAccountId || null, vendorName: s.vendorName.trim() || null };
    }
    if (s.type === "INCOME") {
      return { ...money, categoryId: s.categoryId || null, debitAccountId: s.paymentAccountId || null, creditAccountId: s.accountOverrideId || null, customerName: s.customerName.trim() || null };
    }
    return { ...money, categoryId: null, debitAccountId: s.toAccountId || null, creditAccountId: s.paymentAccountId || null };
  }

  async function submit(intent: Intent) {
    setAttempted(intent === "draft" ? "draft" : "full");
    if (intent === "draft" ? !draftValid : !complete) {
      toast.error(intent === "draft" ? "Fix the highlighted fields first." : "Complete the highlighted fields before submitting or posting.");
      return;
    }
    if (dup.needsAck) {
      toast.error("Confirm this is not a duplicate before saving.");
      return;
    }
    setBusy(intent);
    try {
      const input = buildInput();
      let saved: SavedTransaction;
      let duplicates: DuplicateWarning[] = [];
      if (mode === "edit" && transactionId) {
        const r = await apiFetch<{ transaction: SavedTransaction; duplicates: DuplicateWarning[] }>(`/api/w/${options.workspaceId}/transactions/${transactionId}`, {
          method: "PATCH",
          body: { input, reason: s.reason.trim() || null },
        });
        saved = r.transaction;
        duplicates = r.duplicates;
        if (intent !== "draft") {
          try {
            const next = await apiFetch<{ transaction: SavedTransaction }>(`/api/w/${options.workspaceId}/transactions/${transactionId}/${intent === "submit" ? "submit" : "post"}`, { method: "POST", body: {} });
            saved = next.transaction;
          } catch (e) {
            toast.error(`Changes saved, but ${intent === "submit" ? "submitting" : "posting"} failed: ${e instanceof Error ? e.message : "unknown error"}`);
            router.push(`/w/${options.workspaceId}/transactions/${transactionId}`);
            router.refresh();
            return;
          }
        }
        toast.success(`${saved.ref} ${intent === "draft" ? "updated" : intent === "submit" ? "updated and submitted for approval" : "updated and posted"}`);
        router.push(`/w/${options.workspaceId}/transactions/${transactionId}`);
        router.refresh();
        return;
      }

      const r = await apiFetch<{ transaction: SavedTransaction; duplicates: DuplicateWarning[] }>(`/api/w/${options.workspaceId}/transactions`, {
        body: { input, intent, source: "MANUAL" },
      });
      saved = r.transaction;
      duplicates = r.duplicates;
      const url = `/w/${options.workspaceId}/transactions/${saved.id}`;
      toast.success(`${saved.ref} ${saved.status === "POSTED" ? "posted" : saved.status === "PENDING_APPROVAL" ? "submitted for approval" : "saved as a draft"}`, {
        description: `${saved.description} · ${formatMoney(saved.amount, saved.currency, { decimals: true })}`,
        action: { label: "View", onClick: () => router.push(url) },
      });
      if (duplicates.length) toast.warning(`${duplicates.length} similar transaction${duplicates.length === 1 ? "" : "s"} already exist${duplicates.length === 1 ? "s" : ""}.`);
      // Ready for the next entry; keep the type, date, currency and paying account for quick batches.
      setS((p) => ({
        ...initialState(options),
        type: p.type,
        date: p.date,
        currency: p.currency,
        exchangeRate: p.exchangeRate,
        paymentAccountId: p.paymentAccountId,
        paymentMethod: p.paymentMethod,
      }));
      setAttempted("none");
      setAdvanced(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the transaction");
    } finally {
      setBusy(null);
    }
  }

  // ── Journal preview ──
  const baseAmount = !isJournal && isValidAmount(s.amount) ? (foreign ? (isValidRate(s.exchangeRate) ? dec(normalizeAmount(s.amount)).times(dec(s.exchangeRate)).toFixed(2) : null) : dec(normalizeAmount(s.amount)).toFixed(2)) : null;
  const nameOf = (id: string) => accountById.get(id)?.name ?? null;
  const ledgerSide = s.accountOverrideId ? nameOf(s.accountOverrideId) : (category?.accountName ?? null);
  const preview: { side: "Dr" | "Cr"; account: string | null; amount: string | null }[] = isJournal
    ? s.lines
        .filter((l) => l.accountId && (normalizeAmount(l.debit) || normalizeAmount(l.credit)))
        .map((l) => (normalizeAmount(l.debit) ? { side: "Dr" as const, account: nameOf(l.accountId), amount: normalizeAmount(l.debit) } : { side: "Cr" as const, account: nameOf(l.accountId), amount: normalizeAmount(l.credit) }))
    : s.type === "EXPENSE"
      ? [
          { side: "Dr", account: ledgerSide, amount: baseAmount },
          { side: "Cr", account: nameOf(s.paymentAccountId), amount: baseAmount },
        ]
      : s.type === "INCOME"
        ? [
            { side: "Dr", account: nameOf(s.paymentAccountId), amount: baseAmount },
            { side: "Cr", account: ledgerSide, amount: baseAmount },
          ]
        : [
            { side: "Dr", account: nameOf(s.toAccountId), amount: baseAmount },
            { side: "Cr", account: nameOf(s.paymentAccountId), amount: baseAmount },
          ];

  const editing = mode === "edit";
  const canPost = options.permissions.canPost;
  const postBlocked = needsApproval ? "Approval is required for this transaction. Submit it for approval instead." : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit("draft");
      }}
      className="grid gap-6 lg:grid-cols-3"
      noValidate
    >
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{editing ? `Edit ${transactionRef ?? "draft"}` : "Transaction details"}</CardTitle>
              <SegmentedControl ariaLabel="Transaction type" value={s.type} onChange={changeType} options={TYPE_OPTIONS} size="sm" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Date" htmlFor="t-date" required error={err("date")}>
              <Input id="t-date" type="date" value={s.date} onChange={(e) => set("date", e.target.value)} aria-invalid={Boolean(err("date")) || undefined} />
            </FormField>

            {!isJournal ? (
              <FormField label="Amount" htmlFor="t-amount" required error={err("amount")} hint={isValidAmount(s.amount) ? formatMoney(normalizeAmount(s.amount), s.currency, { decimals: true }) : undefined}>
                <div className="flex gap-2">
                  <Input
                    id="t-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={s.amount}
                    onChange={(e) => set("amount", e.target.value)}
                    className="tabular flex-1"
                    aria-invalid={Boolean(err("amount")) || undefined}
                  />
                  <NativeSelect value={s.currency} onChange={(e) => set("currency", e.target.value)} className="w-24" aria-label="Currency">
                    {[...new Set([base, s.currency, ...CURRENCIES])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </FormField>
            ) : (
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <Switch checked={s.isAdjustment} onCheckedChange={(v) => set("isAdjustment", v)} aria-label="Adjustment entry" />
                  <span>
                    <span className="font-medium">Adjustment entry</span>
                    <span className="block text-xs text-muted-foreground">Posts as an ADJUSTMENT journal (period corrections).</span>
                  </span>
                </label>
              </div>
            )}

            {!isJournal && foreign && (
              <FormField
                label={`Exchange rate (${s.currency} → ${base})`}
                htmlFor="t-rate"
                required
                error={err("exchangeRate")}
                hint={baseAmount ? `Books as ${formatMoney(baseAmount, base, { decimals: true })}` : `How many ${base} for 1 ${s.currency}`}
                className="sm:col-span-2"
              >
                <Input id="t-rate" inputMode="decimal" placeholder="e.g. 83.25" value={s.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} className="tabular" />
              </FormField>
            )}

            <FormField label="Description" htmlFor="t-desc" required error={err("description")} className="sm:col-span-2">
              <Input id="t-desc" value={s.description} maxLength={500} placeholder={isJournal ? "e.g. Accrued salaries for October" : "e.g. Office electricity — October"} onChange={(e) => set("description", e.target.value)} aria-invalid={Boolean(err("description")) || undefined} />
            </FormField>

            {isMoney && (
              <FormField label="Category" htmlFor="t-category" required error={err("categoryId")} hint={category ? `Ledger account: ${category.accountName}` : undefined}>
                <NativeSelect id="t-category" value={s.categoryId} onChange={(e) => set("categoryId", e.target.value)} aria-invalid={Boolean(err("categoryId")) || undefined}>
                  <option value="">{s.type === "INCOME" ? "Choose an income category…" : "Choose an expense category…"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            )}

            {!isJournal && (
              <FormField
                label={s.type === "INCOME" ? "Received into" : s.type === "TRANSFER" ? "From account" : "Paid from"}
                htmlFor="t-payment"
                required
                error={err("paymentAccountId")}
              >
                <AccountSelect
                  id="t-payment"
                  groups={groupPaymentAccounts(payment, s.type === "INCOME" ? ["PAYABLE", "CREDIT_CARD"] : s.type === "EXPENSE" ? ["RECEIVABLE"] : ["RECEIVABLE", "PAYABLE"])}
                  value={s.paymentAccountId}
                  onChange={(v) => set("paymentAccountId", v)}
                  placeholder="Choose an account…"
                  invalid={Boolean(err("paymentAccountId"))}
                />
              </FormField>
            )}

            {s.type === "TRANSFER" && (
              <FormField label="To account" htmlFor="t-to" required error={err("toAccountId")}>
                <AccountSelect
                  id="t-to"
                  groups={groupPaymentAccounts(payment.filter((a) => a.id !== s.paymentAccountId), ["RECEIVABLE", "PAYABLE"])}
                  value={s.toAccountId}
                  onChange={(v) => set("toAccountId", v)}
                  placeholder="Choose an account…"
                  invalid={Boolean(err("toAccountId"))}
                />
              </FormField>
            )}

            {s.type === "EXPENSE" && (
              <FormField label="Vendor" htmlFor="t-vendor" hint={s.vendorName.trim() && !options.vendors.includes(s.vendorName.trim()) ? "New vendor — it will be added to your contacts." : "Optional"}>
                <Input id="t-vendor" list="t-vendors" value={s.vendorName} maxLength={160} onChange={(e) => set("vendorName", e.target.value)} />
                <datalist id="t-vendors">
                  {options.vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </FormField>
            )}
            {s.type === "INCOME" && (
              <FormField label="Customer" htmlFor="t-customer" hint={s.customerName.trim() && !options.customers.includes(s.customerName.trim()) ? "New customer — it will be added to your contacts." : "Optional"}>
                <Input id="t-customer" list="t-customers" value={s.customerName} maxLength={160} onChange={(e) => set("customerName", e.target.value)} />
                <datalist id="t-customers">
                  {options.customers.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </FormField>
            )}

            {!isJournal && (
              <FormField label="Payment method" htmlFor="t-method">
                <NativeSelect id="t-method" value={s.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                  <option value="">Not specified</option>
                  {[...new Set([...PAYMENT_METHODS, ...(s.paymentMethod ? [s.paymentMethod] : [])])].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            )}

            <FormField label="Reference" htmlFor="t-ref" hint="Invoice, bill or cheque number (optional)">
              <Input id="t-ref" value={s.reference} maxLength={120} onChange={(e) => set("reference", e.target.value)} />
            </FormField>

            {isMoney && (
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={advanced}
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} />
                  Post to a specific ledger account instead of the category&apos;s account
                </button>
                {advanced && (
                  <div className="mt-2 space-y-1.5">
                    <AccountSelect
                      groups={groupByType(options.accounts.filter((a) => !isPaymentAccount(a)))}
                      value={s.accountOverrideId}
                      onChange={(v) => set("accountOverrideId", v)}
                      placeholder={category ? `Use the category's account (${category.accountName})` : "Use the category's account"}
                    />
                    <p className="text-xs text-muted-foreground">
                      For example, record equipment purchases against a fixed-asset account. The {s.type === "EXPENSE" ? "debit" : "credit"} side uses this account.
                    </p>
                  </div>
                )}
              </div>
            )}

            <FormField label="Notes" htmlFor="t-notes" className="sm:col-span-2">
              <Textarea id="t-notes" rows={2} maxLength={2000} value={s.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional — context for approvers and auditors" className="min-h-[60px]" />
            </FormField>
          </CardContent>
        </Card>

        {isJournal && (
          <Card>
            <CardHeader>
              <CardTitle>Journal lines</CardTitle>
              <CardDescription>Amounts are in {base}. Debits must equal credits before you can save.</CardDescription>
            </CardHeader>
            <CardContent>
              <JournalLinesEditor accounts={options.accounts} lines={s.lines} onChange={(lines) => set("lines", lines)} currency={base} showErrors={attempted !== "none"} />
            </CardContent>
          </Card>
        )}

        {editing && (
          <Card>
            <CardHeader>
              <CardTitle>Reason for change</CardTitle>
              <CardDescription>Recorded in the transaction&apos;s audit history together with the before and after values.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea value={s.reason} maxLength={500} rows={2} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Corrected the amount to match the invoice" aria-label="Reason for change" />
            </CardContent>
          </Card>
        )}

        <DuplicatePanel workspaceId={options.workspaceId} currency={currency} duplicates={dup.duplicates} ack={dup.ack} onAck={dup.setAck} checking={dup.checking} />
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Journal preview</CardTitle>
            <CardDescription>What will be posted to the general ledger{foreign && !isJournal ? ` (in ${base})` : ""}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y rounded-lg border text-sm">
              {preview.length ? (
                preview.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-2">
                    <span className={cn("w-6 shrink-0 text-xs font-semibold", p.side === "Dr" ? "text-info" : "text-warning")}>{p.side}</span>
                    <span className={cn("min-w-0 flex-1 truncate", !p.account && "italic text-muted-foreground")}>{p.account ?? "Account not chosen"}</span>
                    <span className="tabular shrink-0 text-muted-foreground">{p.amount ? formatMoney(p.amount, base, { decimals: true }) : "—"}</span>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-muted-foreground">Add journal lines to see the entry.</li>
              )}
            </ul>
            {needsApproval && (
              <Alert variant="info">
                {options.settings.requireApproval
                  ? "This workspace requires approval before posting."
                  : `Amounts of ${formatMoney(options.settings.approvalThreshold ?? "0", base)} or more need approval before posting.`}
              </Alert>
            )}
            <EnteredByStamp name={editing && creator ? creator.name : options.user.name} userRef={editing && creator ? creator.ref : options.user.ref} className="border-t pt-3" />
            {editing && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" /> The original creator is kept. Your edit is recorded as “Last modified by {options.user.name}” in the audit history.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 p-4">
            <Button type="submit" variant="outline" loading={busy === "draft"} disabled={Boolean(busy) && busy !== "draft"} className="w-full">
              <Save /> {editing ? "Save changes" : "Save draft"}
            </Button>
            <Button type="button" variant={canPost ? "secondary" : "default"} onClick={() => submit("submit")} loading={busy === "submit"} disabled={Boolean(busy) && busy !== "submit"} className="w-full">
              <Send /> {editing ? "Save & submit for approval" : "Submit for approval"}
            </Button>
            {canPost && (
              <GuardedButton type="button" blockedReason={postBlocked} wrapperClassName="w-full" onClick={() => submit("post")} loading={busy === "post"} disabled={Boolean(busy) && busy !== "post"} className="w-full">
                <CheckCircle2 /> {editing ? "Save & post" : "Post now"}
              </GuardedButton>
            )}
            {editing && transactionId && (
              <Button asChild variant="ghost" className="w-full">
                <Link href={`/w/${options.workspaceId}/transactions/${transactionId}`}>Cancel</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

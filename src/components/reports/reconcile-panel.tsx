"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { apiFetch } from "@/lib/client/api";
import { formatDate } from "@/lib/dates";
import { journalRef, txnRef } from "@/lib/ids";
import { Decimal, dec, formatMoney, money2, parseAmountInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EntryTypeBadge } from "./entry-type-badge";

export type ReconcileLine = {
  id: string;
  date: string;
  journalNumber: number;
  journalType: string;
  description: string;
  transactionId: string | null;
  transactionNumber: number | null;
  enteredBy: string;
  debit: string;
  credit: string;
};

type Props = {
  workspaceId: string;
  accountId: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  subtype: string | null;
  currency: string;
  today: string;
  clearedBalance: string;
  clearedCount: number;
  lastStatementDate: string | null;
  lines: ReconcileLine[];
  truncated: boolean;
  canManage: boolean;
};

const fmt = (v: Decimal | string, currency: string) => formatMoney(v instanceof Decimal ? v.toString() : v, currency, { decimals: true });

export function ReconcilePanel(props: Props) {
  const { workspaceId, accountId, accountType, subtype, currency, today, lines, canManage } = props;
  const router = useRouter();
  const isCard = subtype === "CREDIT_CARD";
  const debitNormal = accountType === "ASSET" || accountType === "EXPENSE";
  const natural = React.useCallback((l: { debit: string; credit: string }) => (debitNormal ? dec(l.debit).minus(dec(l.credit)) : dec(l.credit).minus(dec(l.debit))), [debitNormal]);

  const [statementDate, setStatementDate] = React.useState(today);
  const [balanceInput, setBalanceInput] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(statementDate);
  const dateError = !dateValid
    ? "Enter the statement date"
    : statementDate > today
      ? "The statement date cannot be in the future"
      : props.lastStatementDate && statementDate < props.lastStatementDate
        ? `Must be on or after the last reconciliation (${formatDate(props.lastStatementDate)})`
        : null;

  const eligible = React.useMemo(() => (dateValid ? lines.filter((l) => l.date <= statementDate) : []), [lines, statementDate, dateValid]);
  const hiddenLater = lines.length - eligible.length;
  const chosen = React.useMemo(() => eligible.filter((l) => selected.has(l.id)), [eligible, selected]);

  const statementBalance = balanceInput.trim() === "" ? null : parseAmountInput(balanceInput);
  const balanceError = balanceInput.trim() !== "" && statementBalance === null ? "Enter a number, e.g. 125000.50 or -2500" : null;

  const prevCleared = dec(props.clearedBalance);
  const selectedNet = chosen.reduce((s, l) => s.plus(natural(l)), new Decimal(0));
  const cleared = prevCleared.plus(selectedNet);
  const bookAtDate = prevCleared.plus(eligible.reduce((s, l) => s.plus(natural(l)), new Decimal(0)));
  const uncleared = bookAtDate.minus(cleared);
  const difference = statementBalance === null ? null : dec(statementBalance).minus(cleared);
  const balanced = difference !== null && difference.isZero();
  const ready = canManage && !dateError && statementBalance !== null && !balanceError;

  const allChecked = eligible.length > 0 && chosen.length === eligible.length;
  const someChecked = chosen.length > 0 && !allChecked;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const l of eligible) {
        if (on) next.add(l.id);
        else next.delete(l.id);
      }
      return next;
    });

  const submit = async (acceptDifference: boolean) => {
    if (!ready || statementBalance === null) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/w/${workspaceId}/reconciliations`, {
        method: "POST",
        body: { accountId, statementDate, statementBalance, lineIds: chosen.map((l) => l.id), acceptDifference },
      });
      toast.success(
        acceptDifference && difference && !difference.isZero()
          ? `Reconciled ${chosen.length} item${chosen.length === 1 ? "" : "s"} with a recorded difference of ${fmt(difference, currency)}`
          : `Reconciled ${chosen.length} item${chosen.length === 1 ? "" : "s"} to ${formatDate(statementDate)}`,
      );
      setSelected(new Set());
      setBalanceInput("");
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete the reconciliation");
    } finally {
      setSubmitting(false);
    }
  };

  const inLabel = isCard ? "Payments" : "Money in";
  const outLabel = isCard ? "Charges" : "Money out";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconcile against a statement</CardTitle>
        <CardDescription>
          Tick the entries that appear on your {isCard ? "card" : "bank"} statement up to the statement date. When the cleared balance matches the statement, complete the
          reconciliation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canManage && (
          <Alert variant="info" title="View only">
            You can explore the reconciliation, but completing one requires the Manage Accounts permission.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <FormField label="Statement date" htmlFor="rec-date" error={dateError} hint={props.lastStatementDate ? `Last reconciled to ${formatDate(props.lastStatementDate)}` : "First reconciliation for this account"}>
            <Input id="rec-date" type="date" value={statementDate} max={today} min={props.lastStatementDate ?? undefined} onChange={(e) => setStatementDate(e.target.value)} />
          </FormField>
          <FormField
            label={isCard ? "Statement balance owed" : "Statement ending balance"}
            htmlFor="rec-balance"
            error={balanceError}
            hint={isCard ? "Amount owed on the card statement" : "Closing balance printed on the statement"}
          >
            <Input id="rec-balance" inputMode="decimal" placeholder="0.00" value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} className="tabular" />
          </FormField>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3" aria-live="polite">
          <div className="rounded-lg border p-3">
            <dt className="text-xs font-medium text-muted-foreground">Statement balance</dt>
            <dd className="tabular mt-1 text-lg font-semibold">{statementBalance === null ? "—" : fmt(statementBalance, currency)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs font-medium text-muted-foreground">Cleared balance</dt>
            <dd className="tabular mt-1 text-lg font-semibold">{fmt(cleared, currency)}</dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">
              {fmt(prevCleared, currency)} previously reconciled ({props.clearedCount}) + {fmt(selectedNet, currency)} selected ({chosen.length})
            </dd>
          </div>
          <div
            className={cn(
              "rounded-lg border p-3",
              difference !== null && (balanced ? "border-income/40 bg-income-soft" : "border-warning/40 bg-warning-soft"),
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">Difference</dt>
            <dd className={cn("tabular mt-1 flex items-center gap-1.5 text-lg font-semibold", difference !== null && (balanced ? "text-income" : "text-warning"))}>
              {difference === null ? (
                "—"
              ) : (
                <>
                  {balanced ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
                  {fmt(difference, currency)}
                </>
              )}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{difference === null ? "Enter the statement balance" : balanced ? "Balanced — ready to complete" : "Statement minus cleared balance"}</dd>
          </div>
        </dl>
        {dateValid && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Book balance at {formatDate(statementDate)}: <span className="tabular font-medium text-foreground">{fmt(bookAtDate, currency)}</span> · Uncleared items:{" "}
              <span className="tabular font-medium text-foreground">{fmt(uncleared, currency)}</span> ({eligible.length - chosen.length})
              {hiddenLater > 0 && ` · ${hiddenLater} later ${hiddenLater === 1 ? "entry is" : "entries are"} hidden`}
            </span>
          </p>
        )}

        {lines.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Everything is reconciled" description="There are no unreconciled postings on this account." className="rounded-lg border border-dashed py-8" />
        ) : eligible.length === 0 ? (
          <EmptyState title="No unreconciled entries up to this date" description="Choose a later statement date to see more entries." className="rounded-lg border border-dashed py-8" />
        ) : (
          <div className="relative max-h-[480px] overflow-auto rounded-lg border scrollbar-thin">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Unreconciled entries up to the statement date</caption>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="whitespace-nowrap text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label="Select all entries up to the statement date"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5">Date</th>
                  <th scope="col" className="px-3 py-2.5">JE</th>
                  <th scope="col" className="px-3 py-2.5">Description</th>
                  <th scope="col" className="px-3 py-2.5">Transaction</th>
                  <th scope="col" className="px-3 py-2.5">Entered by</th>
                  <th scope="col" className="px-3 py-2.5 text-right">{inLabel}</th>
                  <th scope="col" className="px-3 py-2.5 text-right">{outLabel}</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((l) => {
                  const on = selected.has(l.id);
                  // "In" is the side that increases cash (debit) or reduces card dues (debit).
                  const inAmt = dec(l.debit);
                  const outAmt = dec(l.credit);
                  return (
                    <tr
                      key={l.id}
                      className={cn("cursor-pointer border-t transition-colors hover:bg-muted/40", on && "bg-accent/60 hover:bg-accent/70")}
                      onClick={() => toggle(l.id, !on)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={on} onCheckedChange={(v) => toggle(l.id, v === true)} aria-label={`Mark ${journalRef(l.journalNumber)} as cleared`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(l.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="font-mono text-xs">{journalRef(l.journalNumber)}</span>
                        {l.journalType !== "STANDARD" && <EntryTypeBadge type={l.journalType} className="ml-1.5" />}
                      </td>
                      <td className="max-w-[280px] px-3 py-2">
                        <span className="line-clamp-2" title={l.description}>
                          {l.description}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {l.transactionId && l.transactionNumber !== null ? (
                          <Link href={`/w/${workspaceId}/transactions/${l.transactionId}`} className="font-medium text-primary hover:underline">
                            {txnRef(l.transactionNumber)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{l.enteredBy}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-right">{inAmt.isZero() ? "" : fmt(money2(inAmt), currency)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-right">{outAmt.isZero() ? "" : fmt(money2(outAmt), currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {props.truncated && <p className="text-xs text-muted-foreground">Showing the oldest 2,000 unreconciled entries. Reconcile these first to see later ones.</p>}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
          {ready && difference !== null && !balanced && (
            <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={submitting}>
              Complete with difference…
            </Button>
          )}
          <Button variant="success" onClick={() => submit(false)} disabled={!ready || !balanced} loading={submitting && !confirmOpen}>
            <CheckCircle2 /> Complete reconciliation
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <DialogContent title="Complete with a difference?" description="The statement and cleared balances do not match.">
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Statement balance</dt>
              <dd className="tabular text-right font-medium">{statementBalance === null ? "—" : fmt(statementBalance, currency)}</dd>
              <dt className="text-muted-foreground">Cleared balance</dt>
              <dd className="tabular text-right font-medium">{fmt(cleared, currency)}</dd>
              <dt className="font-medium">Difference</dt>
              <dd className="tabular text-right font-semibold text-warning">{difference ? fmt(difference, currency) : "—"}</dd>
            </dl>
            <p className="text-muted-foreground">
              The {chosen.length} selected {chosen.length === 1 ? "entry" : "entries"} will be marked as reconciled and the difference will be recorded on this
              reconciliation and in the audit log. No journal entry is created — post an adjustment separately if the difference is a real bank charge or error.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={() => submit(true)} loading={submitting}>
              Record difference and complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

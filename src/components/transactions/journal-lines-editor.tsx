"use client";

import * as React from "react";
import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { dec, Decimal, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AccountOption } from "@/lib/transactions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountSelect } from "./form-parts";
import { groupByType, normalizeAmount } from "./form-utils";

export type EditorLine = { key: string; accountId: string; debit: string; credit: string; description: string };

let seq = 0;
export function newLine(partial: Partial<Omit<EditorLine, "key">> = {}): EditorLine {
  seq += 1;
  return { key: `l${Date.now().toString(36)}${seq}`, accountId: "", debit: "", credit: "", description: "", ...partial };
}

const TWO_DP = /^\d+(\.\d{1,2})?$/;

function lineAmount(v: string): Decimal | null {
  const n = normalizeAmount(v);
  if (!n) return new Decimal(0);
  return TWO_DP.test(n) ? dec(n) : null;
}

export function journalTotals(lines: EditorLine[]) {
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  const errors: string[] = [];
  lines.forEach((l, i) => {
    const d = lineAmount(l.debit);
    const c = lineAmount(l.credit);
    if (!d || !c) {
      errors.push(`Line ${i + 1}: amounts must be positive with at most 2 decimals.`);
      return;
    }
    if (!l.accountId) errors.push(`Line ${i + 1}: choose an account.`);
    if (d.gt(0) && c.gt(0)) errors.push(`Line ${i + 1}: use either a debit or a credit, not both.`);
    if (d.isZero() && c.isZero()) errors.push(`Line ${i + 1}: enter a debit or a credit.`);
    debit = debit.plus(d);
    credit = credit.plus(c);
  });
  if (lines.length < 2) errors.push("A journal needs at least two lines.");
  const balanced = debit.eq(credit) && debit.gt(0);
  if (!debit.eq(credit)) errors.push("Debits must equal credits.");
  return { debit, credit, difference: debit.minus(credit), balanced, valid: balanced && errors.length === 0, errors };
}

/** Multi-line journal editor with live Balanced / Unbalanced totals. */
export function JournalLinesEditor({
  accounts,
  lines,
  onChange,
  currency,
  showErrors,
}: {
  accounts: AccountOption[];
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  currency: string;
  showErrors?: boolean;
}) {
  const groups = React.useMemo(() => groupByType(accounts), [accounts]);
  const totals = journalTotals(lines);
  const update = (key: string, patch: Partial<EditorLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)_2.25rem] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Account</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span>Line description</span>
        <span className="sr-only">Remove</span>
      </div>
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const d = lineAmount(l.debit);
          const c = lineAmount(l.credit);
          const bad = showErrors && (!l.accountId || !d || !c || (d.isZero() && c.isZero()) || (d.gt(0) && c.gt(0)));
          return (
            <li
              key={l.key}
              className={cn(
                "grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)_2.25rem] md:items-center md:border-0 md:p-0",
                bad && "border-expense/50 md:rounded-md md:ring-1 md:ring-expense/40",
              )}
            >
              <AccountSelect
                groups={groups}
                value={l.accountId}
                onChange={(v) => update(l.key, { accountId: v })}
                placeholder={`Line ${i + 1}: choose account…`}
                className="col-span-2 md:col-span-1"
                invalid={showErrors && !l.accountId}
              />
              <Input
                inputMode="decimal"
                placeholder="Debit"
                value={l.debit}
                onChange={(e) => update(l.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })}
                className="tabular text-right"
                aria-label={`Line ${i + 1} debit`}
              />
              <Input
                inputMode="decimal"
                placeholder="Credit"
                value={l.credit}
                onChange={(e) => update(l.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
                className="tabular text-right"
                aria-label={`Line ${i + 1} credit`}
              />
              <Input
                placeholder="Description (optional)"
                value={l.description}
                maxLength={300}
                onChange={(e) => update(l.key, { description: e.target.value })}
                className="col-span-2 md:col-span-1"
                aria-label={`Line ${i + 1} description`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                disabled={lines.length <= 2}
                aria-label={`Remove line ${i + 1}`}
                className="col-span-2 w-full text-muted-foreground hover:text-expense md:col-span-1 md:w-9"
              >
                <Trash2 />
                <span className="md:sr-only">Remove line</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 rounded-lg bg-muted/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Pre-fill the balancing amount on the new line.
            const diff = totals.difference;
            onChange([...lines, newLine(diff.isZero() ? {} : diff.gt(0) ? { credit: diff.toFixed(2) } : { debit: diff.abs().toFixed(2) })]);
          }}
          disabled={lines.length >= 200}
        >
          <Plus /> Add line
        </Button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Debit <span className="tabular font-semibold text-foreground">{formatMoney(totals.debit.toFixed(2), currency, { decimals: true })}</span>
          </span>
          <span className="text-muted-foreground">
            Credit <span className="tabular font-semibold text-foreground">{formatMoney(totals.credit.toFixed(2), currency, { decimals: true })}</span>
          </span>
          {totals.balanced ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Balanced
            </Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <XCircle className="h-3 w-3" /> Unbalanced
              {!totals.difference.isZero() && <span className="tabular">({formatMoney(totals.difference.abs().toFixed(2), currency, { decimals: true })})</span>}
            </Badge>
          )}
        </div>
      </div>
      {showErrors && totals.errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-expense">
          {[...new Set(totals.errors)].slice(0, 5).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

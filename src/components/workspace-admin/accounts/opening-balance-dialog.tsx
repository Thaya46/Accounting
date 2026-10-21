"use client";

import * as React from "react";
import type { AccountRow } from "@/lib/workspace-admin/accounts";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { useMutation } from "../shared";

const AMOUNT_RE = /^-?\d{1,15}(\.\d{1,2})?$/;

export function OpeningBalanceDialog({
  workspaceId,
  account,
  currency,
  defaultDate,
  today,
  onClose,
}: {
  workspaceId: string;
  account: AccountRow;
  currency: string;
  defaultDate: string;
  today: string;
  onClose: () => void;
}) {
  const hasExisting = account.openingBalanceDate !== null;
  const [amount, setAmount] = React.useState(hasExisting ? account.openingBalance : "");
  const [date, setDate] = React.useState(account.openingBalanceDate ?? (defaultDate > today ? today : defaultDate));
  const { pending, run } = useMutation();

  const cleaned = amount.replace(/,/g, "").trim();
  const valid = AMOUNT_RE.test(cleaned) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const debitNormal = account.type === "ASSET";
  const side = debitNormal ? "debit" : "credit";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(
      `/api/w/${workspaceId}/accounts/${account.id}/opening-balance`,
      { method: "POST", body: { amount: cleaned, date } },
      { success: `Opening balance for ${account.name} set to ${formatMoney(cleaned, currency, { decimals: true })}` },
    );
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent title={`Opening balance · ${account.name}`} description={`${account.code} · posted against Opening Balance Equity`}>
        <form onSubmit={submit} className="space-y-4">
          {hasExisting && (
            <Alert variant="info" title="An opening balance is already set">
              Currently {formatMoney(account.openingBalance, currency, { decimals: true })} as of {formatDate(account.openingBalanceDate!)}. Saving reverses that opening entry and
              posts a new one, so the ledger history stays intact.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={`Amount (${currency})`}
              htmlFor="ob-amount"
              required
              hint={`Positive = normal ${side} balance. Use a negative amount for an opposite balance (e.g. an overdraft).`}
              error={cleaned && !AMOUNT_RE.test(cleaned) ? "Up to 2 decimals, e.g. 25000.00 or -1500" : null}
            >
              <Input id="ob-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="tabular" placeholder="0.00" autoFocus required />
            </FormField>
            <FormField label="As of date" htmlFor="ob-date" required hint="Usually the first day of your financial year.">
              <Input id="ob-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
            </FormField>
          </div>
          {cleaned === "0" || cleaned === "0.00" ? (
            <p className="text-xs text-muted-foreground">A zero amount removes the opening balance (the previous opening entry is reversed).</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!valid}>
              Post opening balance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

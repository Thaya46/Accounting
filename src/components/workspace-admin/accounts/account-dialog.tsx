"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { AccountRow } from "@/lib/workspace-admin/accounts";
import {
  ACCOUNT_CODE_RE,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_INFO,
  BANK_DETAIL_SUBTYPES,
  SUBTYPES_BY_TYPE,
  SYSTEM_ONLY_SUBTYPES,
  subtypeLabel,
  type AccountTypeKey,
} from "@/lib/workspace-admin/constants";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { useMutation } from "../shared";

function typeLockReason(a: AccountRow | null): string | null {
  if (!a) return null;
  if (a.isSystem) return "System accounts keep their type.";
  if (a.hasLedgerEntries) return "Locked: the account already has ledger entries.";
  if (a.usedByTransactions) return "Locked: transactions already use this account.";
  if (a.categoryCount > 0) return "Locked: categories are linked to this account.";
  return null;
}

export function AccountDialog({ workspaceId, account, defaultType = "ASSET", onClose }: { workspaceId: string; account: AccountRow | null; defaultType?: AccountTypeKey; onClose: () => void }) {
  const [form, setForm] = React.useState({
    code: account?.code ?? "",
    name: account?.name ?? "",
    type: (account?.type ?? defaultType) as AccountTypeKey,
    subtype: account?.subtype ?? "",
    description: account?.description ?? "",
    bankName: account?.bankName ?? "",
    accountNumberLast4: account?.accountNumberLast4 ?? "",
    isActive: account?.isActive ?? true,
  });
  const { pending, run } = useMutation();
  const typeLock = typeLockReason(account);

  const subtypeOptions = SUBTYPES_BY_TYPE[form.type].filter((s) => !SYSTEM_ONLY_SUBTYPES.includes(s) || s === account?.subtype);
  const showBank = BANK_DETAIL_SUBTYPES.includes(form.subtype);
  const codeValid = ACCOUNT_CODE_RE.test(form.code);
  const last4Valid = !showBank || form.accountNumberLast4 === "" || /^\d{4}$/.test(form.accountNumberLast4);
  const deactivateBlocked = account && account.isActive && account.activeCategoryCount > 0;

  function setType(type: AccountTypeKey) {
    setForm((f) => ({ ...f, type, subtype: SUBTYPES_BY_TYPE[type].includes(f.subtype) ? f.subtype : "" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      code: form.code,
      name: form.name,
      ...(account?.isSystem ? {} : { type: form.type, subtype: form.subtype || null }),
      description: form.description || null,
      bankName: showBank ? form.bankName || null : null,
      accountNumberLast4: showBank ? form.accountNumberLast4 || null : null,
      ...(account?.isSystem ? {} : { isActive: form.isActive }),
    };
    const res = account
      ? await run(`/api/w/${workspaceId}/accounts/${account.id}`, { method: "PATCH", body }, { success: `${form.name} updated` })
      : await run(`/api/w/${workspaceId}/accounts`, { method: "POST", body }, { success: `${form.name} created` });
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        title={account ? `Edit ${account.name}` : "New account"}
        description={account ? `${account.code} · ${ACCOUNT_TYPE_INFO[account.type].label}` : "Add a ledger account to the chart of accounts."}
        className="max-w-xl"
      >
        <form onSubmit={submit} className="space-y-4">
          {account?.isSystem && <Alert variant="info">This is a system account used by the accounting engine. You can rename it, but not change its type or deactivate it.</Alert>}
          <div className="grid gap-4 sm:grid-cols-[1fr_1.6fr]">
            <FormField label="Code" htmlFor="acc-code" required error={form.code && !codeValid ? "Uppercase letters, digits and single dashes" : null} hint="e.g. BANK-HDFC">
              <Input
                id="acc-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, "-") }))}
                maxLength={30}
                className="font-mono uppercase"
                aria-invalid={Boolean(form.code) && !codeValid}
                required
              />
            </FormField>
            <FormField label="Name" htmlFor="acc-name" required>
              <Input id="acc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} required />
            </FormField>
            <FormField label="Type" htmlFor="acc-type" required hint={typeLock ?? ACCOUNT_TYPE_INFO[form.type].description}>
              <NativeSelect id="acc-type" value={form.type} onChange={(e) => setType(e.target.value as AccountTypeKey)} disabled={Boolean(typeLock)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_INFO[t].label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Subtype" htmlFor="acc-subtype" hint="Bank, cash and wallet accounts can pay or receive money.">
              <NativeSelect id="acc-subtype" value={form.subtype} onChange={(e) => setForm((f) => ({ ...f, subtype: e.target.value }))} disabled={account?.isSystem}>
                <option value="">None</option>
                {subtypeOptions.map((s) => (
                  <option key={s} value={s}>
                    {subtypeLabel(s)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          {showBank && (
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1.6fr_1fr]">
              <FormField label={form.subtype === "CREDIT_CARD" ? "Card issuer / bank" : "Bank name"} htmlFor="acc-bank">
                <Input id="acc-bank" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} maxLength={120} placeholder="e.g. HDFC Bank" />
              </FormField>
              <FormField label="Last 4 digits" htmlFor="acc-last4" error={!last4Valid ? "Enter exactly 4 digits" : null} hint="Never store full numbers.">
                <Input
                  id="acc-last4"
                  value={form.accountNumberLast4}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumberLast4: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  inputMode="numeric"
                  className="font-mono"
                  placeholder="1234"
                  aria-invalid={!last4Valid}
                />
              </FormField>
            </div>
          )}
          <FormField label="Description" htmlFor="acc-desc">
            <Textarea id="acc-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={500} rows={2} className="min-h-[60px]" />
          </FormField>
          {!account?.isSystem && (
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  {deactivateBlocked
                    ? `${account?.activeCategoryCount} active categor${account?.activeCategoryCount === 1 ? "y uses" : "ies use"} this account. Deactivate or relink them first.`
                    : "Inactive accounts keep their history but cannot be used in new entries."}
                </p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={Boolean(deactivateBlocked) && form.isActive} aria-label="Active" />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!codeValid || form.name.trim().length < 2 || !last4Valid}>
              {account ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAccountButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New account
      </Button>
      {open && <AccountDialog workspaceId={workspaceId} account={null} onClose={() => setOpen(false)} />}
    </>
  );
}

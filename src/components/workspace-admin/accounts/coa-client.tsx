"use client";

import * as React from "react";
import Link from "next/link";
import { Banknote, CreditCard, FolderTree, Landmark, Lock, MoreHorizontal, Pencil, Power, Scale, Wallet } from "lucide-react";
import type { AccountRow } from "@/lib/workspace-admin/accounts";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_INFO,
  MONEY_ACCOUNT_SUBTYPES,
  subtypeLabel,
  supportsOpeningBalance,
  type AccountTypeKey,
} from "@/lib/workspace-admin/constants";
import { dec, formatMoney, sumDec } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/feedback";
import { Switch, Tooltip } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog, SearchInput, useMutation } from "../shared";
import { AccountDialog } from "./account-dialog";
import { OpeningBalanceDialog } from "./opening-balance-dialog";

const SUBTYPE_ICON: Record<string, typeof Landmark> = { BANK: Landmark, CASH: Banknote, WALLET: Wallet, CREDIT_CARD: CreditCard };

const SUBTYPE_VARIANT: Record<string, "info" | "success" | "warning" | "danger" | "secondary" | "outline"> = {
  BANK: "info",
  CASH: "success",
  WALLET: "success",
  CREDIT_CARD: "warning",
  RECEIVABLE: "secondary",
  PAYABLE: "secondary",
  TAX: "outline",
};

type Props = {
  workspaceId: string;
  accounts: AccountRow[];
  currency: string;
  canManage: boolean;
  defaultOpeningDate: string;
  today: string;
};

export function CoaClient({ workspaceId, accounts, currency, canManage, defaultOpeningDate, today }: Props) {
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState<"all" | AccountTypeKey>("all");
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<AccountRow | null>(null);
  const [opening, setOpening] = React.useState<AccountRow | null>(null);
  const [toggling, setToggling] = React.useState<AccountRow | null>(null);
  const { run } = useMutation();

  const money = (v: string) => formatMoney(v, currency, { decimals: true });
  const moneyAccounts = accounts.filter((a) => a.isActive && a.subtype && MONEY_ACCOUNT_SUBTYPES.includes(a.subtype));
  const cashTotal = sumDec(moneyAccounts.filter((a) => a.type === "ASSET").map((a) => a.balance));
  const inactiveCount = accounts.filter((a) => !a.isActive).length;

  const q = query.trim().toLowerCase();
  const visible = accounts.filter(
    (a) =>
      (showInactive || a.isActive) &&
      (type === "all" || a.type === type) &&
      (!q || [a.code, a.name, a.description, a.bankName, subtypeLabel(a.subtype)].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="space-y-6">
      {/* Bank & cash strip */}
      <section aria-labelledby="money-accounts">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="money-accounts" className="text-sm font-semibold">
            Bank &amp; cash accounts
          </h2>
          <p className="text-xs text-muted-foreground">
            Total cash &amp; bank: <span className={cn("font-semibold tabular", cashTotal.isNegative() ? "text-expense" : "text-foreground")}>{money(cashTotal.toFixed(2))}</span>
          </p>
        </div>
        {moneyAccounts.length === 0 ? (
          <Card>
            <EmptyState icon={Landmark} title="No bank or cash accounts" description="Add a Bank, Cash, Wallet or Credit card account to record payments." />
          </Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
            {moneyAccounts.map((a) => {
              const Icon = SUBTYPE_ICON[a.subtype!] ?? Landmark;
              const negative = dec(a.balance).isNegative();
              return (
                <Link
                  key={a.id}
                  href={`/w/${workspaceId}/accounts/${a.id}`}
                  className="group min-w-[200px] flex-1 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/40 sm:max-w-[280px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <Badge variant={SUBTYPE_VARIANT[a.subtype!] ?? "secondary"}>{subtypeLabel(a.subtype)}</Badge>
                  </div>
                  <p className="mt-3 truncate text-sm font-medium group-hover:text-primary">{a.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.bankName ?? a.code}
                    {a.accountNumberLast4 ? ` •••${a.accountNumberLast4}` : ""}
                  </p>
                  <p className={cn("mt-2 text-lg font-semibold tabular", negative ? "text-expense" : "")}>{money(a.balance)}</p>
                  {a.subtype === "CREDIT_CARD" && <p className="text-[11px] text-muted-foreground">Amount owed</p>}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={query} onChange={setQuery} placeholder="Search code, name, bank…" className="sm:w-72" />
          <div className="flex flex-wrap items-center gap-3">
            <NativeSelect value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-40" aria-label="Filter by type">
              <option value="all">All types</option>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_INFO[t].plural}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive accounts" />
              Show inactive{inactiveCount ? ` (${inactiveCount})` : ""}
            </label>
          </div>
        </CardContent>
      </Card>

      {visible.length === 0 && (
        <Card>
          <EmptyState icon={FolderTree} title="No accounts match" description="Try a different search, type, or include inactive accounts." />
        </Card>
      )}

      {ACCOUNT_TYPES.map((t) => {
        const rows = visible.filter((a) => a.type === t);
        if (!rows.length) return null;
        const total = sumDec(rows.map((r) => r.balance));
        return (
          <Card key={t} className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
              <div>
                <h2 className="font-semibold">
                  {ACCOUNT_TYPE_INFO[t].plural} <span className="ml-1 text-xs font-normal text-muted-foreground tabular">{rows.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_INFO[t].description}</p>
              </div>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH className="w-36">Code</TH>
                  <TH>Account</TH>
                  <TH>Subtype</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Status</TH>
                  {canManage && (
                    <TH className="w-10">
                      <span className="sr-only">Actions</span>
                    </TH>
                  )}
                </TR>
              </THead>
              <TBody>
                {rows.map((a) => {
                  const negative = dec(a.balance).isNegative();
                  return (
                    <TR key={a.id} className={cn(!a.isActive && "opacity-60")}>
                      <TD className="font-mono text-xs">{a.code}</TD>
                      <TD className="min-w-[220px]">
                        <Link href={`/w/${workspaceId}/accounts/${a.id}`} className="font-medium hover:text-primary hover:underline">
                          {a.name}
                        </Link>
                        {(a.bankName || a.accountNumberLast4) && (
                          <p className="text-xs text-muted-foreground">
                            {a.bankName}
                            {a.accountNumberLast4 ? ` •••${a.accountNumberLast4}` : ""}
                          </p>
                        )}
                        {a.description && <p className="line-clamp-1 text-xs text-muted-foreground">{a.description}</p>}
                        {a.openingBalanceDate && (
                          <p className="text-[11px] text-muted-foreground">
                            Opening {money(a.openingBalance)} · {formatDate(a.openingBalanceDate)}
                          </p>
                        )}
                      </TD>
                      <TD>{a.subtype ? <Badge variant={SUBTYPE_VARIANT[a.subtype] ?? "secondary"}>{subtypeLabel(a.subtype)}</Badge> : <span className="text-muted-foreground">—</span>}</TD>
                      <TD className={cn("whitespace-nowrap text-right font-medium tabular", negative && "text-expense")}>{money(a.balance)}</TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={a.isActive ? "success" : "muted"}>{a.isActive ? "Active" : "Inactive"}</Badge>
                          {a.isSystem && (
                            <Tooltip content="System account used by the accounting engine">
                              <span tabIndex={0}>
                                <Badge variant="outline">
                                  <Lock className="h-3 w-3" /> System
                                </Badge>
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </TD>
                      {canManage && (
                        <TD>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => setEditing(a)}>
                                <Pencil /> Edit account
                              </DropdownMenuItem>
                              {supportsOpeningBalance(a.type, a.subtype) && (
                                <DropdownMenuItem onSelect={() => setOpening(a)}>
                                  <Scale /> {a.openingBalanceDate ? "Change opening balance" : "Set opening balance"}
                                </DropdownMenuItem>
                              )}
                              {!a.isSystem && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setToggling(a)} disabled={a.isActive && a.activeCategoryCount > 0}>
                                    <Power /> {a.isActive ? (a.activeCategoryCount > 0 ? "Deactivate (used by categories)" : "Deactivate") : "Reactivate"}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={3} className="text-xs uppercase tracking-wide text-muted-foreground">
                    Total {ACCOUNT_TYPE_INFO[t].plural.toLowerCase()}
                  </TD>
                  <TD className={cn("whitespace-nowrap text-right tabular", total.isNegative() && "text-expense")}>{money(total.toFixed(2))}</TD>
                  <TD colSpan={canManage ? 2 : 1} />
                </TR>
              </TFoot>
            </Table>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Balances include every posted journal entry and are shown in each account&apos;s natural direction (debit for assets and expenses, credit for liabilities, equity and income).
      </p>

      {editing && <AccountDialog key={editing.id} workspaceId={workspaceId} account={editing} onClose={() => setEditing(null)} />}
      {opening && (
        <OpeningBalanceDialog key={opening.id} workspaceId={workspaceId} account={opening} currency={currency} defaultDate={defaultOpeningDate} today={today} onClose={() => setOpening(null)} />
      )}
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}
        description={
          toggling?.isActive
            ? "It keeps its history and balance but cannot be used in new transactions. You can reactivate it later."
            : "It becomes available for new transactions again."
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Reactivate"}
        destructive={toggling?.isActive}
        onConfirm={async () => {
          if (!toggling) return;
          const res = await run(
            `/api/w/${workspaceId}/accounts/${toggling.id}`,
            { method: "PATCH", body: { isActive: !toggling.isActive } },
            { success: `${toggling.name} ${toggling.isActive ? "deactivated" : "reactivated"}` },
          );
          return res !== null;
        }}
      />
    </div>
  );
}

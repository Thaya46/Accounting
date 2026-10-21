"use client";

import * as React from "react";
import { AlertTriangle, ClipboardList, MoreHorizontal, Pencil, Plus, Power, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import type { CategoryRow } from "@/lib/workspace-admin/categories";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Switch, Tooltip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog, SearchInput, SectionCount, useMutation } from "../shared";
import { KeywordInput } from "./keyword-input";

export type LedgerOption = { id: string; code: string; name: string; type: "INCOME" | "EXPENSE"; isActive: boolean };
type Kind = "EXPENSE" | "INCOME";

export function CategoriesClient({ workspaceId, categories, accounts }: { workspaceId: string; categories: CategoryRow[]; accounts: LedgerOption[] }) {
  const [tab, setTab] = React.useState<Kind>("EXPENSE");
  const [query, setQuery] = React.useState("");
  const [showInactive, setShowInactive] = React.useState(true);
  const [editing, setEditing] = React.useState<CategoryRow | { kind: Kind } | null>(null);
  const [toggling, setToggling] = React.useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = React.useState<CategoryRow | null>(null);
  const { run } = useMutation();

  const q = query.trim().toLowerCase();
  const filter = (kind: Kind) =>
    categories.filter(
      (c) => c.kind === kind && (showInactive || c.isActive) && (!q || [c.name, c.accountName, c.accountCode, ...c.keywords].some((v) => v.toLowerCase().includes(q))),
    );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger value="EXPENSE">
            <TrendingDown /> Expense <SectionCount>{categories.filter((c) => c.kind === "EXPENSE").length}</SectionCount>
          </TabsTrigger>
          <TabsTrigger value="INCOME">
            <TrendingUp /> Income <SectionCount>{categories.filter((c) => c.kind === "INCOME").length}</SectionCount>
          </TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, account, keyword…" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive categories" /> Inactive
          </label>
          <Button onClick={() => setEditing({ kind: tab })}>
            <Plus /> New {tab === "EXPENSE" ? "expense" : "income"} category
          </Button>
        </div>
      </div>

      {(["EXPENSE", "INCOME"] as Kind[]).map((kind) => {
        const rows = filter(kind);
        return (
          <TabsContent key={kind} value={kind}>
            <Card>
              {rows.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title={q ? "No categories match your search" : `No ${kind === "EXPENSE" ? "expense" : "income"} categories yet`}
                  description="Categories map everyday language (“petrol”, “rent”) to a ledger account. The AI parser uses their keywords to predict the category."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Category</TH>
                      <TH>Ledger account</TH>
                      <TH>Keywords</TH>
                      <TH className="text-right">Used in</TH>
                      <TH>Status</TH>
                      <TH className="w-10">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((c) => (
                      <TR key={c.id} className={cn(!c.isActive && "opacity-60")}>
                        <TD className="min-w-[160px] font-medium">{c.name}</TD>
                        <TD className="min-w-[180px]">
                          <span className="font-mono text-xs text-muted-foreground">{c.accountCode}</span> <span>{c.accountName}</span>
                          {!c.accountActive && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                              <AlertTriangle className="h-3 w-3" /> Account inactive
                            </span>
                          )}
                        </TD>
                        <TD className="min-w-[220px] max-w-[360px]">
                          {c.keywords.length ? (
                            <div className="flex flex-wrap gap-1">
                              {c.keywords.slice(0, 6).map((k) => (
                                <Badge key={k} variant="muted">
                                  {k}
                                </Badge>
                              ))}
                              {c.keywords.length > 6 && (
                                <Tooltip content={c.keywords.slice(6).join(", ")}>
                                  <span tabIndex={0}>
                                    <Badge variant="outline">+{c.keywords.length - 6}</Badge>
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No keywords</span>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-right tabular text-muted-foreground">
                          {c.usageCount} txn{c.usageCount === 1 ? "" : "s"}
                        </TD>
                        <TD>
                          <Badge variant={c.isActive ? "success" : "muted"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                        </TD>
                        <TD>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => setEditing(c)}>
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setToggling(c)}>
                                <Power /> {c.isActive ? "Deactivate" : "Reactivate"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => setDeleting(c)}
                                disabled={c.usageCount > 0}
                                className="text-expense focus:text-expense [&_svg]:!text-expense"
                              >
                                <Trash2 /> {c.usageCount > 0 ? "Delete (in use)" : "Delete"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </TabsContent>
        );
      })}

      {editing && (
        <CategoryDialog
          key={"id" in editing ? editing.id : `new-${editing.kind}`}
          workspaceId={workspaceId}
          category={"id" in editing ? editing : null}
          kind={editing.kind}
          accounts={accounts}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}
        description={
          toggling?.isActive
            ? "It will no longer be offered for new entries or AI predictions. Existing transactions keep it."
            : "It becomes available for new entries and AI predictions again."
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Reactivate"}
        destructive={toggling?.isActive}
        onConfirm={async () => {
          if (!toggling) return;
          const res = await run(
            `/api/w/${workspaceId}/categories/${toggling.id}`,
            { method: "PATCH", body: { isActive: !toggling.isActive } },
            { success: `${toggling.name} ${toggling.isActive ? "deactivated" : "reactivated"}` },
          );
          return res !== null;
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="This category has never been used, so it can be removed permanently. The deletion is recorded in the audit log."
        confirmLabel="Delete category"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await run(`/api/w/${workspaceId}/categories/${deleting.id}`, { method: "DELETE" }, { success: `${deleting.name} deleted` });
          return res !== null;
        }}
      />
    </Tabs>
  );
}

function CategoryDialog({ workspaceId, category, kind: initialKind, accounts, onClose }: { workspaceId: string; category: CategoryRow | null; kind: Kind; accounts: LedgerOption[]; onClose: () => void }) {
  const [name, setName] = React.useState(category?.name ?? "");
  const [kind, setKind] = React.useState<Kind>(category?.kind ?? initialKind);
  const [accountId, setAccountId] = React.useState(category?.accountId ?? "");
  const [keywords, setKeywords] = React.useState<string[]>(category?.keywords ?? []);
  const [isActive, setIsActive] = React.useState(category?.isActive ?? true);
  const { pending, run } = useMutation();

  const options = accounts.filter((a) => a.type === kind && (a.isActive || a.id === category?.accountId));
  const kindLocked = Boolean(category && category.usageCount > 0);
  const selected = accounts.find((a) => a.id === accountId);
  const accountMismatch = selected && selected.type !== kind;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, kind, accountId, keywords, isActive };
    const res = category
      ? await run(`/api/w/${workspaceId}/categories/${category.id}`, { method: "PATCH", body }, { success: `${name.trim()} updated` })
      : await run(`/api/w/${workspaceId}/categories`, { method: "POST", body }, { success: `${name.trim()} created` });
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        title={category ? `Edit ${category.name}` : `New ${kind === "EXPENSE" ? "expense" : "income"} category`}
        description="Entries in this category post to the linked ledger account."
        className="max-w-xl"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
            <FormField label="Name" htmlFor="cat-name" required>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={kind === "EXPENSE" ? "e.g. Electricity Expense" : "e.g. Service Revenue"} required />
            </FormField>
            <FormField label="Kind" htmlFor="cat-kind" hint={kindLocked ? "Locked: transactions use this category." : undefined}>
              <NativeSelect
                id="cat-kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setAccountId("");
                }}
                disabled={kindLocked}
              >
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
              </NativeSelect>
            </FormField>
          </div>
          <FormField
            label="Ledger account"
            htmlFor="cat-account"
            required
            hint={`Only active ${kind === "EXPENSE" ? "expense" : "income"} accounts can be linked.`}
            error={accountMismatch ? "Choose an account of the matching type" : null}
          >
            <NativeSelect id="cat-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>
                Select an account…
              </option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                  {a.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Keywords" htmlFor="cat-keywords" hint="Words people use for this category. The AI parser matches them (case-insensitive) to predict the category.">
            <KeywordInput id="cat-keywords" value={keywords} onChange={setKeywords} />
          </FormField>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Inactive categories stay on past transactions but are not offered for new ones.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Active" />
          </div>
          {options.length === 0 && (
            <Alert variant="warning">There are no active {kind === "EXPENSE" ? "expense" : "income"} accounts. Create one in the Chart of Accounts first.</Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={name.trim().length < 2 || !accountId || Boolean(accountMismatch)}>
              {category ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

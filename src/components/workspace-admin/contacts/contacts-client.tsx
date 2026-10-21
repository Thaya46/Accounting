"use client";

import * as React from "react";
import { Building, Contact, Pencil, Plus, Store } from "lucide-react";
import type { ContactRow } from "@/lib/workspace-admin/contacts";
import type { ContactKind } from "@/lib/workspace-admin/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, FormField } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SearchInput, SectionCount, useMutation } from "../shared";

const LABEL: Record<ContactKind, { one: string; many: string }> = { customer: { one: "customer", many: "Customers" }, vendor: { one: "vendor", many: "Vendors" } };

export function ContactsClient({ workspaceId, customers, vendors, initialTab }: { workspaceId: string; customers: ContactRow[]; vendors: ContactRow[]; initialTab?: string }) {
  const [tab, setTab] = React.useState<ContactKind>(initialTab === "vendor" ? "vendor" : "customer");
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<{ kind: ContactKind; contact: ContactRow | null } | null>(null);
  const lists: Record<ContactKind, ContactRow[]> = { customer: customers, vendor: vendors };
  const q = query.trim().toLowerCase();

  function change(value: string) {
    setTab(value as ContactKind);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={change}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger value="customer">
            <Building /> Customers <SectionCount>{customers.length}</SectionCount>
          </TabsTrigger>
          <TabsTrigger value="vendor">
            <Store /> Vendors <SectionCount>{vendors.length}</SectionCount>
          </TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, email, phone, tax ID…" />
          <Button onClick={() => setEditing({ kind: tab, contact: null })}>
            <Plus /> New {LABEL[tab].one}
          </Button>
        </div>
      </div>
      {(["customer", "vendor"] as ContactKind[]).map((kind) => {
        const rows = lists[kind].filter((c) => !q || [c.name, c.email, c.phone, c.taxId].some((v) => v?.toLowerCase().includes(q)));
        return (
          <TabsContent key={kind} value={kind}>
            <Card>
              {rows.length === 0 ? (
                <EmptyState
                  icon={Contact}
                  title={q ? `No ${LABEL[kind].many.toLowerCase()} match your search` : `No ${LABEL[kind].many.toLowerCase()} yet`}
                  description={
                    kind === "customer"
                      ? "Customers you receive income from. The AI links “Received 75,000 from ABC Technologies” to a customer by name."
                      : "Vendors you pay for goods and services."
                  }
                  action={
                    !q && (
                      <Button size="sm" variant="outline" onClick={() => setEditing({ kind, contact: null })}>
                        <Plus /> Add {LABEL[kind].one}
                      </Button>
                    )
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Email</TH>
                      <TH>Phone</TH>
                      <TH>Tax ID</TH>
                      <TH className="text-right">Transactions</TH>
                      <TH className="w-10">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((c) => (
                      <TR key={c.id}>
                        <TD className="min-w-[180px] font-medium">{c.name}</TD>
                        <TD className="text-muted-foreground">{c.email ? <a href={`mailto:${c.email}`} className="hover:text-primary hover:underline">{c.email}</a> : "—"}</TD>
                        <TD className="whitespace-nowrap text-muted-foreground">{c.phone ?? "—"}</TD>
                        <TD className="font-mono text-xs text-muted-foreground">{c.taxId ?? "—"}</TD>
                        <TD className="text-right tabular">{c.transactionCount}</TD>
                        <TD>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ kind, contact: c })} aria-label={`Edit ${c.name}`}>
                            <Pencil />
                          </Button>
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
      {editing && <ContactDialog key={editing.contact?.id ?? `new-${editing.kind}`} workspaceId={workspaceId} kind={editing.kind} contact={editing.contact} onClose={() => setEditing(null)} />}
    </Tabs>
  );
}

function ContactDialog({ workspaceId, kind, contact, onClose }: { workspaceId: string; kind: ContactKind; contact: ContactRow | null; onClose: () => void }) {
  const [form, setForm] = React.useState({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", taxId: contact?.taxId ?? "" });
  const { pending, run } = useMutation();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: form.name, email: form.email || null, phone: form.phone || null, taxId: form.taxId || null };
    const res = contact
      ? await run(`/api/w/${workspaceId}/contacts/${contact.id}?kind=${kind}`, { method: "PATCH", body }, { success: `${form.name.trim()} updated` })
      : await run(`/api/w/${workspaceId}/contacts?kind=${kind}`, { method: "POST", body }, { success: `${form.name.trim()} added` });
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent title={contact ? `Edit ${contact.name}` : `New ${LABEL[kind].one}`} description={contact ? `Used in ${contact.transactionCount} transaction${contact.transactionCount === 1 ? "" : "s"}.` : undefined}>
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Name" htmlFor="ct-name" required hint="Must be unique in this workspace.">
            <Input id="ct-name" value={form.name} onChange={set("name")} maxLength={160} required />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email" htmlFor="ct-email">
              <Input id="ct-email" type="email" value={form.email} onChange={set("email")} maxLength={254} />
            </FormField>
            <FormField label="Phone" htmlFor="ct-phone">
              <Input id="ct-phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={40} />
            </FormField>
          </div>
          <FormField label="Tax ID" htmlFor="ct-tax" hint="GSTIN, VAT or other tax registration number.">
            <Input id="ct-tax" value={form.taxId} onChange={set("taxId")} maxLength={40} className="font-mono" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={form.name.trim().length < 2}>
              {contact ? "Save changes" : `Add ${LABEL[kind].one}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

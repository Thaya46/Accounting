"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Filter, RotateCcw } from "lucide-react";
import { titleCaseEnum } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";

export type AuditFilterValues = { actor?: string; action?: string; entity?: string; q?: string; from?: string; to?: string };
export type AuditFilterOptions = { actors: { id: string; name: string; email: string | null }[]; actions: string[]; entities: string[] };

export function AuditFilters({ values, options }: { values: AuditFilterValues; options: AuditFilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<AuditFilterValues>(values);
  React.useEffect(() => setForm(values), [values]);

  const set = (k: keyof AuditFilterValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const active = Object.values(values).some(Boolean);

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v && String(v).trim()) qs.set(k, String(v).trim());
    const query = qs.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  function reset() {
    setForm({});
    startTransition(() => router.push(pathname));
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <NativeSelect value={form.actor ?? ""} onChange={set("actor")} aria-label="Actor">
            <option value="">All people</option>
            {options.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.email ? ` (${a.email})` : ""}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={form.action ?? ""} onChange={set("action")} aria-label="Action">
            <option value="">All actions</option>
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {titleCaseEnum(a)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={form.entity ?? ""} onChange={set("entity")} aria-label="Entity type">
            <option value="">All entities</option>
            {options.entities.map((e) => (
              <option key={e} value={e}>
                {titleCaseEnum(e)}
              </option>
            ))}
          </NativeSelect>
          <Input value={form.q ?? ""} onChange={set("q")} placeholder="TXN-0001 or record ID" aria-label="Transaction reference or ID" maxLength={100} />
          <Input type="date" value={form.from ?? ""} onChange={set("from")} max={form.to || undefined} aria-label="From date" />
          <Input type="date" value={form.to ?? ""} onChange={set("to")} min={form.from || undefined} aria-label="To date" />
          <div className="flex gap-2">
            <Button type="submit" loading={pending} className="flex-1">
              <Filter /> Apply
            </Button>
            {active && (
              <Button type="button" variant="outline" size="icon" onClick={reset} aria-label="Clear filters" disabled={pending}>
                <RotateCcw />
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

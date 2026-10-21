"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { FormField } from "@/components/ui/feedback";

export type ActivityFilterValues = { q: string; actor: string; workspace: string; entity: string; from: string; to: string };

export function ActivityFilters({
  values,
  workspaces,
  entityTypes,
}: {
  values: ActivityFilterValues;
  workspaces: { id: string; name: string; code: string }[];
  entityTypes: string[];
}) {
  const router = useRouter();
  const [form, setForm] = React.useState(values);
  const [pending, startTransition] = React.useTransition();
  const valuesKey = JSON.stringify(values);
  React.useEffect(() => setForm(JSON.parse(valuesKey) as ActivityFilterValues), [valuesKey]);

  const set = (k: keyof ActivityFilterValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const go = (v: ActivityFilterValues) => {
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) if (val.trim()) sp.set(k, val.trim());
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `/admin/activity?${qs}` : "/admin/activity", { scroll: false }));
  };

  const active = Object.values(values).some((v) => v);
  const invalidRange = Boolean(form.from && form.to && form.from > form.to);

  return (
    <form
      className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalidRange) go(form);
      }}
    >
      <FormField label="Action" htmlFor="f-action" className="lg:col-span-1">
        <Input id="f-action" value={form.q} onChange={set("q")} placeholder="e.g. LOGIN" maxLength={100} />
      </FormField>
      <FormField label="Actor" htmlFor="f-actor" className="lg:col-span-1">
        <Input id="f-actor" value={form.actor} onChange={set("actor")} placeholder="Name or email" maxLength={100} />
      </FormField>
      <FormField label="Workspace" htmlFor="f-ws" className="lg:col-span-1">
        <NativeSelect id="f-ws" value={form.workspace} onChange={set("workspace")}>
          <option value="">All workspaces</option>
          <option value="platform">Platform only</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Entity type" htmlFor="f-entity" className="lg:col-span-1">
        <NativeSelect id="f-entity" value={form.entity} onChange={set("entity")}>
          <option value="">All entities</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="From" htmlFor="f-from" className="lg:col-span-1">
        <Input id="f-from" type="date" value={form.from} max={form.to || undefined} onChange={set("from")} />
      </FormField>
      <FormField label="To" htmlFor="f-to" className="lg:col-span-1" error={invalidRange ? "Must be on or after From" : null}>
        <Input id="f-to" type="date" value={form.to} min={form.from || undefined} onChange={set("to")} aria-invalid={invalidRange} />
      </FormField>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2 lg:col-span-6">
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const empty = { q: "", actor: "", workspace: "", entity: "", from: "", to: "" };
              setForm(empty);
              go(empty);
            }}
          >
            <RotateCcw /> Reset
          </Button>
        )}
        <Button type="submit" size="sm" loading={pending} disabled={invalidRange}>
          {!pending && <Filter />} Apply filters
        </Button>
      </div>
    </form>
  );
}

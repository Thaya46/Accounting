"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { CURRENCIES } from "@/lib/money";
import { COUNTRIES, FY_MONTH_OPTIONS, TIME_ZONES, currentFyPreview } from "@/lib/admin/constants";
import { workspaceUpdateSchema } from "@/lib/admin/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { FormField } from "@/components/ui/feedback";
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from "./form-errors";

type Info = {
  name: string;
  companyName: string;
  companyEmail: string;
  country: string;
  defaultCurrency: string;
  fyStartMonth: number;
  timeZone: string;
};

export function WorkspaceEditCard({ workspaceId, initial, currencyLocked, readOnly }: { workspaceId: string; initial: Info; currencyLocked: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Info>(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);

  // Re-sync after router.refresh() delivers new server data.
  const initialKey = JSON.stringify(initial);
  React.useEffect(() => {
    setForm(JSON.parse(initialKey) as Info);
  }, [initialKey]);

  const set = <K extends keyof Info>(key: K, value: Info[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const changed = (Object.keys(form) as (keyof Info)[]).filter((k) => String(form[k]).trim() !== String(initial[k]));
  const timeZones = (TIME_ZONES as readonly string[]).includes(initial.timeZone) ? [...TIME_ZONES] : [initial.timeZone, ...TIME_ZONES];
  const fy = currentFyPreview(form.fyStartMonth, form.timeZone);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = Object.fromEntries(changed.map((k) => [k, form[k]]));
    const parsed = workspaceUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ changed: boolean }>(`/api/admin/workspaces/${workspaceId}`, { method: "PATCH", body: parsed.data });
      toast.success(res.changed ? "Workspace information updated" : "No changes to save");
      router.refresh();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      toast.error(errorMessage(err, "Could not update the workspace"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} noValidate>
        <CardHeader>
          <CardTitle>Workspace information</CardTitle>
          <CardDescription>
            {readOnly ? "Archived workspaces are read-only. Activate the workspace to edit its details." : "Company details and accounting defaults for this workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={readOnly || saving} className="grid gap-4 sm:grid-cols-2">
            <FormField label="Workspace name" htmlFor="ws-name" required error={errors.name}>
              <Input id="ws-name" value={form.name} maxLength={120} aria-invalid={Boolean(errors.name)} onChange={(e) => set("name", e.target.value)} />
            </FormField>
            <FormField label="Company name" htmlFor="ws-company" required error={errors.companyName}>
              <Input id="ws-company" value={form.companyName} maxLength={160} aria-invalid={Boolean(errors.companyName)} onChange={(e) => set("companyName", e.target.value)} />
            </FormField>
            <FormField label="Company email" htmlFor="ws-email" required error={errors.companyEmail}>
              <Input
                id="ws-email"
                type="email"
                value={form.companyEmail}
                maxLength={254}
                aria-invalid={Boolean(errors.companyEmail)}
                onChange={(e) => set("companyEmail", e.target.value)}
              />
            </FormField>
            <FormField label="Country" htmlFor="ws-country" required error={errors.country}>
              <Input id="ws-country" list="ws-country-options" value={form.country} maxLength={80} aria-invalid={Boolean(errors.country)} onChange={(e) => set("country", e.target.value)} />
              <datalist id="ws-country-options">
                {COUNTRIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FormField>
            <FormField
              label="Default currency"
              htmlFor="ws-currency"
              required
              error={errors.defaultCurrency}
              hint={
                currencyLocked ? (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Locked — the workspace already has transactions.
                  </span>
                ) : (
                  "Can be changed until the first transaction is recorded."
                )
              }
            >
              <NativeSelect id="ws-currency" value={form.defaultCurrency} disabled={currencyLocked} onChange={(e) => set("defaultCurrency", e.target.value)}>
                {(CURRENCIES as readonly string[]).includes(initial.defaultCurrency) ? null : <option value={initial.defaultCurrency}>{initial.defaultCurrency}</option>}
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Financial year" htmlFor="ws-fy" required error={errors.fyStartMonth} hint={<>Current: {fy.display}</>}>
              <NativeSelect id="ws-fy" value={form.fyStartMonth} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>
                {FY_MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Time zone" htmlFor="ws-tz" required error={errors.timeZone} className="sm:col-span-2">
              <NativeSelect id="ws-tz" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </fieldset>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="ghost" disabled={!changed.length || saving} onClick={() => setForm(initial)}>
              Reset
            </Button>
            <Button type="submit" loading={saving} disabled={!changed.length}>
              Save changes
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}

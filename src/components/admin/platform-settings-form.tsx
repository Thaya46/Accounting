"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { CURRENCIES } from "@/lib/money";
import { COUNTRIES, FY_MONTH_OPTIONS, TIME_ZONES, currentFyPreview } from "@/lib/admin/constants";
import { platformSettingsSchema } from "@/lib/admin/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { FormField } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/misc";
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from "./form-errors";

export type PlatformSettingsValues = {
  platformName: string;
  defaultCountry: string;
  defaultCurrency: string;
  defaultTimeZone: string;
  defaultFyStartMonth: number;
  requireMfaForUsers: boolean;
  sessionTtlHours: number;
  invitationTtlHours: number;
  allowSelfPasswordReset: boolean;
};

function ToggleRow({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

export function PlatformSettingsForm({ initial }: { initial: PlatformSettingsValues }) {
  const router = useRouter();
  const [form, setForm] = React.useState<PlatformSettingsValues>(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);

  const initialKey = JSON.stringify(initial);
  React.useEffect(() => setForm(JSON.parse(initialKey) as PlatformSettingsValues), [initialKey]);

  const set = <K extends keyof PlatformSettingsValues>(key: K, value: PlatformSettingsValues[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const changed = (Object.keys(form) as (keyof PlatformSettingsValues)[]).filter((k) => String(form[k]).trim() !== String(initial[k]));
  const timeZones = (TIME_ZONES as readonly string[]).includes(initial.defaultTimeZone) ? [...TIME_ZONES] : [initial.defaultTimeZone, ...TIME_ZONES];
  const fy = currentFyPreview(form.defaultFyStartMonth, form.defaultTimeZone);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const numberErrors: FieldErrors = {};
    if (!Number.isFinite(form.sessionTtlHours)) numberErrors.sessionTtlHours = "Session lifetime must be 1–168 hours";
    if (!Number.isFinite(form.invitationTtlHours)) numberErrors.invitationTtlHours = "Invitation lifetime must be 1–336 hours";
    if (Object.keys(numberErrors).length) {
      setErrors(numberErrors);
      return;
    }
    const parsed = platformSettingsSchema.safeParse(Object.fromEntries(changed.map((k) => [k, form[k]])));
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/admin/settings", { method: "PATCH", body: parsed.data });
      toast.success("Platform settings saved");
      router.refresh();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      toast.error(errorMessage(err, "Could not save settings"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Shown in emails and across the application.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField label="Platform name" htmlFor="platformName" required error={errors.platformName} className="max-w-md">
            <Input id="platformName" value={form.platformName} maxLength={80} aria-invalid={Boolean(errors.platformName)} onChange={(e) => set("platformName", e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default accounting settings</CardTitle>
          <CardDescription>Prefilled when creating a workspace. Existing workspaces are not changed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Default country" htmlFor="defaultCountry" required error={errors.defaultCountry}>
            <Input
              id="defaultCountry"
              list="settings-country-options"
              value={form.defaultCountry}
              maxLength={80}
              aria-invalid={Boolean(errors.defaultCountry)}
              onChange={(e) => set("defaultCountry", e.target.value)}
            />
            <datalist id="settings-country-options">
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Default currency" htmlFor="defaultCurrency" required error={errors.defaultCurrency}>
            <NativeSelect id="defaultCurrency" value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Default time zone" htmlFor="defaultTimeZone" required error={errors.defaultTimeZone} hint="Also used to display times in this console.">
            <NativeSelect id="defaultTimeZone" value={form.defaultTimeZone} onChange={(e) => set("defaultTimeZone", e.target.value)}>
              {timeZones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Default financial year" htmlFor="defaultFyStartMonth" required error={errors.defaultFyStartMonth} hint={<>Current: {fy.display}</>}>
            <NativeSelect id="defaultFyStartMonth" value={form.defaultFyStartMonth} onChange={(e) => set("defaultFyStartMonth", Number(e.target.value))}>
              {FY_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Super Admins and Workspace Admins always require MFA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            id="requireMfaForUsers"
            label="Require MFA for all users"
            description="Every workspace user must enrol an authenticator app at their next sign-in."
            checked={form.requireMfaForUsers}
            onChange={(v) => set("requireMfaForUsers", v)}
          />
          <ToggleRow
            id="allowSelfPasswordReset"
            label="Allow self-service password reset"
            description="Users can request a password reset link by email from the sign-in page."
            checked={form.allowSelfPasswordReset}
            onChange={(v) => set("allowSelfPasswordReset", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Session lifetime (hours)" htmlFor="sessionTtlHours" required error={errors.sessionTtlHours} hint="1–168 hours. Applies to new sign-ins.">
              <Input
                id="sessionTtlHours"
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                value={Number.isFinite(form.sessionTtlHours) ? form.sessionTtlHours : ""}
                aria-invalid={Boolean(errors.sessionTtlHours)}
                onChange={(e) => set("sessionTtlHours", e.target.value === "" ? Number.NaN : Number(e.target.value))}
              />
            </FormField>
            <FormField label="Invitation link lifetime (hours)" htmlFor="invitationTtlHours" required error={errors.invitationTtlHours} hint="1–336 hours. Applies to new invitations.">
              <Input
                id="invitationTtlHours"
                type="number"
                inputMode="numeric"
                min={1}
                max={336}
                value={Number.isFinite(form.invitationTtlHours) ? form.invitationTtlHours : ""}
                aria-invalid={Boolean(errors.invitationTtlHours)}
                onChange={(e) => set("invitationTtlHours", e.target.value === "" ? Number.NaN : Number(e.target.value))}
              />
            </FormField>
          </div>
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <p className="text-xs text-muted-foreground">{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "All changes saved"}</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={!changed.length || saving} onClick={() => setForm(initial)}>
              Reset
            </Button>
            <Button type="submit" loading={saving} disabled={!changed.length}>
              Save settings
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}

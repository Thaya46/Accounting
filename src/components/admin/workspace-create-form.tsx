"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Briefcase, Building2, CalendarRange, ShieldCheck, UserCog } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { CURRENCIES } from "@/lib/money";
import { COUNTRIES, FY_MONTH_OPTIONS, TIME_ZONES, currentFyPreview, suggestWorkspaceCode } from "@/lib/admin/constants";
import { workspaceCreateSchema } from "@/lib/admin/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from "./form-errors";

type Defaults = { country: string; currency: string; timeZone: string; fyStartMonth: number };

type CreateResponse = {
  workspace: { id: string; ref: string; code: string; name: string; status: string };
  invitation: { id: string; email: string; name: string; expiresAt: string };
  delivery: { status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string };
};

export function WorkspaceCreateForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: "",
    code: "",
    companyName: "",
    companyEmail: "",
    country: defaults.country,
    defaultCurrency: defaults.currency,
    fyStartMonth: defaults.fyStartMonth,
    timeZone: defaults.timeZone,
    adminName: "",
    adminEmail: "",
    status: "ACTIVE" as "ACTIVE" | "SUSPENDED",
  });
  const [codeTouched, setCodeTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const timeZones = React.useMemo(
    () => ((TIME_ZONES as readonly string[]).includes(defaults.timeZone) ? [...TIME_ZONES] : [defaults.timeZone, ...TIME_ZONES]),
    [defaults.timeZone],
  );
  const fy = currentFyPreview(form.fyStartMonth, form.timeZone);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = workspaceCreateSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<CreateResponse>("/api/admin/workspaces", { method: "POST", body: parsed.data });
      toast.success(`${res.workspace.name} (${res.workspace.ref}) created`, {
        description: "Chart of accounts, roles and settings are ready.",
      });
      if (res.delivery.status === "SENT") {
        toast.success(`Invitation emailed to ${res.invitation.email}`);
      } else {
        toast.warning("The invitation email was not delivered", {
          description: "Open the Email Outbox to retrieve the invitation link.",
          duration: 10_000,
        });
      }
      router.push(`/admin/workspaces/${res.workspace.id}?created=1`);
      router.refresh();
    } catch (err) {
      const fieldErrors = apiFieldErrors(err);
      setErrors(fieldErrors);
      if (!Object.keys(fieldErrors).length) setFormError(errorMessage(err, "Could not create the workspace"));
      toast.error(errorMessage(err, "Could not create the workspace"));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {formError && (
          <Alert variant="danger" title="Workspace not created">
            {formError}
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Workspace
            </CardTitle>
            <CardDescription>How the workspace is named and identified across the platform.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Workspace Name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
              <Input
                id="name"
                value={form.name}
                maxLength={120}
                autoFocus
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, ...(codeTouched ? {} : { code: suggestWorkspaceCode(name) }) }));
                  setErrors((er) => ({ ...er, name: undefined, ...(codeTouched ? {} : { code: undefined }) }));
                }}
                placeholder="Acme Traders"
              />
            </FormField>
            <FormField label="Workspace Code" htmlFor="code" required error={errors.code} hint="2–10 uppercase letters or digits. Must be unique.">
              <Input
                id="code"
                value={form.code}
                maxLength={10}
                className="font-mono uppercase"
                aria-invalid={Boolean(errors.code)}
                onChange={(e) => {
                  setCodeTouched(true);
                  set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                }}
                placeholder="ACME"
              />
            </FormField>
            <FormField label="Status" htmlFor="status" required error={errors.status} hint={form.status === "SUSPENDED" ? "Members cannot sign in until it is activated." : "Members can use it once they accept."}>
              <NativeSelect id="status" value={form.status} onChange={(e) => set("status", e.target.value as "ACTIVE" | "SUSPENDED")}>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </NativeSelect>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" /> Company
            </CardTitle>
            <CardDescription>The legal entity whose books this workspace keeps.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Company Name" htmlFor="companyName" required error={errors.companyName} className="sm:col-span-2">
              <Input
                id="companyName"
                value={form.companyName}
                maxLength={160}
                aria-invalid={Boolean(errors.companyName)}
                onChange={(e) => set("companyName", e.target.value)}
                placeholder="Acme Traders Private Limited"
              />
            </FormField>
            <FormField label="Company Email" htmlFor="companyEmail" required error={errors.companyEmail}>
              <Input
                id="companyEmail"
                type="email"
                value={form.companyEmail}
                maxLength={254}
                autoComplete="off"
                aria-invalid={Boolean(errors.companyEmail)}
                onChange={(e) => set("companyEmail", e.target.value)}
                placeholder="accounts@acme.example"
              />
            </FormField>
            <FormField label="Country" htmlFor="country" required error={errors.country}>
              <Input
                id="country"
                list="admin-country-options"
                value={form.country}
                maxLength={80}
                aria-invalid={Boolean(errors.country)}
                onChange={(e) => set("country", e.target.value)}
              />
              <datalist id="admin-country-options">
                {COUNTRIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" /> Accounting defaults
            </CardTitle>
            <CardDescription>Prefilled from platform settings. Currency is fixed once the first transaction is recorded.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default Currency" htmlFor="defaultCurrency" required error={errors.defaultCurrency}>
              <NativeSelect id="defaultCurrency" value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Financial Year" htmlFor="fyStartMonth" required error={errors.fyStartMonth} hint={<>Current: {fy.display}</>}>
              <NativeSelect id="fyStartMonth" value={form.fyStartMonth} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>
                {FY_MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Time Zone" htmlFor="timeZone" required error={errors.timeZone} className="sm:col-span-2" hint="Used for transaction dates and reports.">
              <NativeSelect id="timeZone" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-primary" /> Workspace Admin
            </CardTitle>
            <CardDescription>They receive a secure, single-use invitation link to set their own password and MFA.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Workspace Admin Name" htmlFor="adminName" required error={errors.adminName}>
              <Input
                id="adminName"
                value={form.adminName}
                maxLength={120}
                autoComplete="off"
                aria-invalid={Boolean(errors.adminName)}
                onChange={(e) => set("adminName", e.target.value)}
                placeholder="Priya Sharma"
              />
            </FormField>
            <FormField label="Workspace Admin Email" htmlFor="adminEmail" required error={errors.adminEmail}>
              <Input
                id="adminEmail"
                type="email"
                value={form.adminEmail}
                maxLength={254}
                autoComplete="off"
                aria-invalid={Boolean(errors.adminEmail)}
                onChange={(e) => set("adminEmail", e.target.value)}
                placeholder="priya@acme.example"
              />
            </FormField>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button asChild variant="outline" type="button">
              <Link href="/admin/workspaces">Cancel</Link>
            </Button>
            <Button type="submit" loading={saving}>
              Create workspace
            </Button>
          </CardFooter>
        </Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>What happens on save</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {[
                "The workspace and its unique WS-ID are created.",
                "Settings, system roles, the default chart of accounts and categories are initialised.",
                "A pending Workspace Admin invitation is created.",
                "A secure invitation email is sent through Brevo.",
                "The creation is recorded in the audit log.",
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Alert variant="info" title="No passwords by email">
          The admin chooses their own password from the invitation link and must set up an authenticator app (MFA) before using the workspace.
        </Alert>
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> The workspace and its invitation are created atomically.
        </p>
      </aside>
    </form>
  );
}

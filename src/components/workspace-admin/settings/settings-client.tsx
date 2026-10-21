"use client";

import * as React from "react";
import { Bot, CopyCheck, Info, Mail, Send, ShieldCheck, Stamp } from "lucide-react";
import type { SettingsDTO, SummaryResult, WorkspaceInfoDTO } from "@/lib/workspace-admin/settings";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { Separator, Switch } from "@/components/ui/misc";
import { useMutation } from "../shared";

type FormState = {
  autoPostEnabled: boolean;
  confidencePct: number;
  requireApproval: boolean;
  approvalThreshold: string;
  duplicateWindowDays: number;
  mfaRequiredForUsers: boolean;
  dailySummaryEmail: boolean;
  monthlySummaryEmail: boolean;
};

function toForm(s: SettingsDTO): FormState {
  return {
    autoPostEnabled: s.autoPostEnabled,
    confidencePct: Math.round(s.autoPostMinConfidence * 100),
    requireApproval: s.requireApproval,
    approvalThreshold: s.approvalThreshold ?? "",
    duplicateWindowDays: s.duplicateWindowDays,
    mfaRequiredForUsers: s.mfaRequiredForUsers,
    dailySummaryEmail: s.dailySummaryEmail,
    monthlySummaryEmail: s.monthlySummaryEmail,
  };
}

const AMOUNT_RE = /^\d{1,15}(\.\d{1,2})?$/;

export function SettingsClient({ workspaceId, workspace, settings, updatedLabel }: { workspaceId: string; workspace: WorkspaceInfoDTO; settings: SettingsDTO; updatedLabel: string | null }) {
  const initial = React.useMemo(() => toForm(settings), [settings]);
  const [form, setForm] = React.useState<FormState>(initial);
  React.useEffect(() => setForm(initial), [initial]);
  const { pending, run } = useMutation();

  const threshold = form.approvalThreshold.replace(/,/g, "").trim();
  const thresholdValid = threshold === "" || AMOUNT_RE.test(threshold);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run(
      `/api/w/${workspaceId}/settings`,
      {
        method: "PATCH",
        body: {
          autoPostEnabled: form.autoPostEnabled,
          autoPostMinConfidence: form.confidencePct / 100,
          requireApproval: form.requireApproval,
          approvalThreshold: threshold === "" ? null : threshold,
          duplicateWindowDays: form.duplicateWindowDays,
          mfaRequiredForUsers: form.mfaRequiredForUsers,
          dailySummaryEmail: form.dailySummaryEmail,
          monthlySummaryEmail: form.monthlySummaryEmail,
        },
      },
      { success: (d: { changed: boolean }) => (d.changed ? "Settings saved" : "No changes to save") },
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <div className="space-y-6">
        <WorkspaceInfoCard workspace={workspace} />
        <SummaryCard workspaceId={workspaceId} currency={workspace.defaultCurrency} />
      </div>

      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle>Accounting &amp; workflow</CardTitle>
            <CardDescription>These rules are enforced on the server for every entry in this workspace.{updatedLabel ? ` Last changed ${updatedLabel}.` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <SettingRow
              icon={Bot}
              title="Auto-post AI entries"
              description="Lets high-confidence AI (text or voice) entries post straight to the ledger. Applies only when every account mapping is complete, no possible duplicate is found, approval is not required, and the person recording it has the Post Transactions permission. Everything else is saved for review."
              control={<Switch checked={form.autoPostEnabled} onCheckedChange={(v) => set("autoPostEnabled", v)} aria-label="Auto-post AI entries" />}
            >
              <div className={cn("mt-3 rounded-lg border bg-muted/30 p-3", !form.autoPostEnabled && "opacity-60")}>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="confidence" className="text-sm font-medium">
                    Minimum AI confidence
                  </label>
                  <span className="rounded-md bg-card px-2 py-0.5 text-sm font-semibold tabular">{form.confidencePct}%</span>
                </div>
                <input
                  id="confidence"
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={form.confidencePct}
                  onChange={(e) => set("confidencePct", Number(e.target.value))}
                  disabled={!form.autoPostEnabled}
                  className="mt-2 w-full accent-[var(--primary)]"
                />
                <p className="mt-1 text-xs text-muted-foreground">Entries below this confidence always go to review. 90% or higher is recommended.</p>
              </div>
            </SettingRow>

            <Separator />
            <SettingRow
              icon={Stamp}
              title="Require approval for every entry"
              description="When on, nothing is posted until someone with the Approve Transactions permission approves it — including entries by users who can post."
              control={<Switch checked={form.requireApproval} onCheckedChange={(v) => set("requireApproval", v)} aria-label="Require approval" />}
            >
              <div className={cn("mt-3 grid gap-1.5 sm:max-w-xs", form.requireApproval && "opacity-60")}>
                <label htmlFor="threshold" className="text-sm font-medium">
                  Approval threshold ({workspace.defaultCurrency})
                </label>
                <Input
                  id="threshold"
                  value={form.approvalThreshold}
                  onChange={(e) => set("approvalThreshold", e.target.value)}
                  inputMode="decimal"
                  placeholder="No threshold"
                  className="tabular"
                  aria-invalid={!thresholdValid}
                  disabled={form.requireApproval}
                />
                <p className={cn("text-xs", thresholdValid ? "text-muted-foreground" : "text-expense")}>
                  {thresholdValid
                    ? form.requireApproval
                      ? "Not used while approval is required for every entry."
                      : threshold
                        ? `Entries of ${formatMoney(threshold, workspace.defaultCurrency)} or more need approval before posting.`
                        : "Optional. Entries at or above this amount need approval before posting."
                    : "Enter a positive amount with at most 2 decimals, or leave it empty."}
                </p>
              </div>
            </SettingRow>

            <Separator />
            <SettingRow
              icon={CopyCheck}
              title="Duplicate detection window"
              description="New entries are compared with transactions of the same type and amount, with a similar description, within this many days either side of the date. Possible duplicates are flagged and never auto-posted. Use 0 to match the same day only."
              control={
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={form.duplicateWindowDays}
                    onChange={(e) => set("duplicateWindowDays", Math.max(0, Math.min(30, Math.trunc(Number(e.target.value) || 0))))}
                    className="w-20 tabular"
                    aria-label="Duplicate window in days"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              }
            />

            <Separator />
            <SettingRow
              icon={ShieldCheck}
              title="Require two-step verification for all members"
              description="Workspace Admins always need an authenticator app. Turn this on to require it for every member; people without it are asked to set it up at their next sign-in."
              control={<Switch checked={form.mfaRequiredForUsers} onCheckedChange={(v) => set("mfaRequiredForUsers", v)} aria-label="Require MFA for all members" />}
            />

            <Separator />
            <SettingRow
              icon={Mail}
              title="Transaction summary emails"
              description="Opt Workspace Admins in to scheduled summaries of posted income and expenses, sent through Brevo by the platform's summary job. You can also send one right now from the card on the left."
              control={null}
            >
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  Daily summary
                  <Switch checked={form.dailySummaryEmail} onCheckedChange={(v) => set("dailySummaryEmail", v)} aria-label="Daily summary email" />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  Monthly summary
                  <Switch checked={form.monthlySummaryEmail} onCheckedChange={(v) => set("monthlySummaryEmail", v)} aria-label="Monthly summary email" />
                </label>
              </div>
            </SettingRow>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setForm(initial)} disabled={!dirty || pending}>
              Discard
            </Button>
            <Button type="submit" loading={pending} disabled={!dirty || !thresholdValid}>
              Save settings
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

function SettingRow({ icon: Icon, title, description, control, children }: { icon: typeof Bot; title: string; description: string; control: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
            </div>
            {control && <div className="shrink-0">{control}</div>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function WorkspaceInfoCard({ workspace: w }: { workspace: WorkspaceInfoDTO }) {
  const rows: [string, React.ReactNode][] = [
    ["Workspace", w.name],
    ["Code", <span key="c" className="font-mono">{w.code}</span>],
    ["Reference", <span key="r" className="font-mono">{w.ref}</span>],
    ["Company", w.companyName],
    ["Company email", w.companyEmail],
    ["Country", w.country],
    ["Currency", w.defaultCurrency],
    ["Financial year starts", w.fyStartLabel],
    ["Time zone", w.timeZone],
    ["Status", <StatusBadge key="s" status={w.status} />],
    ["Created", formatDate(w.createdAt)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace profile</CardTitle>
        <CardDescription>Company details used on reports and exports.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <Alert variant="info" className="mt-4">
          <span className="flex items-start gap-1">
            <Info className="sr-only" />
            These details are managed by the platform Super Admin. Contact them to change the company name, currency, financial year or time zone.
          </span>
        </Alert>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ workspaceId, currency }: { workspaceId: string; currency: string }) {
  const [period, setPeriod] = React.useState<"daily" | "monthly">("daily");
  const [result, setResult] = React.useState<SummaryResult | null>(null);
  const { pending, run } = useMutation();

  async function send() {
    const data = await run<SummaryResult>(`/api/w/${workspaceId}/settings/summary`, { method: "POST", body: { period } }, {
      success: (d) => {
        const sent = d.recipients.filter((r) => r.status === "SENT").length;
        return d.recipients.length === 0 ? null : `Summary sent to ${sent} of ${d.recipients.length} admin${d.recipients.length === 1 ? "" : "s"}`;
      },
    });
    if (data) setResult(data);
  }

  const money = (v: string) => formatMoney(v, currency, { decimals: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send summary now</CardTitle>
        <CardDescription>Emails posted income and expense totals to every active Workspace Admin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value as "daily" | "monthly")} aria-label="Summary period" className="sm:w-48">
            <option value="daily">Daily (today)</option>
            <option value="monthly">Monthly (this month)</option>
          </NativeSelect>
          <Button onClick={send} loading={pending} variant="secondary">
            <Send /> Send summary
          </Button>
        </div>
        {result && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {result.period === "daily" ? "Daily" : "Monthly"} · {result.label}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[11px] text-muted-foreground">Income</p>
                <p className="text-sm font-semibold text-income tabular">{money(result.totals.income)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Expenses</p>
                <p className="text-sm font-semibold text-expense tabular">{money(result.totals.expenses)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Net · {result.totals.count} txns</p>
                <p className="text-sm font-semibold tabular">{money(result.totals.net)}</p>
              </div>
            </div>
            {result.recipients.length === 0 ? (
              <Alert variant="warning">No active Workspace Admins to email.</Alert>
            ) : (
              <ul className="divide-y text-sm">
                {result.recipients.map((r) => (
                  <li key={r.email} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.email}</span>
                      {r.error && <span className="block truncate text-[11px] text-expense" title={r.error}>{r.error}</span>}
                    </span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
            {result.recipients.some((r) => r.status !== "SENT") && (
              <p className="text-xs text-muted-foreground">Emails that were not delivered are listed in the Super Admin&apos;s Email Outbox.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

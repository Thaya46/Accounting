"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Download,
  FileCheck2,
  FileJson,
  FileSearch,
  History,
  Info,
  ListFilter,
  Loader2,
  PlugZap,
  Scale,
  Settings2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, financialYearFor, financialYearRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EXPORT_TYPE_LABEL, type ExportType } from "@/lib/export/canonical-schema";
import type { ExportRequestInput } from "@/lib/export/filters";
import type { AdapterSummary } from "@/lib/export/integrations";
import type { ExportJobDTO, ExportPreview } from "@/lib/export/service";
import type { AdapterKey } from "@/lib/export/adapter-keys";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, Switch } from "@/components/ui/misc";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AdapterCategoryBadge, AdapterStatusBadge, CopyButton, FileBadge, ProvenanceNote, formatBytes } from "./shared";
import { MultiSelect } from "./multi-select";
import { MappingEditor, type MappingChange } from "./mapping-editor";

type TxnType = "INCOME" | "EXPENSE" | "TRANSFER" | "JOURNAL";
type Status = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "REVERSED" | "REJECTED";

const ALL_STATUSES: { value: Status; label: string; posted: boolean }[] = [
  { value: "POSTED", label: "Posted", posted: true },
  { value: "REVERSED", label: "Reversed", posted: true },
  { value: "DRAFT", label: "Draft", posted: false },
  { value: "PENDING_APPROVAL", label: "Pending approval", posted: false },
  { value: "APPROVED", label: "Approved (not posted)", posted: false },
  { value: "REJECTED", label: "Rejected", posted: false },
];
const TYPE_LABEL: Record<TxnType, string> = { INCOME: "Income", EXPENSE: "Expenses", TRANSFER: "Transfers", JOURNAL: "Journals" };

export type ExportCenterProps = {
  workspaceId: string;
  currency: string;
  fyStartMonth: number;
  today: string;
  adapters: AdapterSummary[];
  users: { id: string; name: string; ref: string }[];
  categories: { id: string; name: string; kind: "INCOME" | "EXPENSE" }[];
  accounts: { id: string; code: string; name: string; type: string }[];
  history: ExportJobDTO[];
  canManageSettings: boolean;
};

export function ExportCenter(props: ExportCenterProps) {
  const { workspaceId, currency, fyStartMonth, today } = props;
  const [adapters, setAdapters] = React.useState(props.adapters);
  const initial = adapters.find((a) => a.spec.key === "canonical-json") ?? adapters[0];
  const [adapterKey, setAdapterKey] = React.useState<AdapterKey>(initial.spec.key);
  const summary = adapters.find((a) => a.spec.key === adapterKey) ?? initial;
  const adapter = summary.spec;

  const currentFy = financialYearFor(today, fyStartMonth);
  const fyOptions = [0, 1, 2, 3].map((k) => financialYearRange(currentFy.startYear - k, fyStartMonth));
  const [periodKind, setPeriodKind] = React.useState<"fy" | "custom">("fy");
  const [fyStart, setFyStart] = React.useState(currentFy.startYear);
  const [custom, setCustom] = React.useState({ from: currentFy.from, to: today });

  const [exportType, setExportType] = React.useState<ExportType>("accounting_transactions");
  const [typeMode, setTypeMode] = React.useState<"all" | "income" | "expense" | "custom">("all");
  const [customTypes, setCustomTypes] = React.useState<TxnType[]>(["INCOME", "EXPENSE", "TRANSFER", "JOURNAL"]);
  const [statuses, setStatuses] = React.useState<Status[]>(["POSTED", "REVERSED"]);
  const [createdById, setCreatedById] = React.useState("");
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);
  const [accountIds, setAccountIds] = React.useState<string[]>([]);
  const [excludeExported, setExcludeExported] = React.useState(adapter.defaultExcludeExported);
  const [includeAuditTrail, setIncludeAuditTrail] = React.useState(true);

  const [preview, setPreview] = React.useState<ExportPreview | null>(null);
  const [previewFor, setPreviewFor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [savingMap, setSavingMap] = React.useState(false);
  const [lastJob, setLastJob] = React.useState<ExportJobDTO | null>(null);
  const [history, setHistory] = React.useState(props.history);
  const resultRef = React.useRef<HTMLDivElement>(null);

  const types: TxnType[] = typeMode === "all" ? [] : typeMode === "income" ? ["INCOME"] : typeMode === "expense" ? ["EXPENSE"] : customTypes.length === 4 ? [] : customTypes;
  const request: ExportRequestInput = {
    adapterKey,
    exportType,
    period: periodKind === "fy" ? { kind: "fy", startYear: fyStart } : { kind: "custom", from: custom.from, to: custom.to },
    types,
    statuses,
    createdById: createdById || null,
    categoryIds,
    accountIds,
    excludeAlreadyExported: excludeExported,
    includeAuditTrail,
  };
  const requestKey = JSON.stringify(request);
  const stale = preview !== null && previewFor !== requestKey;

  function selectAdapter(key: AdapterKey) {
    const next = adapters.find((a) => a.spec.key === key)!.spec;
    setAdapterKey(key);
    setExcludeExported(next.defaultExcludeExported);
    if (next.supportedExportTypes.length && !next.supportedExportTypes.includes(exportType)) setExportType(next.supportedExportTypes[0]);
    if (!next.allowsDrafts) {
      const kept = statuses.filter((s) => s === "POSTED" || s === "REVERSED");
      setStatuses(kept.length ? kept : ["POSTED", "REVERSED"]);
    }
    setPreview(null);
    setLastJob(null);
  }

  const customRangeError = periodKind === "custom" && (!custom.from || !custom.to || custom.to < custom.from) ? "The end date must be on or after the start date." : null;

  async function runPreview(scroll = true) {
    if (customRangeError) return toast.error(customRangeError);
    if (!statuses.length) return toast.error("Choose at least one status.");
    setLoading(true);
    try {
      const p = await apiFetch<ExportPreview>(`/api/w/${workspaceId}/export/preview`, { body: request });
      setPreview(p);
      setPreviewFor(requestKey);
      setLastJob(null);
      setAdapters((list) => list.map((a) => (a.spec.key === p.adapter.key ? { ...a, status: p.status } : a)));
      if (scroll) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveMappings(changes: MappingChange[]) {
    setSavingMap(true);
    try {
      await apiFetch(`/api/w/${workspaceId}/integrations/${adapterKey}`, { method: "PUT", body: { mappings: changes } });
      toast.success(`Saved ${changes.length} mapping${changes.length === 1 ? "" : "s"}`);
      await runPreview(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save mappings");
    } finally {
      setSavingMap(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const { job } = await apiFetch<{ job: ExportJobDTO }>(`/api/w/${workspaceId}/export`, { body: request });
      setLastJob(job);
      setHistory((h) => [job, ...h.filter((x) => x.id !== job.id)]);
      setPreview(null);
      toast.success(`Export ready: ${job.fileName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setGenerating(false);
    }
  }

  const errors = preview?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.level === "warning") ?? [];
  const canGenerate = Boolean(preview && !stale && preview.status.status === "available" && errors.length === 0 && preview.file);
  const showDraftStatuses = adapter.allowsDrafts;
  const typeOptions = adapter.supportedExportTypes.length ? adapter.supportedExportTypes : (["accounting_transactions"] as ExportType[]);

  return (
    <div className="space-y-6">
      {/* ── 1. Accounting software selector ── */}
      <section aria-labelledby="sel-title" className="space-y-3">
        <SectionTitle id="sel-title" icon={PlugZap} step={1} title="Accounting software" description="Each target receives its own documented import format, converted from the canonical JSON." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {adapters.map((a) => {
            const active = a.spec.key === adapterKey;
            return (
              <button
                key={a.spec.key}
                type="button"
                onClick={() => selectAdapter(a.spec.key)}
                aria-pressed={active}
                className={cn(
                  "group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-primary ring-2 ring-primary/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.spec.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.spec.fileType}</p>
                  </div>
                  <AdapterStatusBadge status={a.status} className="shrink-0" />
                </div>
                <ProvenanceNote provenance={a.spec.provenance} />
              </button>
            );
          })}
        </div>
        <AdapterBrief summary={summary} workspaceId={workspaceId} canManageSettings={props.canManageSettings} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── 2. Date range ── */}
        <Card>
          <CardHeader>
            <SectionTitle icon={CalendarRange} step={2} title="Date range" description="Financial year presets follow the workspace's FY start month." />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Period">
              {fyOptions.map((fy) => (
                <Button
                  key={fy.startYear}
                  type="button"
                  role="radio"
                  aria-checked={periodKind === "fy" && fyStart === fy.startYear}
                  size="sm"
                  variant={periodKind === "fy" && fyStart === fy.startYear ? "default" : "outline"}
                  onClick={() => {
                    setPeriodKind("fy");
                    setFyStart(fy.startYear);
                  }}
                >
                  {fy.label}
                </Button>
              ))}
              <Button type="button" role="radio" aria-checked={periodKind === "custom"} size="sm" variant={periodKind === "custom" ? "default" : "outline"} onClick={() => setPeriodKind("custom")}>
                Custom range
              </Button>
            </div>
            {periodKind === "fy" ? (
              <p className="text-sm text-muted-foreground">
                {formatDate(financialYearRange(fyStart, fyStartMonth).from)} – {formatDate(financialYearRange(fyStart, fyStartMonth).to)}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="From" htmlFor="exp-from" required>
                  <Input id="exp-from" type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </FormField>
                <FormField label="To" htmlFor="exp-to" required error={customRangeError}>
                  <Input id="exp-to" type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </FormField>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── 3. Export format & filters ── */}
        <Card>
          <CardHeader>
            <SectionTitle icon={ListFilter} step={3} title="Export format & filters" description="Narrow the export by type, status, user, category or account." />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Export" htmlFor="exp-type">
                <NativeSelect id="exp-type" value={exportType} onChange={(e) => setExportType(e.target.value as ExportType)} disabled={!adapter.implemented}>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {EXPORT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Transactions" htmlFor="exp-txn">
                <NativeSelect id="exp-txn" value={typeMode} onChange={(e) => setTypeMode(e.target.value as typeof typeMode)}>
                  <option value="all">All transactions</option>
                  <option value="income">Income only</option>
                  <option value="expense">Expenses only</option>
                  <option value="custom">Choose types…</option>
                </NativeSelect>
              </FormField>
            </div>
            {typeMode === "custom" && (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(Object.keys(TYPE_LABEL) as TxnType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={customTypes.includes(t)} onCheckedChange={(c) => setCustomTypes((s) => (c ? [...s, t] : s.filter((x) => x !== t)))} />
                    {TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Status</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ALL_STATUSES.filter((s) => s.posted || showDraftStatuses).map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={statuses.includes(s.value)} onCheckedChange={(c) => setStatuses((x) => (c ? [...x, s.value] : x.filter((v) => v !== s.value)))} />
                    {s.label}
                  </label>
                ))}
              </div>
              {!showDraftStatuses && <p className="text-xs text-muted-foreground">{adapter.name} receives posted entries only. Drafts can be exported to the canonical JSON.</p>}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Entered by" htmlFor="exp-user">
                <NativeSelect id="exp-user" value={createdById} onChange={(e) => setCreatedById(e.target.value)}>
                  <option value="">All users</option>
                  {props.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.ref})
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Categories" htmlFor="exp-cat">
                <MultiSelect
                  id="exp-cat"
                  noun="category"
                  allLabel="All categories"
                  value={categoryIds}
                  onChange={setCategoryIds}
                  options={props.categories.map((c) => ({ value: c.id, label: c.name, group: c.kind === "INCOME" ? "Income" : "Expense" }))}
                />
              </FormField>
              <FormField label="Accounts / ledgers" htmlFor="exp-acc">
                <MultiSelect id="exp-acc" noun="account" allLabel="All accounts" value={accountIds} onChange={setAccountIds} options={props.accounts.map((a) => ({ value: a.id, label: a.name, hint: a.code }))} />
              </FormField>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <ToggleRow
                id="exp-dedupe"
                checked={excludeExported}
                onChange={setExcludeExported}
                label={`Exclude transactions already exported to ${adapter.name}`}
                hint="Prevents duplicate imports. A transaction reversed after its last export is sent as its reversal only."
              />
              <ToggleRow id="exp-trail" checked={includeAuditTrail} onChange={setIncludeAuditTrail} label="Include the full audit event trail" hint="Every CREATED / SUBMITTED / APPROVED / POSTED / REVERSED / EXPORTED event, in the canonical JSON and the audit metadata file." />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {stale && <span className="text-xs text-warning sm:mr-auto">Settings changed — validate again before generating.</span>}
        <Button size="lg" onClick={() => runPreview()} loading={loading} disabled={Boolean(customRangeError)}>
          {!loading && <FileSearch />} Validate & preview
        </Button>
      </div>

      {/* ── 4–6. Validation, mapping, preview ── */}
      <div ref={resultRef} className="scroll-mt-20 space-y-6">
        {loading && !preview && (
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Building the canonical export and validating journals…
            </CardContent>
          </Card>
        )}
        {preview && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("space-y-6", stale && "opacity-60")}>
            <ValidationPanel preview={preview} errors={errors} warnings={warnings} currency={currency} />

            {preview.adapter.requiresAccountMapping && preview.adapter.implemented && (
              <Card>
                <CardHeader>
                  <SectionTitle icon={Scale} step={5} title="Account mapping" description={`Map every account used in this selection to ${preview.adapter.name}. Mappings are saved for this workspace.`} />
                </CardHeader>
                <CardContent>
                  <MappingEditor
                    adapter={preview.adapter}
                    rows={preview.accountsUsed.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, type: a.type, subtype: a.subtype, externalCode: a.externalCode, externalName: a.externalName }))}
                    onSave={saveMappings}
                    saving={savingMap}
                    emptyText="No accounts are used by this selection."
                  />
                </CardContent>
              </Card>
            )}

            <PreviewPanel preview={preview} currency={currency} />

            <Card className={cn(canGenerate && "border-primary/40")}>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Generate & download</p>
                  <p className="text-sm text-muted-foreground">
                    {canGenerate
                      ? `Creates the ${preview.adapter.name} file and a separate audit metadata file, and records the export in history.`
                      : stale
                        ? "Validate again with the current settings first."
                        : preview.status.status !== "available"
                          ? `${preview.status.label}: ${preview.status.reasons.join(" ") || "resolve the issues above."}`
                          : "Resolve the validation errors above to enable generation."}
                  </p>
                </div>
                <Button size="lg" onClick={generate} loading={generating} disabled={!canGenerate} className="shrink-0">
                  {!generating && <FileCheck2 />} Generate export
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {lastJob && <GeneratedResult job={lastJob} workspaceId={workspaceId} summary={summary} />}
      </div>

      {/* ── 7. Export history ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Export history
            </CardTitle>
            <CardDescription>Every export with its filters, checksum and both files.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <HistoryTable items={history} workspaceId={workspaceId} />
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTitle({ id, icon: Icon, step, title, description }: { id?: string; icon: React.ComponentType<{ className?: string }>; step: number; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{step}</span>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function ToggleRow({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function AdapterBrief({ summary, workspaceId, canManageSettings }: { summary: AdapterSummary; workspaceId: string; canManageSettings: boolean }) {
  const a = summary.spec;
  return (
    <Card className="bg-muted/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{a.name}</p>
          <AdapterCategoryBadge category={a.category} />
          <AdapterStatusBadge status={summary.status} />
          {a.apiTransfer.status === "not_implemented" && a.implemented && <Badge variant="muted">API transfer: Not Implemented</Badge>}
          {canManageSettings && a.implemented && (
            <Button asChild variant="link" size="sm" className="ml-auto h-auto px-0">
              <Link href={`/w/${workspaceId}/integrations#${a.key}`}>
                <Settings2 /> Configure
              </Link>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{a.importMechanism}</p>
        {summary.status.reasons.length > 0 && <p className="text-sm text-warning">{summary.status.reasons.join(" ")}</p>}
        {a.implemented && a.category === "native" && (
          <Alert variant="info" title="Run a test import first">
            Generated from the documented import format — run a test import in {a.name} before relying on it.
          </Alert>
        )}
        {!a.implemented && (
          <Alert variant="warning" title="Not Implemented">
            {a.verificationNote} Use the canonical JSON, generic CSV or a custom layout instead.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ValidationPanel({ preview, errors, warnings, currency }: { preview: ExportPreview; errors: ExportPreview["issues"]; warnings: ExportPreview["issues"]; currency: string }) {
  const c = preview.counts;
  const ok = preview.status.status === "available" && errors.length === 0;
  const Icon = ok ? CheckCircle2 : preview.status.status === "configuration_required" ? AlertTriangle : XCircle;
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={ShieldCheck} step={4} title="Validation status" description={`${preview.adapter.name} · ${preview.range.label ?? `${formatDate(preview.range.from)} – ${formatDate(preview.range.to)}`} · ${EXPORT_TYPE_LABEL[preview.exportType]}`} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border p-3", ok ? "border-income/30 bg-income-soft" : preview.status.status === "configuration_required" ? "border-warning/30 bg-warning-soft" : "border-expense/30 bg-expense-soft")}>
          <Icon className={cn("h-5 w-5", ok ? "text-income" : preview.status.status === "configuration_required" ? "text-warning" : "text-expense")} />
          <AdapterStatusBadge status={errors.length && preview.status.status === "available" ? { status: "validation_failed", label: "Validation Failed" } : preview.status} />
          <span className="text-sm text-foreground/80">{ok ? "All included entries balance and every required field is present." : preview.status.reasons.join(" ") || `${errors.length} error${errors.length === 1 ? "" : "s"} must be fixed.`}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Transactions" value={c.transactions} />
          <Stat label={preview.counts.ledgers ? "Ledgers" : "Documents"} value={preview.counts.ledgers || c.documents || c.journalEntries} />
          <Stat label="Lines" value={c.lines} />
          <Stat label="Balanced" value={c.balanced ? "Yes" : "No"} tone={c.balanced ? "good" : "bad"} />
          <Stat label="Total debit" value={formatMoney(c.totalDebit, currency, { decimals: true })} />
          <Stat label="Total credit" value={formatMoney(c.totalCredit, currency, { decimals: true })} />
          <Stat label="Already exported (skipped)" value={c.excludedAlreadyExported} />
          <Stat label="Reversal only" value={c.reversalOnly} />
        </dl>
        {errors.length > 0 && <IssueList title={`${errors.length} error${errors.length === 1 ? "" : "s"} — generation blocked`} items={errors} variant="danger" />}
        {warnings.length > 0 && <IssueList title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`} items={warnings} variant="warning" />}
        {preview.notes.map((n) => (
          <Alert key={n} variant="info">
            {n}
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-semibold tabular", tone === "good" && "text-income", tone === "bad" && "text-expense")}>{value}</dd>
    </div>
  );
}

function IssueList({ title, items, variant }: { title: string; items: ExportPreview["issues"]; variant: "danger" | "warning" }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <Alert variant={variant} title={title}>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {shown.map((i, k) => (
          <li key={k} className="break-words">
            {i.transactionId && <span className="font-mono text-xs">{i.transactionId}: </span>}
            {i.message}
          </li>
        ))}
      </ul>
      {items.length > 8 && (
        <button type="button" className="mt-2 text-xs font-medium underline-offset-4 hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </Alert>
  );
}

function PreviewPanel({ preview, currency }: { preview: ExportPreview; currency: string }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={FileJson} step={6} title="Export preview" description="The beginning of the file exactly as it will be generated." />
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.file ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileBadge name={preview.file.fileName} />
              <span className="text-muted-foreground">{formatBytes(preview.file.size)}</span>
              {preview.auditFileName && (
                <>
                  <span className="text-muted-foreground">+</span>
                  <FileBadge name={preview.auditFileName} />
                </>
              )}
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed scrollbar-thin">
              {preview.file.excerpt}
              {preview.file.truncated ? "\n…" : ""}
            </pre>
            {preview.file.truncated && <p className="text-xs text-muted-foreground">Preview truncated — the generated file contains every record.</p>}
          </>
        ) : (
          <EmptyState icon={FileSearch} title="No file preview" description="The preview appears once the integration is available and validation passes." className="py-6" />
        )}
        {preview.sample.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Reference</TH>
                  <TH>Description</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Entered by</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {preview.sample.map((s) => (
                  <TR key={s.transactionId}>
                    <TD className="whitespace-nowrap">{formatDate(s.date)}</TD>
                    <TD className="font-mono text-xs">{s.transactionId}</TD>
                    <TD className="max-w-[240px] truncate">{s.description}</TD>
                    <TD className="capitalize">{s.type}</TD>
                    <TD className="whitespace-nowrap text-right tabular">{formatMoney(s.amount, s.currency || currency, { decimals: true })}</TD>
                    <TD className="whitespace-nowrap">{s.createdBy}</TD>
                    <TD>
                      <StatusBadge status={s.status.toUpperCase()} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {preview.counts.transactions > preview.sample.length && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first {preview.sample.length} of {preview.counts.transactions} transactions.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function downloadUrl(workspaceId: string, jobId: string, file: "data" | "audit") {
  return `/api/w/${workspaceId}/export/${encodeURIComponent(jobId)}/download?file=${file}`;
}

function GeneratedResult({ job, workspaceId, summary }: { job: ExportJobDTO; workspaceId: string; summary: AdapterSummary }) {
  const full = summary.spec.provenance.fullAuditTransfer;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-income/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-income" /> Export generated
          </CardTitle>
          <CardDescription>
            {job.recordCount} record{job.recordCount === 1 ? "" : "s"} · {job.filtersSummary}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild>
              <a href={downloadUrl(workspaceId, job.id, "data")} download>
                <Download /> {job.fileName}
              </a>
            </Button>
            {job.auditFileName && (
              <Button asChild variant="outline">
                <a href={downloadUrl(workspaceId, job.id, "audit")} download>
                  <ShieldCheck /> Audit metadata ({job.auditFileName.split(".").slice(-2).join(".")})
                </a>
              </Button>
            )}
          </div>
          {!full ? (
            <Alert variant="warning" title={`${summary.spec.name} cannot hold the complete audit metadata`}>
              {summary.spec.provenance.description} Approval, posting, modification and reversal history stays in the audit metadata file — keep it with the export.
            </Alert>
          ) : (
            <Alert variant="success">The export carries full attribution; the audit metadata file is provided as a separate record.</Alert>
          )}
          {summary.spec.category === "native" && <Alert variant="info">Generated from the documented import format — run a test import in {summary.spec.name} before relying on it.</Alert>}
          {job.warnings.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                <Info className="mr-1 inline h-3.5 w-3.5" />
                {job.warnings.length} note{job.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            SHA-256 <span className="break-all font-mono">{job.checksum}</span> <CopyButton value={job.checksum} label="Copy checksum" />
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HistoryTable({ items, workspaceId }: { items: ExportJobDTO[]; workspaceId: string }) {
  if (!items.length) return <EmptyState icon={History} title="No exports yet" description="Generated exports appear here with both files available for re-download." />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>When</TH>
          <TH>Target</TH>
          <TH>Format</TH>
          <TH className="text-right">Records</TH>
          <TH>Filters</TH>
          <TH>Created by</TH>
          <TH>Checksum</TH>
          <TH className="text-right">Files</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((j) => (
          <TR key={j.id}>
            <TD className="whitespace-nowrap text-xs">{formatDateTime(j.createdAt)}</TD>
            <TD className="whitespace-nowrap font-medium">{j.adapterName}</TD>
            <TD className="whitespace-nowrap">
              <Badge variant="outline">{j.format}</Badge> <span className="text-xs text-muted-foreground">{EXPORT_TYPE_LABEL[j.exportType as ExportType] ?? j.exportType}</span>
            </TD>
            <TD className="text-right tabular">{j.recordCount}</TD>
            <TD className="min-w-[220px] max-w-[320px] text-xs text-muted-foreground">{j.filtersSummary}</TD>
            <TD className="whitespace-nowrap">{j.createdByName}</TD>
            <TD className="whitespace-nowrap">
              <span className="font-mono text-xs" title={j.checksum}>
                {j.checksum.slice(0, 12)}…
              </span>
              <CopyButton value={j.checksum} label="Copy SHA-256" />
            </TD>
            <TD className="whitespace-nowrap text-right">
              <div className="flex justify-end gap-1">
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl(workspaceId, j.id, "data")} download aria-label={`Download ${j.fileName}`}>
                    <Download /> File
                  </a>
                </Button>
                {j.auditFileName && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={downloadUrl(workspaceId, j.id, "audit")} download aria-label={`Download ${j.auditFileName}`}>
                      <ShieldCheck /> Audit
                    </a>
                  </Button>
                )}
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

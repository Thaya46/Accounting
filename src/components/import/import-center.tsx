"use client";

import * as React from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Copy, FileJson, FileWarning, FolderOpen, History, Scale, Tags, Upload, UserRound, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { ImportJobDTO, ImportPreview } from "@/lib/import/service";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge, TypeBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Checkbox, Switch, Tooltip } from "@/components/ui/misc";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 50;

type PreviewResponse = { job: ImportJobDTO; schemaErrors: { path: string; message: string }[]; preview: ImportPreview | null };
type ConfirmResponse = { job: ImportJobDTO; results: NonNullable<ImportPreview["results"]> };
type JobDetail = { job: ImportJobDTO; preview: ImportPreview | null; errors: { index?: number; transactionId?: string; path?: string; message: string }[]; canConfirm: boolean };

export type ImportCenterProps = {
  workspaceId: string;
  workspaceLabel: string;
  currency: string;
  actorName: string;
  canPost: boolean;
  accounts: { id: string; code: string; name: string; type: string }[];
  categories: { id: string; name: string; kind: "INCOME" | "EXPENSE" }[];
  history: ImportJobDTO[];
};

export function ImportCenter(props: ImportCenterProps) {
  const { workspaceId, currency } = props;
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [job, setJob] = React.useState<ImportJobDTO | null>(null);
  const [schemaErrors, setSchemaErrors] = React.useState<PreviewResponse["schemaErrors"]>([]);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [accountMap, setAccountMap] = React.useState<Record<string, string>>({});
  const [categoryMap, setCategoryMap] = React.useState<Record<string, string | null>>({});
  const [skipDuplicates, setSkipDuplicates] = React.useState(true);
  const [postBalanced, setPostBalanced] = React.useState(false);
  const [acknowledge, setAcknowledge] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [results, setResults] = React.useState<ConfirmResponse | null>(null);
  const [history, setHistory] = React.useState(props.history);
  const [shown, setShown] = React.useState(PAGE);

  function reset() {
    setJob(null);
    setSchemaErrors([]);
    setPreview(null);
    setResults(null);
    setAcknowledge(false);
    setPostBalanced(false);
    setSkipDuplicates(true);
    setShown(PAGE);
  }

  function applyPreview(p: ImportPreview) {
    setPreview(p);
    setAccountMap(Object.fromEntries(p.accountCodes.filter((a) => a.suggestedAccountId).map((a) => [a.code, a.suggestedAccountId!])));
    setCategoryMap(Object.fromEntries(p.categories.map((c) => [c.key, c.suggestedCategoryId])));
  }

  async function handleFile(file: File) {
    reset();
    if (!/\.(json|xml)$/i.test(file.name) && !["application/json", "application/xml", "text/xml"].includes(file.type)) {
      return toast.error("Choose a .json or Tally .xml file.");
    }
    if (file.size > MAX_BYTES) return toast.error("The file is larger than 5 MB. Split into smaller files.");
    if (file.size === 0) return toast.error("The file is empty.");
    setUploading(true);
    try {
      const content = await file.text();
      const r = await apiFetch<PreviewResponse>(`/api/w/${workspaceId}/import/preview`, { body: { fileName: file.name, content } });
      setJob(r.job);
      setHistory((h) => [r.job, ...h.filter((x) => x.id !== r.job.id)]);
      if (r.preview) {
        applyPreview(r.preview);
        toast.success(`${r.preview.records.length} transaction${r.preview.records.length === 1 ? "" : "s"} ready for review`);
      } else {
        setSchemaErrors(r.schemaErrors);
        toast.error("The file does not match the canonical JSON schema");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openJob(id: string) {
    reset();
    try {
      const d = await apiFetch<JobDetail>(`/api/w/${workspaceId}/import/${id}`);
      setJob(d.job);
      if (d.preview?.results) {
        setPreview(d.preview);
        setResults({ job: d.job, results: d.preview.results });
      } else if (d.preview && d.canConfirm) applyPreview(d.preview);
      else if (d.preview && d.job.status === "PREVIEW") return toast.info(`Only ${d.job.importedByName} can confirm this import.`);
      else if (d.errors.length) setSchemaErrors(d.errors.map((e) => ({ path: e.path ?? (e.transactionId ? `${e.transactionId}` : "(file)"), message: e.message })));
      else return toast.info("This import has no preview to resume.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the import");
    }
  }

  async function confirm() {
    if (!job || !preview) return;
    setConfirming(true);
    try {
      const r = await apiFetch<ConfirmResponse>(`/api/w/${workspaceId}/import/${job.id}/confirm`, {
        body: { accountMap, categoryMap, skipDuplicates, postBalanced: props.canPost && postBalanced, acknowledgeWorkspaceMismatch: acknowledge },
      });
      setResults(r);
      setJob(r.job);
      setHistory((h) => [r.job, ...h.filter((x) => x.id !== r.job.id)]);
      if (r.job.importedCount) toast.success(`Imported ${r.job.importedCount} transaction${r.job.importedCount === 1 ? "" : "s"}`);
      else toast.error("Nothing was imported — see the results below");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setConfirming(false);
    }
  }

  const fileErrors = preview?.fileIssues.filter((i) => i.level === "error") ?? [];
  const fileWarnings = preview?.fileIssues.filter((i) => i.level === "warning") ?? [];
  const records = preview?.records ?? [];
  const valid = records.filter((r) => !r.issues.length);
  const duplicates = valid.filter((r) => r.duplicate);
  const importable = valid.filter((r) => !(skipDuplicates && r.duplicate));
  const neededCodes = new Set(importable.flatMap((r) => r.lines.map((l) => l.accountCode)));
  const unmappedNeeded = [...neededCodes].filter((c) => !accountMap[c]);
  const mismatch = preview ? !preview.workspaceMatch : false;
  const blocked = !preview || fileErrors.length > 0 || (mismatch && !acknowledge) || importable.length === 0 || Boolean(results);

  return (
    <div className="space-y-6">
      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> Upload Canonical JSON or Tally XML
          </CardTitle>
          <CardDescription>
            Import accounting data from VLedger JSON or native Tally XML (DayBook.xml, Vouchers.xml from TallyPrime or Tally.ERP 9).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors", dragging ? "border-primary bg-accent/50" : "border-border")}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <FileJson className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Drop a .json or Tally .xml file here</p>
              <p className="text-sm text-muted-foreground">or choose one from your device</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.xml,application/json,application/xml,text/xml"
              className="sr-only"
              id="import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button type="button" variant="outline" loading={uploading} onClick={() => fileInput.current?.click()}>
              {!uploading && <FolderOpen />} {uploading ? "Validating…" : "Choose file"}
            </Button>
          </div>
          <Alert variant="info" title="Attribution">
            Imported transactions are created by you ({props.actorName}) with source “Import”. The creator named in the file is kept only as external provenance — it is never treated as a VLedger user.
          </Alert>
        </CardContent>
      </Card>

      {schemaErrors.length > 0 && (
        <Alert variant="danger" title={`The file was rejected — ${schemaErrors.length} problem${schemaErrors.length === 1 ? "" : "s"}`}>
          <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto pr-2 scrollbar-thin">
            {schemaErrors.map((e, i) => (
              <li key={i} className="break-words">
                <span className="font-mono text-xs">{e.path}</span> — {e.message}
              </li>
            ))}
          </ul>
          {job && (
            <a className="mt-2 inline-block text-xs font-medium underline-offset-4 hover:underline" href={`/api/w/${workspaceId}/import/${job.id}/errors`} download>
              Download error report (CSV)
            </a>
          )}
        </Alert>
      )}

      {preview && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Review “{preview.fileName}”</CardTitle>
              <CardDescription>
                Schema {preview.schemaVersion} · {preview.exportType.replace(/_/g, " ")}
                {preview.generatedAt ? ` · generated ${formatDateTime(preview.generatedAt)}` : ""}
                {preview.generatedBy ? ` by ${preview.generatedBy.name} (external ${preview.generatedBy.userId})` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Records" value={records.length} />
                <Stat label="Ready" value={valid.length - duplicates.length} tone="good" />
                <Stat label="Possible duplicates" value={duplicates.length} tone={duplicates.length ? "warn" : undefined} />
                <Stat label="With errors" value={records.length - valid.length} tone={records.length - valid.length ? "bad" : undefined} />
              </dl>
              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source workspace</p>
                <p className="mt-1">
                  {preview.fileWorkspace.workspaceName} <span className="font-mono text-xs text-muted-foreground">{preview.fileWorkspace.workspaceId}</span>
                  {preview.fileWorkspace.workspaceCode && <span className="font-mono text-xs text-muted-foreground"> · {preview.fileWorkspace.workspaceCode}</span>} · {preview.fileWorkspace.currency}{" "}
                  {preview.workspaceMatch ? <Badge variant="success">This workspace</Badge> : <Badge variant="warning">Different workspace</Badge>}
                </p>
              </div>
              {fileErrors.map((i) => (
                <Alert key={i.message} variant="danger">
                  {i.message}
                </Alert>
              ))}
              {fileWarnings.map((i) => (
                <Alert key={i.message} variant="warning">
                  {i.message}
                </Alert>
              ))}
              {mismatch && !fileErrors.length && !results && (
                <label className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
                  <Checkbox checked={acknowledge} onCheckedChange={(v) => setAcknowledge(v === true)} className="mt-0.5" />
                  <span>
                    I understand this file comes from <strong>{preview.fileWorkspace.workspaceName}</strong> and want to import it into <strong>{props.workspaceLabel}</strong>.
                  </span>
                </label>
              )}
            </CardContent>
          </Card>

          {/* Account mapping */}
          {preview.accountCodes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-primary" /> Account mapping
                </CardTitle>
                <CardDescription>Journal line account codes from the file, matched to this workspace&apos;s chart of accounts by code. Unmatched codes need a manual choice.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-0 sm:p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>File account</TH>
                      <TH className="text-right">Lines</TH>
                      <TH className="min-w-[240px]">Workspace account</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.accountCodes.map((a) => (
                      <TR key={a.code}>
                        <TD>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs">{a.code}</span>
                            {!accountMap[a.code] && neededCodes.has(a.code) && <Badge variant="warning">Unmapped</Badge>}
                          </div>
                          {a.name && <div className="text-xs text-muted-foreground">{a.name}</div>}
                          {a.note && <div className="text-xs text-warning">{a.note}</div>}
                        </TD>
                        <TD className="text-right tabular">{a.lines}</TD>
                        <TD>
                          <NativeSelect aria-label={`Workspace account for ${a.code}`} value={accountMap[a.code] ?? ""} onChange={(e) => setAccountMap((m) => ({ ...m, [a.code]: e.target.value }))} className="h-8">
                            <option value="">— Choose account —</option>
                            {props.accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.code} · {acc.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Category mapping */}
          {preview.categories.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-primary" /> Category mapping
                </CardTitle>
                <CardDescription>Matched by name and kind. Choose a category or leave it blank — the posting accounts come from the journal lines either way.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>File category</TH>
                      <TH className="text-right">Records</TH>
                      <TH className="min-w-[220px]">Workspace category</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.categories.map((c) => (
                      <TR key={c.key}>
                        <TD>
                          <div className="flex items-center gap-2">
                            <TypeBadge type={c.kind} />
                            <span>{c.name}</span>
                          </div>
                        </TD>
                        <TD className="text-right tabular">{c.records}</TD>
                        <TD>
                          <NativeSelect aria-label={`Workspace category for ${c.name}`} value={categoryMap[c.key] ?? ""} onChange={(e) => setCategoryMap((m) => ({ ...m, [c.key]: e.target.value || null }))} className="h-8">
                            <option value="">Leave blank</option>
                            {props.categories
                              .filter((x) => x.kind === c.kind)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                          </NativeSelect>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Records */}
          <Card>
            <CardHeader>
              <CardTitle>Transactions in the file</CardTitle>
              <CardDescription>Each record&apos;s journal lines must balance. Original creators come from the file and are shown for reference only.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Type</TH>
                    <TH>Original creator</TH>
                    <TH className="text-right">Lines</TH>
                    <TH className="min-w-[220px]">Checks</TH>
                    {results && <TH>Result</TH>}
                  </TR>
                </THead>
                <TBody>
                  {records.slice(0, shown).map((r) => {
                    const res = results?.results.find((x) => x.index === r.index);
                    return (
                      <TR key={r.index} className={cn(r.issues.length > 0 && "bg-expense-soft/40")}>
                        <TD className="text-xs text-muted-foreground tabular">{r.index + 1}</TD>
                        <TD className="whitespace-nowrap">{formatDate(r.date)}</TD>
                        <TD className="min-w-[180px] max-w-[280px]">
                          <div className="truncate">{r.description}</div>
                          <div className="font-mono text-xs text-muted-foreground">{r.transactionId}</div>
                        </TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatMoney(r.amount, r.currency || currency, { decimals: true })}</TD>
                        <TD className="whitespace-nowrap">
                          <TypeBadge type={r.importType} />
                          {r.importType.toLowerCase() !== r.fileType && <span className="ml-1 text-xs text-muted-foreground">(file: {r.fileType})</span>}
                        </TD>
                        <TD className="whitespace-nowrap">
                          <Tooltip content="From the file — external, not a VLedger user">
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.externalCreator.name}
                              <span className="font-mono text-xs text-muted-foreground">{r.externalCreator.userId}</span>
                            </span>
                          </Tooltip>
                        </TD>
                        <TD className="text-right tabular">{r.lines.length}</TD>
                        <TD className="text-xs">
                          <div className="space-y-1">
                            {r.issues.map((i) => (
                              <p key={i} className="flex items-start gap-1 text-expense">
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {i}
                              </p>
                            ))}
                            {r.duplicate && (
                              <p className="flex items-start gap-1 text-warning">
                                <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.duplicate.reason}
                              </p>
                            )}
                            {r.warnings.map((w) => (
                              <p key={w} className="flex items-start gap-1 text-muted-foreground">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                              </p>
                            ))}
                            {!r.issues.length && !r.duplicate && !r.warnings.length && (
                              <p className="flex items-center gap-1 text-income">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Balanced
                              </p>
                            )}
                          </div>
                        </TD>
                        {results && (
                          <TD className="text-xs">
                            {res ? (
                              <div className="space-y-1">
                                <Badge variant={res.outcome === "imported" ? "success" : res.outcome === "duplicate" ? "warning" : "danger"}>
                                  {res.outcome === "imported" ? `Imported ${res.createdRef ?? ""}` : res.outcome === "duplicate" ? "Skipped (duplicate)" : "Not imported"}
                                </Badge>
                                {res.status && <StatusBadge status={res.status} className="ml-1" />}
                                {res.message && <p className="text-muted-foreground">{res.message}</p>}
                              </div>
                            ) : null}
                          </TD>
                        )}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              {records.length > shown && (
                <div className="border-t p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                    Show more ({records.length - shown} remaining)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Confirm */}
          {!results ? (
            <Card className="border-primary/30">
              <CardContent className="space-y-4 p-5">
                <div className="space-y-3">
                  <Toggle id="imp-dupes" checked={skipDuplicates} onChange={setSkipDuplicates} label="Skip possible duplicates" hint={`${duplicates.length} record${duplicates.length === 1 ? "" : "s"} match existing transactions or repeat within the file.`} />
                  {props.canPost ? (
                    <Toggle
                      id="imp-post"
                      checked={postBalanced}
                      onChange={setPostBalanced}
                      label="Post balanced entries that were posted in the source"
                      hint="Otherwise everything is imported as drafts for review. Amounts above the approval threshold stay as drafts."
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">Transactions are imported as drafts. Posting requires the Post Transactions permission.</p>
                  )}
                </div>
                {unmappedNeeded.length > 0 && (
                  <Alert variant="warning">
                    Map {unmappedNeeded.join(", ")} — records that use unmapped accounts are reported as errors and not imported.
                  </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <Button variant="ghost" onClick={reset} disabled={confirming}>
                    Cancel
                  </Button>
                  <Button onClick={confirm} loading={confirming} disabled={blocked}>
                    {!confirming && <CheckCircle2 />} Import {importable.length} transaction{importable.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Alert variant={results.job.importedCount ? "success" : "danger"} title={`Import ${results.job.status === "COMPLETED" ? "completed" : "failed"}`}>
              {results.job.importedCount} imported · {results.job.duplicateCount} duplicates skipped · {results.job.errorCount} not imported.{" "}
              {results.job.errorCount > 0 && (
                <a className="font-medium underline-offset-4 hover:underline" href={`/api/w/${workspaceId}/import/${results.job.id}/errors`} download>
                  Download error report
                </a>
              )}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={reset}>
                  Import another file
                </Button>
              </div>
            </Alert>
          )}
        </motion.div>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Import history
          </CardTitle>
          <CardDescription>Uploads, previews and completed imports in this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <EmptyState icon={FileWarning} title="No imports yet" description="Uploaded files and their results appear here." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>File</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Records</TH>
                  <TH className="text-right">Imported</TH>
                  <TH className="text-right">Duplicates</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Imported by</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((j) => (
                  <TR key={j.id}>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(j.createdAt)}</TD>
                    <TD className="max-w-[240px] truncate font-medium" title={j.fileName}>
                      {j.fileName}
                    </TD>
                    <TD>
                      <StatusBadge status={j.status} />
                    </TD>
                    <TD className="text-right tabular">{j.totalRecords}</TD>
                    <TD className="text-right tabular">{j.importedCount}</TD>
                    <TD className="text-right tabular">{j.duplicateCount}</TD>
                    <TD className={cn("text-right tabular", j.errorCount > 0 && "text-expense")}>{j.errorCount}</TD>
                    <TD className="whitespace-nowrap">{j.importedByName}</TD>
                    <TD className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openJob(j.id)}>
                          {j.status === "PREVIEW" ? "Resume" : "View"}
                        </Button>
                        {j.errorCount > 0 && (
                          <Button asChild variant="outline" size="sm">
                            <a href={`/api/w/${workspaceId}/import/${j.id}/errors`} download>
                              Errors
                            </a>
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular", tone === "good" && "text-income", tone === "bad" && "text-expense", tone === "warn" && "text-warning")}>{value}</dd>
    </div>
  );
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

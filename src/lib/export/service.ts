/**
 * Export Center service: validate + preview, generate (ExportJob, items, audit
 * events), history and downloads. Server-only and workspace-scoped.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { audit } from "@/lib/audit";
import { ApiError, badRequest, conflict, notFound } from "@/lib/errors";
import { formatDate } from "@/lib/dates";
import { EXPORT_TYPE_LABEL, type CanonicalExport, type ExportType } from "./canonical-schema";
import { buildCanonicalExport, sha256Hex, type AccountUsed, type CanonicalBuild } from "./canonical";
import { auditFileName, buildAuditMetadata } from "./audit-file";
import { POSTED_STATUSES, resolvePeriod, type ExportRequest } from "./filters";
import { loadAdapterState, mappingsByCode, type AdapterState } from "./integrations";
import { adapterSpec, getAdapter } from "./registry";
import { computeAdapterStatus, type AdapterStatus } from "./status";
import { missingConfig, postingDocuments, usedAccountCodes } from "./adapters/shared";
import type { AdapterInput, AdapterSpecDTO, ExportAdapter, GeneratedFile, ValidationIssue } from "./types";

type Ctx = WorkspaceContext & { meta?: { ip?: string | null; userAgent?: string | null } };

const PREVIEW_MAX_CHARS = 12_000;
const PREVIEW_MAX_LINES = 120;
/** Errors that mean "fix the integration settings" (Configuration Required) rather than "fix the data". */
const CONFIG_CODES = new Set(["MISSING_MAPPING", "MISSING_CONFIG", "INVALID_MAPPING", "INVALID_CONFIG"]);
const INVALID_CONFIG_CODES = new Set(["INVALID_MAPPING", "INVALID_CONFIG"]);

export type ExportPreview = {
  adapter: AdapterSpecDTO;
  status: AdapterStatus;
  issues: ValidationIssue[];
  exportType: ExportType;
  range: { from: string; to: string; label: string | null };
  counts: {
    transactions: number;
    journalEntries: number;
    ledgers: number;
    documents: number;
    lines: number;
    excludedAlreadyExported: number;
    reversalOnly: number;
    totalDebit: string;
    totalCredit: string;
    balanced: boolean;
  };
  accountsUsed: { accountId: string; code: string; name: string; type: string; subtype: string | null; externalCode: string; externalName: string; mapped: boolean }[];
  file: { fileName: string; contentType: string; size: number; excerpt: string; truncated: boolean } | null;
  auditFileName: string | null;
  sample: { transactionId: string; date: string; type: string; description: string; amount: string; currency: string; status: string; createdBy: string; lines: number }[];
  notes: string[];
};

function fileBaseName(ctx: WorkspaceContext, adapterKey: string, from: string, to: string, now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const code = ctx.workspace.code.replace(/[^A-Za-z0-9_-]/g, "") || "WS";
  return `${code}_${adapterKey}_${from}_${to}_${stamp}`;
}

function excerpt(content: string) {
  const lines = content.split(/\r?\n/);
  let text = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
  let truncated = lines.length > PREVIEW_MAX_LINES;
  if (text.length > PREVIEW_MAX_CHARS) {
    text = text.slice(0, PREVIEW_MAX_CHARS);
    truncated = true;
  }
  return { excerpt: text, truncated };
}

function dedupeIssues(issues: ValidationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.level}|${i.code}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type Evaluation = {
  adapter: ExportAdapter;
  state: AdapterState;
  build: CanonicalBuild;
  input: AdapterInput;
  issues: ValidationIssue[];
  status: AdapterStatus;
  range: { from: string; to: string; label: string | null };
  relevantAccounts: AccountUsed[];
  unmapped: string[];
};

/** Builds the canonical data, runs adapter validation and derives the status. No persistence. */
async function evaluate(db: Tx, ctx: Ctx, req: ExportRequest, now: Date): Promise<Evaluation> {
  const adapter = getAdapter(req.adapterKey);
  if (!adapter) throw notFound("Unknown integration");
  let range: { from: string; to: string; label: string | null };
  try {
    range = resolvePeriod(req.period, ctx.workspace.fyStartMonth);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : "Invalid date range");
  }

  const pre: ValidationIssue[] = [];
  const unposted = req.statuses.filter((s) => !(POSTED_STATUSES as readonly string[]).includes(s));
  if (unposted.length && !adapter.allowsDrafts) {
    pre.push({ level: "error", code: "UNPOSTED_STATUS", message: `${adapter.name} exports posted entries only — deselect ${unposted.map((s) => s.toLowerCase().replace("_", " ")).join(", ")}.` });
  }
  if (adapter.implemented && !adapter.supportedExportTypes.includes(req.exportType)) {
    pre.push({ level: "error", code: "UNSUPPORTED_EXPORT_TYPE", message: `${adapter.name} does not support ${EXPORT_TYPE_LABEL[req.exportType].toLowerCase()} exports.` });
  }

  const state = await loadAdapterState(db, ctx, adapter);
  const build = await buildCanonicalExport(
    ctx,
    {
      exportType: req.exportType,
      from: range.from,
      to: range.to,
      financialYearLabel: range.label,
      types: req.types,
      statuses: req.statuses,
      createdById: req.createdById ?? null,
      categoryIds: req.categoryIds,
      accountIds: req.accountIds,
      excludeAlreadyExportedTo: req.excludeAlreadyExported ? adapter.key : null,
      includeAuditTrail: req.includeAuditTrail,
    },
    { db, now },
  );

  const input: AdapterInput = {
    canonical: build.data,
    mappings: mappingsByCode(state, build.meta.accountsUsed),
    config: state.config,
    fileBaseName: fileBaseName(ctx, adapter.key, range.from, range.to, now),
  };
  // Skip adapter validation when request-level errors already block the export (avoids one error per transaction).
  const adapterIssues = !adapter.implemented || !pre.some((i) => i.level === "error") ? adapter.validate(input) : [];
  const issues = dedupeIssues([...pre, ...build.issues, ...adapterIssues]);

  // Accounts that the target file references (mapping table + "Configuration Required").
  let relevantAccounts = build.meta.accountsUsed;
  if (adapter.requiresAccountMapping && adapter.implemented && build.data.exportType !== "account_ledger") {
    const codes = usedAccountCodes(postingDocuments(build.data));
    relevantAccounts = build.meta.accountsUsed.filter((a) => codes.has(a.code));
  }
  const unmapped = adapter.requiresAccountMapping && adapter.implemented ? relevantAccounts.filter((a) => !state.mappingsById.get(a.id)?.externalCode.trim()).map((a) => a.code) : [];
  const status = computeAdapterStatus({
    platformEnabled: state.platformEnabled,
    implemented: adapter.implemented,
    missingConfig: adapter.implemented ? missingConfig(adapter, state.config) : [],
    unmappedAccounts: unmapped,
    invalidConfig: issues.filter((i) => i.level === "error" && INVALID_CONFIG_CODES.has(i.code)).map((i) => i.message),
    validationErrors: issues.filter((i) => i.level === "error" && !CONFIG_CODES.has(i.code)).length,
  });
  return { adapter, state, build, input, issues, status, range, relevantAccounts, unmapped };
}

function counts(build: CanonicalBuild, docs: number) {
  const d = build.data;
  return {
    transactions: d.transactions.length,
    journalEntries: d.journalEntries?.length ?? d.totals?.journalEntryCount ?? 0,
    ledgers: d.ledgers?.length ?? 0,
    documents: docs,
    lines: d.exportType === "account_ledger" ? (d.ledgers ?? []).reduce((n, g) => n + g.entries.length, 0) : (d.totals?.lineCount ?? 0),
    excludedAlreadyExported: build.meta.excludedAlreadyExported,
    reversalOnly: build.meta.reversalOnly,
    totalDebit: d.integrity?.totalDebit ?? "0.00",
    totalCredit: d.integrity?.totalCredit ?? "0.00",
    balanced: d.integrity?.balanced ?? true,
  };
}

function sample(c: CanonicalExport) {
  return c.transactions.slice(0, 10).map((t) => ({
    transactionId: t.transactionId,
    date: t.transactionDate,
    type: t.type,
    description: t.description,
    amount: t.amount,
    currency: t.currency,
    status: t.status ?? "posted",
    createdBy: `${t.audit.createdBy.name} (${t.audit.createdBy.userId})`,
    lines: t.journalLines.length,
  }));
}

function notesFor(adapter: ExportAdapter): string[] {
  const notes: string[] = [];
  if (adapter.category === "native" && adapter.implemented) {
    notes.push(`Generated from the documented import format — run a test import in ${adapter.name} before relying on it.`);
  }
  if (!adapter.provenance.fullAuditTransfer && adapter.implemented) {
    notes.push(`${adapter.name} cannot hold the complete audit metadata (${adapter.provenance.description}) The full attribution and audit trail are in the separate audit metadata file.`);
  }
  if (adapter.apiTransfer.status === "not_implemented" && adapter.implemented) notes.push(`API transfer: Not Implemented. ${adapter.apiTransfer.note}`);
  return notes;
}

function runGenerate(adapter: ExportAdapter, input: AdapterInput): { file: GeneratedFile; warnings: string[] } {
  const out = adapter.generate(input);
  if (out.files.length !== 1) throw new Error(`${adapter.name} produced ${out.files.length} files; expected exactly one`);
  return { file: out.files[0], warnings: out.warnings };
}

export async function previewExport(ctx: Ctx, req: ExportRequest): Promise<ExportPreview> {
  const now = new Date();
  const ev = await evaluate(prisma, ctx, req, now);
  const { adapter, build, input, issues, status } = ev;
  let file: ExportPreview["file"] = null;
  const extraIssues: ValidationIssue[] = [];
  if (status.status === "available" && !issues.some((i) => i.level === "error")) {
    const g = runGenerate(adapter, input);
    file = { fileName: g.file.fileName, contentType: g.file.contentType, size: Buffer.byteLength(g.file.content, "utf8"), ...excerpt(g.file.content) };
    for (const w of g.warnings) extraIssues.push({ level: "warning", code: "ADAPTER_NOTE", message: w });
  }
  const docs = adapter.implemented && build.data.exportType !== "account_ledger" ? postingDocuments(build.data).length : 0;
  return {
    adapter: adapterSpec(adapter),
    status,
    issues: [...issues, ...extraIssues],
    exportType: build.data.exportType,
    range: ev.range,
    counts: counts(build, docs),
    accountsUsed: ev.relevantAccounts.map((a) => {
      const m = ev.state.mappingsById.get(a.id);
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, externalCode: m?.externalCode ?? "", externalName: m?.externalName ?? "", mapped: Boolean(m?.externalCode.trim()) };
    }),
    file,
    auditFileName: file ? auditFileName(file.fileName) : null,
    sample: sample(build.data),
    notes: notesFor(adapter),
  };
}

function filtersSummary(req: ExportRequest, ev: Evaluation, creatorName: string | null) {
  const parts = [ev.range.label ?? `${formatDate(ev.range.from)} – ${formatDate(ev.range.to)}`, EXPORT_TYPE_LABEL[req.exportType]];
  if (req.types.length && req.types.length < 4) parts.push(req.types.map((t) => t.toLowerCase()).join(", "));
  parts.push(req.statuses.map((s) => s.toLowerCase().replace("_", " ")).join(", "));
  if (creatorName) parts.push(`by ${creatorName}`);
  if (req.categoryIds.length) parts.push(`${req.categoryIds.length} categor${req.categoryIds.length === 1 ? "y" : "ies"}`);
  if (req.accountIds.length) parts.push(`${req.accountIds.length} account${req.accountIds.length === 1 ? "" : "s"}`);
  if (req.excludeAlreadyExported) parts.push("excluding already exported");
  return parts.join(" · ");
}

export type ExportJobDTO = {
  id: string;
  adapterKey: string;
  adapterName: string;
  format: string;
  exportType: string;
  status: string;
  recordCount: number;
  fileName: string;
  auditFileName: string | null;
  checksum: string;
  warnings: string[];
  filtersSummary: string;
  createdByName: string;
  createdAt: string;
};

function toJobDTO(j: { id: string; adapterKey: string; format: string; status: string; recordCount: number; fileName: string; auditFileName: string | null; checksum: string; warnings: Prisma.JsonValue; filters: Prisma.JsonValue; createdByName: string; createdAt: Date }): ExportJobDTO {
  const filters = (j.filters && typeof j.filters === "object" && !Array.isArray(j.filters) ? j.filters : {}) as Record<string, unknown>;
  const ext = j.fileName.split(".").pop()?.toUpperCase() ?? "";
  return {
    id: j.id,
    adapterKey: j.adapterKey,
    adapterName: getAdapter(j.adapterKey)?.name ?? j.adapterKey,
    format: ext,
    exportType: j.format,
    status: j.status,
    recordCount: j.recordCount,
    fileName: j.fileName,
    auditFileName: j.auditFileName,
    checksum: j.checksum,
    warnings: Array.isArray(j.warnings) ? (j.warnings as unknown[]).map(String) : [],
    filtersSummary: typeof filters.summary === "string" ? filters.summary : "",
    createdByName: j.createdByName,
    createdAt: j.createdAt.toISOString(),
  };
}

/**
 * Generates and records an export. Runs in one transaction behind a per
 * workspace+adapter advisory lock so concurrent exports cannot both include
 * the same transactions when duplicate prevention is on.
 */
export async function generateExport(ctx: Ctx, req: ExportRequest): Promise<ExportJobDTO> {
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`vledger-export:${ctx.workspace.id}:${req.adapterKey}`}))::text AS locked`;
      const ev = await evaluate(tx, ctx, req, now);
      const { adapter, build, input, issues, status } = ev;
      if (status.status !== "available" || issues.some((i) => i.level === "error")) {
        const errors = issues.filter((i) => i.level === "error");
        throw new ApiError(422, status.status !== "available" ? `${adapter.name}: ${status.label}. ${status.reasons.join(" ")}`.trim() : (errors[0]?.message ?? "Validation failed"), "EXPORT_BLOCKED", { status, issues: errors.slice(0, 50) });
      }

      const g = runGenerate(adapter, input);
      const checksum = sha256Hex(g.file.content);
      const jobId = randomUUID();
      const auditName = auditFileName(g.file.fileName);
      const auditContent = JSON.stringify(buildAuditMetadata(build.data, { exportJobId: jobId, adapter, dataFileName: g.file.fileName, dataFileSha256: checksum }), null, 2) + "\n";

      const c = build.data;
      const recordCount =
        c.exportType === "journal_entries" ? (c.journalEntries?.length ?? 0) : c.exportType === "account_ledger" ? (c.ledgers ?? []).reduce((n, l) => n + l.entries.length, 0) : c.transactions.length;
      const warnings = [...issues.filter((i) => i.level === "warning").map((i) => i.message), ...g.warnings];
      const summary = filtersSummary(req, ev, c.filters?.createdBy?.name ?? null);

      const job = await tx.exportJob.create({
        data: {
          id: jobId,
          workspaceId: ctx.workspace.id,
          adapterKey: adapter.key,
          format: c.exportType,
          filters: {
            ...req,
            from: ev.range.from,
            to: ev.range.to,
            financialYear: ev.range.label,
            summary,
            excludedAlreadyExported: build.meta.excludedAlreadyExported,
            reversalOnly: build.meta.reversalOnly,
            integrityChecksum: c.integrity?.checksum ?? null,
          } as Prisma.InputJsonValue,
          status: "COMPLETED",
          recordCount,
          fileName: g.file.fileName,
          contentType: g.file.contentType,
          content: g.file.content,
          auditFileName: auditName,
          auditContent,
          checksum,
          warnings: warnings as Prisma.InputJsonValue,
          createdById: ctx.actor.id,
          createdByName: ctx.actor.name,
        },
      });

      const ids = build.meta.exportTransactionIds;
      for (let i = 0; i < ids.length; i += 1000) {
        const part = ids.slice(i, i + 1000);
        await tx.exportJobItem.createMany({ data: part.map((transactionId) => ({ exportJobId: job.id, transactionId, workspaceId: ctx.workspace.id, adapterKey: adapter.key })) });
        await tx.auditEvent.createMany({
          data: part.map((transactionId) => ({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor.id,
            actorName: ctx.actor.name,
            actorEmail: ctx.actor.email,
            entityType: "TRANSACTION",
            entityId: transactionId,
            transactionId,
            action: "EXPORTED",
            after: { exportJobId: job.id, adapterKey: adapter.key, fileName: g.file.fileName, exportType: c.exportType } as Prisma.InputJsonValue,
            ip: ctx.meta?.ip ?? null,
            userAgent: ctx.meta?.userAgent?.slice(0, 400) ?? null,
          })),
        });
      }
      await audit(tx, {
        workspaceId: ctx.workspace.id,
        actor: ctx.actor,
        entityType: "EXPORT_JOB",
        entityId: job.id,
        action: "EXPORT_CREATED",
        after: {
          exportJobId: job.id,
          adapterKey: adapter.key,
          exportType: c.exportType,
          fileName: g.file.fileName,
          auditFileName: auditName,
          checksum,
          recordCount,
          transactionCount: ids.length,
          filters: summary,
        },
        ip: ctx.meta?.ip,
        userAgent: ctx.meta?.userAgent,
      });
      return toJobDTO(job);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}

export async function listExportJobs(ctx: WorkspaceContext, take = 50): Promise<ExportJobDTO[]> {
  const jobs = await prisma.exportJob.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, adapterKey: true, format: true, status: true, recordCount: true, fileName: true, auditFileName: true, checksum: true, warnings: true, filters: true, createdByName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
  });
  return jobs.map(toJobDTO);
}

/** Returns a stored export file (data or audit metadata) and records the download. */
export async function downloadExportFile(ctx: Ctx, jobId: string, which: "data" | "audit") {
  const job = await prisma.exportJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspace.id } });
  if (!job) throw notFound("Export not found");
  if (which === "audit" && (!job.auditContent || !job.auditFileName)) throw conflict("This export has no audit metadata file");
  await audit(prisma, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    entityType: "EXPORT_JOB",
    entityId: job.id,
    action: "EXPORT_DOWNLOADED",
    after: { exportJobId: job.id, file: which, fileName: which === "audit" ? job.auditFileName : job.fileName },
    ip: ctx.meta?.ip,
    userAgent: ctx.meta?.userAgent,
  });
  return which === "audit"
    ? { fileName: job.auditFileName!, contentType: "application/json", content: job.auditContent! }
    : { fileName: job.fileName, contentType: job.contentType, content: job.content };
}

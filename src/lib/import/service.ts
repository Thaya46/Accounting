/**
 * JSON import: preview (schema, workspace, mapping, duplicate checks) and
 * confirmation. Transactions are created through the transaction service as
 * the authenticated importer; identities in the file are stored only as
 * external provenance and are never treated as internal users.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { audit } from "@/lib/audit";
import { ApiError, conflict, forbidden, notFound } from "@/lib/errors";
import { workspaceRef, txnRef } from "@/lib/ids";
import { createTransaction, duplicateHash, needsApproval, PAYMENT_SUBTYPES, transactionInputSchema } from "@/lib/accounting/transactions";
import { csvField } from "@/lib/export/formats";
import {
  accountCodesOf,
  categoriesOf,
  categoryKey,
  fileIssues,
  parseImportFile,
  planRecords,
  workspaceMatches,
  type ConfirmImportInput,
  type FileIssue,
  type ImportRecord,
} from "./analyze";

type Ctx = WorkspaceContext & { meta?: { ip?: string; userAgent?: string } };

export type ImportPreview = {
  version: 1;
  fileName: string;
  schemaVersion: string;
  exportType: string;
  generatedAt: string | null;
  generatedBy: { userId: string; name: string } | null;
  fileWorkspace: { workspaceId: string; workspaceName: string; workspaceCode: string | null; currency: string };
  workspaceMatch: boolean;
  fileIssues: FileIssue[];
  records: ImportRecord[];
  accountCodes: { code: string; name: string | null; lines: number; suggestedAccountId: string | null; note: string | null }[];
  categories: { key: string; kind: "INCOME" | "EXPENSE"; name: string; records: number; suggestedCategoryId: string | null }[];
  results?: { index: number; transactionId: string; outcome: "imported" | "duplicate" | "error" | "skipped"; message?: string; createdRef?: string; status?: string }[];
};

export type ImportJobDTO = {
  id: string;
  fileName: string;
  status: string;
  totalRecords: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  importedByName: string;
  createdAt: string;
  completedAt: string | null;
};

type ImportErrorRow = { index?: number; transactionId?: string; path?: string; message: string };

function toDTO(j: { id: string; fileName: string; status: string; totalRecords: number; importedCount: number; duplicateCount: number; errorCount: number; importedByName: string; createdAt: Date; completedAt: Date | null }): ImportJobDTO {
  return {
    id: j.id,
    fileName: j.fileName,
    status: j.status,
    totalRecords: j.totalRecords,
    importedCount: j.importedCount,
    duplicateCount: j.duplicateCount,
    errorCount: j.errorCount,
    importedByName: j.importedByName,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}

const sanitizeFileName = (name: string) => name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").slice(0, 200) || "import.json";

/** Validates the uploaded file, plans every record, persists a PREVIEW job and returns it. */
export async function previewImport(ctx: Ctx, input: { fileName: string; content: string }) {
  const ws = ctx.workspace;
  const fileName = sanitizeFileName(input.fileName);
  const parsed = parseImportFile(input.content);

  if (!parsed.ok) {
    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.importJob.create({
        data: {
          workspaceId: ws.id,
          fileName,
          status: "FAILED",
          importedById: ctx.actor.id,
          importedByName: ctx.actor.name,
          errorCount: parsed.errors.length,
          errors: parsed.errors as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await audit(tx, {
        workspaceId: ws.id,
        actor: ctx.actor,
        entityType: "IMPORT_JOB",
        entityId: j.id,
        action: "IMPORT_REJECTED",
        reason: "Schema validation failed",
        after: { fileName, errors: parsed.errors.slice(0, 20) },
        ip: ctx.meta?.ip,
        userAgent: ctx.meta?.userAgent,
      });
      return j;
    });
    return { job: toDTO(job), schemaErrors: parsed.errors, preview: null };
  }

  const data = parsed.data;
  const wsInfo = { ref: workspaceRef(ws.seq), code: ws.code, currency: ws.defaultCurrency };
  const issues = fileIssues(data, wsInfo);
  const records = planRecords(data, { currency: ws.defaultCurrency }, duplicateHash);

  // Duplicates against this workspace: same external reference, the workspace's own
  // transaction reference (file exported from this workspace), or same type/amount/date/description.
  const sameWorkspace = workspaceMatches(data.workspace, wsInfo);
  const refs = [...new Set(records.map((r) => r.transactionId))];
  const hashes = [...new Set(records.map((r) => r.hash))];
  const ownNumbers = sameWorkspace ? [...new Set(records.map((r) => /^TXN-(\d{1,9})$/.exec(r.transactionId)?.[1]).filter(Boolean).map(Number))] : [];
  const [byRef, byHash, byNumber, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({ where: { workspaceId: ws.id, externalRef: { in: refs } }, select: { number: true, externalRef: true } }),
    prisma.transaction.findMany({ where: { workspaceId: ws.id, duplicateHash: { in: hashes }, status: { notIn: ["REVERSED", "REJECTED"] } }, select: { number: true, duplicateHash: true } }),
    ownNumbers.length ? prisma.transaction.findMany({ where: { workspaceId: ws.id, number: { in: ownNumbers } }, select: { number: true, status: true } }) : Promise.resolve([]),
    prisma.account.findMany({ where: { workspaceId: ws.id }, select: { id: true, code: true, name: true, isActive: true } }),
    prisma.accountCategory.findMany({ where: { workspaceId: ws.id, isActive: true }, select: { id: true, name: true, kind: true } }),
  ]);
  const refHit = new Map(byRef.map((t) => [t.externalRef!, t.number]));
  const hashHit = new Map(byHash.map((t) => [t.duplicateHash!, t.number]));
  const ownHit = new Map(byNumber.map((t) => [txnRef(t.number), t.status]));
  for (const r of records) {
    if (r.duplicate) continue;
    const n = refHit.get(r.transactionId);
    const own = ownHit.get(r.transactionId);
    if (n !== undefined) r.duplicate = { reason: `Already imported as ${txnRef(n)}.`, existingRef: txnRef(n) };
    else if (own) r.duplicate = { reason: `Exported from this workspace — ${r.transactionId} already exists here (${own.toLowerCase().replace("_", " ")}).`, existingRef: r.transactionId };
    else {
      const h = hashHit.get(r.hash);
      if (h !== undefined) r.duplicate = { reason: `Matches ${txnRef(h)} (same type, amount, date and description).`, existingRef: txnRef(h) };
    }
  }

  const accountByCode = new Map(accounts.map((a) => [a.code.toUpperCase(), a]));
  const accountCodes = accountCodesOf(records).map((c) => {
    const a = accountByCode.get(c.code.toUpperCase());
    return { ...c, suggestedAccountId: a?.isActive ? a.id : null, note: a && !a.isActive ? `${a.code} exists but is inactive` : null };
  });
  const categoryList = categoriesOf(records).map((c) => ({
    ...c,
    suggestedCategoryId: categories.find((x) => x.kind === c.kind && x.name.toLowerCase() === c.name.toLowerCase())?.id ?? null,
  }));

  const preview: ImportPreview = {
    version: 1,
    fileName,
    schemaVersion: data.schemaVersion,
    exportType: data.exportType,
    generatedAt: data.generatedAt ?? null,
    generatedBy: data.generatedBy ?? null,
    fileWorkspace: { workspaceId: data.workspace.workspaceId, workspaceName: data.workspace.workspaceName, workspaceCode: data.workspace.workspaceCode ?? null, currency: data.workspace.currency },
    workspaceMatch: workspaceMatches(data.workspace, wsInfo),
    fileIssues: issues,
    records,
    accountCodes,
    categories: categoryList,
  };
  const recordErrors = records.filter((r) => r.issues.length).length;
  const fileErrors = issues.filter((i) => i.level === "error");
  const errors: ImportErrorRow[] = [
    ...fileErrors.map((i) => ({ message: i.message })),
    ...records.filter((r) => r.issues.length).map((r) => ({ index: r.index + 1, transactionId: r.transactionId, message: r.issues.join(" ") })),
  ];
  const job = await prisma.importJob.create({
    data: {
      workspaceId: ws.id,
      fileName,
      status: "PREVIEW",
      importedById: ctx.actor.id,
      importedByName: ctx.actor.name,
      totalRecords: records.length,
      duplicateCount: records.filter((r) => r.duplicate).length,
      errorCount: recordErrors + fileErrors.length,
      errors: errors as Prisma.InputJsonValue,
      preview: preview as unknown as Prisma.InputJsonValue,
    },
  });
  return { job: toDTO(job), schemaErrors: [], preview };
}

export async function listImportJobs(ctx: WorkspaceContext, take = 50): Promise<ImportJobDTO[]> {
  const jobs = await prisma.importJob.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, fileName: true, status: true, totalRecords: true, importedCount: true, duplicateCount: true, errorCount: true, importedByName: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
  });
  return jobs.map(toDTO);
}

export async function getImportJob(ctx: WorkspaceContext, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspace.id } });
  if (!job) throw notFound("Import not found");
  return {
    job: toDTO(job),
    preview: (job.preview as unknown as ImportPreview | null) ?? null,
    errors: (Array.isArray(job.errors) ? job.errors : []) as ImportErrorRow[],
    canConfirm: job.status === "PREVIEW" && !job.completedAt && job.importedById === ctx.actor.id,
  };
}

/** CSV error report for an import job. */
export async function importErrorReport(ctx: WorkspaceContext, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspace.id }, select: { fileName: true, errors: true } });
  if (!job) throw notFound("Import not found");
  const rows = (Array.isArray(job.errors) ? job.errors : []) as ImportErrorRow[];
  const lines = [["Record", "Transaction ID", "Field", "Message"], ...rows.map((r) => [r.index ? String(r.index) : "", r.transactionId ?? "", r.path ?? "", r.message])];
  return {
    fileName: `${job.fileName.replace(/\.json$/i, "")}.errors.csv`,
    content: lines.map((l) => l.map((c) => csvField(c)).join(",")).join("\r\n") + "\r\n",
  };
}

/**
 * Imports the previewed records. Each record is created in its own database
 * transaction so one failure does not abort the rest; failures are collected.
 */
export async function confirmImport(ctx: Ctx, jobId: string, input: ConfirmImportInput) {
  const ws = ctx.workspace;
  const job = await prisma.importJob.findFirst({ where: { id: jobId, workspaceId: ws.id } });
  if (!job) throw notFound("Import not found");
  if (job.status !== "PREVIEW" || job.completedAt) throw conflict("This import has already been processed.");
  if (job.importedById !== ctx.actor.id) throw forbidden("Only the user who uploaded this file can confirm the import.");
  const preview = job.preview as unknown as ImportPreview | null;
  if (!preview || preview.version !== 1) throw conflict("The preview for this import is missing. Upload the file again.");
  if (preview.fileIssues.some((i) => i.level === "error")) {
    throw new ApiError(422, preview.fileIssues.find((i) => i.level === "error")!.message, "IMPORT_BLOCKED");
  }
  if (!preview.workspaceMatch && !input.acknowledgeWorkspaceMismatch) {
    throw new ApiError(422, "This file comes from another workspace. Confirm that you want to import it here.", "WORKSPACE_MISMATCH");
  }
  if (input.postBalanced && !ctx.permissions.has("TRANSACTION_POST")) throw forbidden("Missing permission: TRANSACTION_POST");

  // Resolve mappings strictly within this workspace.
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { workspaceId: ws.id }, select: { id: true, code: true, isActive: true, subtype: true } }),
    prisma.accountCategory.findMany({ where: { workspaceId: ws.id, isActive: true }, select: { id: true, name: true, kind: true } }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const [code, id] of Object.entries(input.accountMap)) {
    if (!id) continue;
    const a = accountById.get(id);
    if (!a) throw new ApiError(422, `Account mapping for ${code} points to an account outside this workspace.`, "VALIDATION_ERROR");
    if (!a.isActive) throw new ApiError(422, `Account mapping for ${code} points to an inactive account (${a.code}).`, "VALIDATION_ERROR");
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  for (const [key, id] of Object.entries(input.categoryMap)) {
    if (!id) continue;
    const c = categoryById.get(id);
    if (!c) throw new ApiError(422, `Category mapping for “${key.split(":").slice(1).join(":")}” is not an active category in this workspace.`, "VALIDATION_ERROR");
    if (!key.startsWith(`${c.kind}:`)) throw new ApiError(422, `“${c.name}” is ${c.kind === "INCOME" ? "an income" : "an expense"} category and cannot be used for ${key.split(":")[0].toLowerCase()} records.`, "VALIDATION_ERROR");
  }

  // Claim the job atomically so a double submit cannot import twice.
  const claimed = await prisma.importJob.updateMany({ where: { id: job.id, workspaceId: ws.id, status: "PREVIEW", completedAt: null }, data: { completedAt: new Date() } });
  if (claimed.count !== 1) throw conflict("This import is already being processed.");

  // Re-check external references in case another import ran since the preview.
  const nowImported = await prisma.transaction.findMany({
    where: { workspaceId: ws.id, externalRef: { in: preview.records.map((r) => r.transactionId) } },
    select: { externalRef: true, number: true },
  });
  const importedRef = new Map(nowImported.map((t) => [t.externalRef!, t.number]));

  const results: NonNullable<ImportPreview["results"]> = [];
  const errors: ImportErrorRow[] = [];
  let imported = 0;
  let duplicates = 0;
  const isPayment = (accountId: string) => (PAYMENT_SUBTYPES as readonly string[]).includes(accountById.get(accountId)?.subtype ?? "");

  try {
    for (const r of preview.records) {
      const base = { index: r.index, transactionId: r.transactionId };
      if (r.issues.length) {
        results.push({ ...base, outcome: "error", message: r.issues.join(" ") });
        errors.push({ index: r.index + 1, transactionId: r.transactionId, message: r.issues.join(" ") });
        continue;
      }
      const existing = importedRef.get(r.transactionId);
      const dup = existing !== undefined ? { reason: `Already imported as ${txnRef(existing)}.` } : r.duplicate;
      if (dup && input.skipDuplicates) {
        duplicates++;
        results.push({ ...base, outcome: "duplicate", message: dup.reason });
        continue;
      }

      const unmapped = r.lines.filter((l) => !input.accountMap[l.accountCode]).map((l) => l.accountCode);
      if (unmapped.length) {
        const message = `Map account${unmapped.length > 1 ? "s" : ""} ${[...new Set(unmapped)].join(", ")} to import this record.`;
        results.push({ ...base, outcome: "error", message });
        errors.push({ index: r.index + 1, transactionId: r.transactionId, message });
        continue;
      }

      let type = r.importType;
      const lineAccounts = r.lines.map((l) => input.accountMap[l.accountCode]);
      const warnings: string[] = [];
      if (type === "TRANSFER" && !lineAccounts.every(isPayment)) {
        type = "JOURNAL";
        warnings.push("Imported as a journal because the mapped accounts are not bank, cash, wallet, card, receivable or payable accounts.");
      }
      if (type !== "JOURNAL" && lineAccounts[0] === lineAccounts[1]) {
        type = "JOURNAL";
      }
      const categoryId = (type === "INCOME" || type === "EXPENSE") && r.category ? (input.categoryMap[categoryKey(type, r.category)] ?? null) : null;
      const debitLine = r.lines.find((l) => Number(l.debit) > 0)!;
      const creditLine = r.lines.find((l) => Number(l.credit) > 0)!;

      const raw = {
        type,
        date: r.date,
        description: r.description,
        ...(type === "JOURNAL"
          ? {
              currency: ws.defaultCurrency,
              lines: r.lines.map((l) => ({ accountId: input.accountMap[l.accountCode], debit: l.debit, credit: l.credit, description: l.description?.slice(0, 300) ?? null })),
              isAdjustment: r.isAdjustment,
            }
          : {
              amount: r.amount,
              currency: r.currency,
              ...(r.exchangeRate ? { exchangeRate: r.exchangeRate } : {}),
              debitAccountId: input.accountMap[debitLine.accountCode],
              creditAccountId: input.accountMap[creditLine.accountCode],
              categoryId,
            }),
        paymentMethod: r.paymentMethod,
        reference: r.reference,
        notes: r.notes,
        customerName: r.counterparty?.type === "customer" ? r.counterparty.name : null,
        vendorName: r.counterparty?.type === "vendor" ? r.counterparty.name : null,
      };
      const parsedInput = transactionInputSchema.safeParse(raw);
      if (!parsedInput.success) {
        const message = parsedInput.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ");
        results.push({ ...base, outcome: "error", message });
        errors.push({ index: r.index + 1, transactionId: r.transactionId, message });
        continue;
      }

      const wantsPost = input.postBalanced && r.balanced && r.fileStatus === "posted";
      let intent: "draft" | "post" = wantsPost ? "post" : "draft";
      if (wantsPost && needsApproval(ctx, parsedInput.data.amount ?? r.amount)) {
        intent = "draft";
        warnings.push("Left as a draft: this amount needs approval before posting.");
      }

      try {
        const created = await prisma.$transaction(
          async (tx) => {
            const t = await createTransaction(ctx, parsedInput.data, {
              source: "IMPORT",
              intent,
              db: tx,
              extra: {
                importJobId: job.id,
                externalRef: r.transactionId.slice(0, 120),
                externalCreatorId: r.externalCreator.userId.slice(0, 120),
                externalCreatorName: r.externalCreator.name.slice(0, 200),
              },
            });
            await audit(tx, {
              workspaceId: ws.id,
              actor: ctx.actor,
              entityType: "TRANSACTION",
              entityId: t.id,
              transactionId: t.id,
              action: "IMPORTED",
              after: {
                importJobId: job.id,
                fileName: job.fileName,
                externalRef: r.transactionId,
                externalCreator: { ...r.externalCreator, verified: false },
                externalCreatedAt: r.externalCreatedAt,
                externalSource: r.externalSource,
                sourceWorkspace: preview.fileWorkspace,
                importedAs: { type, intent, status: t.status },
              },
              ip: ctx.meta?.ip,
              userAgent: ctx.meta?.userAgent,
            });
            return t;
          },
          { maxWait: 10_000, timeout: 30_000 },
        );
        imported++;
        results.push({ ...base, outcome: "imported", createdRef: txnRef(created.number), status: created.status, ...(warnings.length ? { message: warnings.join(" ") } : {}) });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : e instanceof Error && /balanced|immutable/i.test(e.message) ? e.message : "Could not be created.";
        if (!(e instanceof ApiError)) console.error("[import] record failed", r.transactionId, e);
        results.push({ ...base, outcome: "error", message });
        errors.push({ index: r.index + 1, transactionId: r.transactionId, message });
      }
    }
  } catch (e) {
    // Unexpected failure outside a record: close the job so it is not left half-claimed.
    console.error("[import] aborted", job.id, e);
    errors.push({ message: "The import stopped unexpectedly. Records listed as imported were saved; re-upload the file to import the rest (duplicates are detected)." });
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", importedCount: imported, duplicateCount: duplicates, errorCount: errors.length, errors: errors as Prisma.InputJsonValue, preview: { ...preview, results } as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });
    throw e;
  }

  const status = imported === 0 && errors.length > 0 ? "FAILED" : "COMPLETED";
  const finished = await prisma.$transaction(async (tx) => {
    const j = await tx.importJob.update({
      where: { id: job.id },
      data: {
        status,
        importedCount: imported,
        duplicateCount: duplicates,
        errorCount: errors.length,
        errors: errors as Prisma.InputJsonValue,
        preview: { ...preview, results } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    await audit(tx, {
      workspaceId: ws.id,
      actor: ctx.actor,
      entityType: "IMPORT_JOB",
      entityId: job.id,
      action: "IMPORT_COMPLETED",
      after: {
        fileName: job.fileName,
        status,
        totalRecords: preview.records.length,
        imported,
        duplicatesSkipped: duplicates,
        errors: errors.length,
        postBalanced: input.postBalanced,
        workspaceMismatchAcknowledged: !preview.workspaceMatch && input.acknowledgeWorkspaceMismatch,
        sourceWorkspace: preview.fileWorkspace,
      },
      ip: ctx.meta?.ip,
      userAgent: ctx.meta?.userAgent,
    });
    return j;
  });
  return { job: toDTO(finished), results };
}

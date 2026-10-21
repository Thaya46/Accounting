/**
 * Builds the separately downloadable audit metadata file that accompanies
 * every export. It carries full attribution for every transaction regardless
 * of what the target format can hold. Pure.
 */
import type { CanonicalExport } from "./canonical-schema";
import type { AdapterSpec } from "./types";

export type AuditFileJob = {
  exportJobId: string;
  adapter: Pick<AdapterSpec, "key" | "name" | "provenance">;
  dataFileName: string;
  dataFileSha256: string;
};

export function auditFileName(dataFileName: string): string {
  return `${dataFileName.replace(/\.[a-z0-9]+$/i, "")}.audit.json`;
}

export function buildAuditMetadata(c: CanonicalExport, job: AuditFileJob) {
  const full = job.adapter.provenance.fullAuditTransfer;
  return {
    schemaVersion: "1.0",
    kind: "vledger_audit_metadata",
    description: full
      ? `Audit metadata for ${job.dataFileName}. The export file itself also carries full attribution.`
      : `Full user attribution and audit trail for ${job.dataFileName}. ${job.adapter.name} cannot store all of this information — keep this file with the export.`,
    export: {
      exportJobId: job.exportJobId,
      adapterKey: job.adapter.key,
      adapterName: job.adapter.name,
      exportType: c.exportType,
      dataFileName: job.dataFileName,
      dataFileSha256: job.dataFileSha256,
      generatedAt: c.generatedAt ?? null,
      generatedBy: c.generatedBy ?? null,
    },
    provenanceTransfer: {
      mode: job.adapter.provenance.createdByTransfer,
      description: job.adapter.provenance.description,
      fullAuditTransfer: full,
    },
    workspace: c.workspace,
    filters: c.filters ?? null,
    transactions: c.transactions.map((t) => ({
      transactionId: t.transactionId,
      journalEntryId: t.journalEntryId ?? null,
      transactionDate: t.transactionDate,
      type: t.type,
      status: t.status ?? null,
      description: t.description,
      amount: t.amount,
      currency: t.currency,
      baseAmount: t.baseAmount ?? null,
      exportScope: t.exportScope ?? "full",
      audit: t.audit,
      reversal: t.reversal
        ? { journalEntryId: t.reversal.journalEntryId, date: t.reversal.date, reason: t.reversal.reason ?? null, reversedBy: t.reversal.reversedBy ?? null, reversedAt: t.reversal.reversedAt ?? null }
        : null,
    })),
    ...(c.journalEntries
      ? {
          journalEntries: c.journalEntries.map((e) => ({
            journalEntryId: e.journalEntryId,
            entryType: e.entryType,
            entryDate: e.entryDate,
            transactionId: e.transactionId ?? null,
            reversesJournalEntryId: e.reversesJournalEntryId ?? null,
            createdBy: e.createdBy,
            postedBy: e.postedBy,
            postedAt: e.postedAt,
          })),
        }
      : {}),
    integrity: c.integrity ?? null,
  };
}

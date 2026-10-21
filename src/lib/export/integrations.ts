/**
 * Workspace integration state: platform availability, per-workspace adapter
 * configuration (workspace_settings.integrationConfig[adapterKey]) and account
 * mappings. Server-only; every query is scoped to the caller's workspace.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { audit } from "@/lib/audit";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/errors";
import { ADAPTER_CATALOG, type AdapterKey } from "./adapter-keys";
import { adapterSpec, getAdapter, listAdapters } from "./registry";
import { computeAdapterStatus, type AdapterStatus } from "./status";
import { missingConfig, resolveConfig } from "./adapters/shared";
import { CUSTOM_FIELDS, validateCustomColumns } from "./adapters/custom";
import type { AccountMapping, AdapterConfig, AdapterSpecDTO, CustomColumn, ExportAdapter } from "./types";

type Meta = { ip?: string | null; userAgent?: string | null };

export type AdapterState = {
  platformEnabled: boolean;
  config: AdapterConfig;
  /** accountId → mapping */
  mappingsById: Map<string, AccountMapping>;
};

function configBag(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export async function platformEnabledMap(db: Tx = prisma): Promise<Map<string, boolean>> {
  const rows = await db.integrationAdapter.findMany({ select: { key: true, enabled: true } });
  // Adapters missing from the table (not yet seeded) default to enabled, like the column default.
  return new Map(ADAPTER_CATALOG.map((a) => [a.key, rows.find((r) => r.key === a.key)?.enabled ?? true]));
}

export async function loadAdapterState(db: Tx, ctx: WorkspaceContext, adapter: ExportAdapter): Promise<AdapterState> {
  const [row, settings, mappings] = await Promise.all([
    db.integrationAdapter.findUnique({ where: { key: adapter.key }, select: { enabled: true } }),
    db.workspaceSettings.findUnique({ where: { workspaceId: ctx.workspace.id }, select: { integrationConfig: true } }),
    db.integrationAccountMapping.findMany({ where: { workspaceId: ctx.workspace.id, adapterKey: adapter.key }, select: { accountId: true, externalCode: true, externalName: true } }),
  ]);
  return {
    platformEnabled: row?.enabled ?? true,
    config: resolveConfig(adapter, configBag(settings?.integrationConfig)[adapter.key]),
    mappingsById: new Map(mappings.map((m) => [m.accountId, { externalCode: m.externalCode, externalName: m.externalName }])),
  };
}

/** Converts accountId-keyed mappings to the accountCode-keyed form adapters consume. */
export function mappingsByCode(state: AdapterState, accounts: { id: string; code: string }[]): Record<string, AccountMapping> {
  const out: Record<string, AccountMapping> = {};
  for (const a of accounts) {
    const m = state.mappingsById.get(a.id);
    if (m) out[a.code] = m;
  }
  return out;
}

export type AdapterSummary = { spec: AdapterSpecDTO; status: AdapterStatus; platformEnabled: boolean; mappedAccounts: number; accountsInUse: number };

/**
 * Status of every adapter for the workspace, without a data selection: mapping
 * completeness is checked against the accounts that carry posted journal lines.
 */
export async function listAdapterSummaries(ctx: WorkspaceContext): Promise<AdapterSummary[]> {
  const wsId = ctx.workspace.id;
  const [enabled, settings, mappings, used, accounts] = await Promise.all([
    platformEnabledMap(),
    prisma.workspaceSettings.findUnique({ where: { workspaceId: wsId }, select: { integrationConfig: true } }),
    prisma.integrationAccountMapping.findMany({ where: { workspaceId: wsId }, select: { adapterKey: true, accountId: true, externalCode: true } }),
    prisma.journalLine.groupBy({ by: ["accountId"], where: { workspaceId: wsId } }),
    prisma.account.findMany({ where: { workspaceId: wsId }, select: { id: true, code: true } }),
  ]);
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  const usedIds = used.map((u) => u.accountId);
  const bag = configBag(settings?.integrationConfig);
  return listAdapters().map((adapter) => {
    const mapped = new Set(mappings.filter((m) => m.adapterKey === adapter.key && m.externalCode.trim()).map((m) => m.accountId));
    const config = resolveConfig(adapter, bag[adapter.key]);
    const unmapped = adapter.requiresAccountMapping && adapter.implemented ? usedIds.filter((id) => !mapped.has(id)).map((id) => codeById.get(id) ?? id).sort() : [];
    const platformEnabled = enabled.get(adapter.key) ?? true;
    return {
      spec: adapterSpec(adapter),
      platformEnabled,
      mappedAccounts: mapped.size,
      accountsInUse: usedIds.length,
      status: computeAdapterStatus({ platformEnabled, implemented: adapter.implemented, missingConfig: adapter.implemented ? missingConfig(adapter, config) : [], unmappedAccounts: unmapped }),
    };
  });
}

/** Configuration + full mapping table for one adapter (Integrations page / Export Center mapping editor). */
export async function getIntegrationDetail(ctx: WorkspaceContext, key: string) {
  const adapter = getAdapter(key);
  if (!adapter) throw notFound("Unknown integration");
  const [state, accounts, summaries] = await Promise.all([
    loadAdapterState(prisma, ctx, adapter),
    prisma.account.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { id: true, code: true, name: true, type: true, subtype: true, isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    listAdapterSummaries(ctx),
  ]);
  return {
    adapter: adapterSpec(adapter),
    status: summaries.find((s) => s.spec.key === adapter.key)!.status,
    platformEnabled: state.platformEnabled,
    config: state.config,
    customFields: adapter.key === "custom" ? CUSTOM_FIELDS.map((f) => ({ field: f.field, label: f.label })) : [],
    mappings: accounts.map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      isActive: a.isActive,
      externalCode: state.mappingsById.get(a.id)?.externalCode ?? "",
      externalName: state.mappingsById.get(a.id)?.externalName ?? "",
    })),
  };
}

export const integrationUpdateSchema = z
  .object({
    config: z.record(z.unknown()).optional(),
    mappings: z
      .array(
        z.object({
          accountId: z.string().min(1).max(64),
          externalCode: z.string().max(200).default(""),
          externalName: z.string().max(200).nullish(),
        }),
      )
      .max(2000)
      .optional(),
  })
  .refine((v) => v.config !== undefined || v.mappings !== undefined, "Nothing to update");

/** Validates submitted configuration against the adapter's fields. Returns the stored form. */
export function validateConfigInput(adapter: ExportAdapter, input: Record<string, unknown>): AdapterConfig {
  const errors: string[] = [];
  const out: AdapterConfig = {};
  const known = new Set(adapter.configFields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!known.has(k)) errors.push(`Unknown setting “${k}”.`);
  for (const f of adapter.configFields) {
    const v = input[f.key];
    if (v === undefined || v === null || v === "") {
      if (f.type === "columns") out[f.key] = [];
      continue;
    }
    if (f.type === "boolean") {
      if (typeof v !== "boolean") errors.push(`${f.label} must be on or off.`);
      else out[f.key] = v;
    } else if (f.type === "select") {
      if (typeof v !== "string" || !(f.options ?? []).some((o) => o.value === v)) errors.push(`Choose a valid ${f.label.toLowerCase()}.`);
      else out[f.key] = v;
    } else if (f.type === "columns") {
      const parsed = z.array(z.object({ field: z.string().max(64), header: z.string().max(80) })).max(60).safeParse(v);
      if (!parsed.success) errors.push(`${f.label}: invalid layout.`);
      else {
        const cols: CustomColumn[] = parsed.data.map((c) => ({ field: c.field, header: c.header.trim() }));
        const e = cols.length ? validateCustomColumns(cols) : [];
        errors.push(...e);
        out[f.key] = cols;
      }
    } else {
      if (typeof v !== "string") errors.push(`${f.label} must be text.`);
      else if (f.maxLength && v.trim().length > f.maxLength) errors.push(`${f.label} must be at most ${f.maxLength} characters.`);
      else if (/[\u0000-\u001f]/.test(v)) errors.push(`${f.label} contains control characters.`);
      else out[f.key] = v.trim();
    }
  }
  if (errors.length) throw new ApiError(422, errors[0], "VALIDATION_ERROR", { errors });
  return out;
}

export async function updateIntegration(ctx: WorkspaceContext & { meta?: Meta }, key: string, body: z.infer<typeof integrationUpdateSchema>) {
  const adapter = getAdapter(key);
  if (!adapter) throw notFound("Unknown integration");
  if (!adapter.implemented) throw badRequest(`${adapter.name} is not implemented — there is nothing to configure yet.`);
  if (body.config !== undefined && !ctx.permissions.has("SETTINGS_MANAGE")) throw forbidden("Missing permission: SETTINGS_MANAGE");
  if (body.mappings !== undefined && !ctx.permissions.has("SETTINGS_MANAGE") && !ctx.permissions.has("DATA_EXPORT")) {
    throw forbidden("Missing permission: DATA_EXPORT or SETTINGS_MANAGE");
  }
  const wsId = ctx.workspace.id;
  const nextConfig = body.config !== undefined ? validateConfigInput(adapter, body.config) : undefined;

  // Validate mapping values before touching the database.
  const mappingErrors: string[] = [];
  const pattern = adapter.mapping?.codePattern ? new RegExp(adapter.mapping.codePattern) : null;
  const maxLen = adapter.mapping?.codeMaxLength ?? 200;
  const mappings = (body.mappings ?? []).map((m) => ({ accountId: m.accountId, externalCode: m.externalCode.trim(), externalName: m.externalName?.trim() || null }));
  if (new Set(mappings.map((m) => m.accountId)).size !== mappings.length) mappingErrors.push("Each account can be mapped only once.");
  for (const m of mappings) {
    if (!m.externalCode) continue;
    if (m.externalCode.length > maxLen) mappingErrors.push(`“${m.externalCode}” is longer than ${maxLen} characters.`);
    else if (pattern && !pattern.test(m.externalCode)) mappingErrors.push(`“${m.externalCode}”: ${adapter.mapping?.codePatternMessage ?? "invalid format"}`);
    if (/[\u0000-\u001f]/.test(m.externalCode + (m.externalName ?? ""))) mappingErrors.push("Mappings cannot contain control characters.");
  }
  if (mappingErrors.length) throw new ApiError(422, mappingErrors[0], "VALIDATION_ERROR", { errors: mappingErrors });

  return prisma.$transaction(
    async (tx) => {
      let configChanged = false;
      if (nextConfig) {
        await tx.$queryRaw`SELECT id FROM workspace_settings WHERE "workspaceId" = ${wsId} FOR UPDATE`;
        const settings = await tx.workspaceSettings.findUnique({ where: { workspaceId: wsId }, select: { integrationConfig: true } });
        if (!settings) throw notFound("Workspace settings missing");
        const bag = configBag(settings.integrationConfig);
        const before = bag[adapter.key] ?? {};
        if (JSON.stringify(before) !== JSON.stringify(nextConfig)) {
          configChanged = true;
          await tx.workspaceSettings.update({
            where: { workspaceId: wsId },
            data: { integrationConfig: { ...bag, [adapter.key]: nextConfig } as Prisma.InputJsonValue },
          });
          await audit(tx, {
            workspaceId: wsId,
            actor: ctx.actor,
            entityType: "INTEGRATION",
            entityId: adapter.key,
            action: "INTEGRATION_CONFIG_UPDATED",
            before: { adapterKey: adapter.key, config: before },
            after: { adapterKey: adapter.key, config: nextConfig },
            ip: ctx.meta?.ip,
            userAgent: ctx.meta?.userAgent,
          });
        }
      }

      let saved = 0;
      let removed = 0;
      if (mappings.length) {
        const accounts = await tx.account.findMany({ where: { workspaceId: wsId, id: { in: mappings.map((m) => m.accountId) } }, select: { id: true, code: true } });
        const codeById = new Map(accounts.map((a) => [a.id, a.code]));
        if (codeById.size !== mappings.length) throw badRequest("One or more accounts do not belong to this workspace");
        const existing = await tx.integrationAccountMapping.findMany({ where: { workspaceId: wsId, adapterKey: adapter.key, accountId: { in: [...codeById.keys()] } } });
        const existingById = new Map(existing.map((e) => [e.accountId, e]));
        const changes: { account: string; before: string | null; after: string | null }[] = [];
        for (const m of mappings) {
          const prev = existingById.get(m.accountId);
          if (!m.externalCode) {
            if (prev) {
              await tx.integrationAccountMapping.delete({ where: { id: prev.id } });
              removed++;
              changes.push({ account: codeById.get(m.accountId)!, before: prev.externalCode, after: null });
            }
            continue;
          }
          if (prev && prev.externalCode === m.externalCode && (prev.externalName ?? null) === m.externalName) continue;
          await tx.integrationAccountMapping.upsert({
            where: { workspaceId_adapterKey_accountId: { workspaceId: wsId, adapterKey: adapter.key, accountId: m.accountId } },
            create: { workspaceId: wsId, adapterKey: adapter.key, accountId: m.accountId, externalCode: m.externalCode, externalName: m.externalName },
            update: { externalCode: m.externalCode, externalName: m.externalName },
          });
          saved++;
          changes.push({ account: codeById.get(m.accountId)!, before: prev?.externalCode ?? null, after: m.externalCode });
        }
        if (changes.length) {
          await audit(tx, {
            workspaceId: wsId,
            actor: ctx.actor,
            entityType: "INTEGRATION",
            entityId: adapter.key,
            action: "INTEGRATION_MAPPINGS_UPDATED",
            after: { adapterKey: adapter.key, saved, removed, changes: changes.slice(0, 200) },
            ip: ctx.meta?.ip,
            userAgent: ctx.meta?.userAgent,
          });
        }
      }
      return { configChanged, saved, removed };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

// ───────────────────────────── Super Admin ─────────────────────────────

/** Platform view: availability and 30-day usage counts per adapter (no workspace financial data). */
export async function listPlatformAdapters() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, usage, workspaces] = await Promise.all([
    prisma.integrationAdapter.findMany(),
    prisma.exportJob.groupBy({ by: ["adapterKey"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.exportJob.groupBy({ by: ["adapterKey", "workspaceId"], where: { createdAt: { gte: since } } }),
  ]);
  return listAdapters().map((a) => {
    const row = rows.find((r) => r.key === a.key);
    return {
      key: a.key,
      name: a.name,
      vendor: a.vendor,
      product: a.product,
      category: a.category,
      implemented: a.implemented,
      enabled: row?.enabled ?? true,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      importMechanism: a.importMechanism,
      fileType: a.fileType,
      provenance: a.provenance.createdByTransfer,
      fullAuditTransfer: a.provenance.fullAuditTransfer,
      specReferences: a.specReferences,
      exports30d: usage.find((u) => u.adapterKey === a.key)?._count._all ?? 0,
      workspaces30d: workspaces.filter((w) => w.adapterKey === a.key).length,
    };
  });
}

export async function setPlatformAdapterEnabled(actor: { id: string; name: string; email: string }, key: AdapterKey, enabled: boolean, meta: Meta) {
  const entry = ADAPTER_CATALOG.find((a) => a.key === key);
  if (!entry) throw notFound("Unknown integration");
  return prisma.$transaction(async (tx) => {
    const before = await tx.integrationAdapter.findUnique({ where: { key } });
    const row = await tx.integrationAdapter.upsert({ where: { key }, create: { key, name: entry.name, enabled }, update: { enabled } });
    if ((before?.enabled ?? true) !== enabled) {
      await audit(tx, {
        workspaceId: null,
        actor,
        entityType: "INTEGRATION_ADAPTER",
        entityId: key,
        action: "INTEGRATION_ADAPTER_UPDATED",
        before: { key, enabled: before?.enabled ?? true },
        after: { key, enabled },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return { key: row.key, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
  });
}

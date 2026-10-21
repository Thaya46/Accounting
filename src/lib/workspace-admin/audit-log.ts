import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime, parseISODate } from "@/lib/dates";
import { txnRef } from "@/lib/ids";
import { AUDIT_PAGE_SIZE, KNOWN_AUDIT_ACTIONS } from "./constants";

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates")
  .refine((v) => {
    try {
      parseISODate(v);
      return true;
    } catch {
      return false;
    }
  }, "Invalid date");

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const auditFilterSchema = z.object({
  actor: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  action: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  entity: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  from: z.preprocess(emptyToUndefined, isoDay.optional()),
  to: z.preprocess(emptyToUndefined, isoDay.optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1_000_000).default(1)),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

/** Lenient parse for page search params: invalid values are dropped instead of failing the page. */
export function parseAuditFiltersLenient(input: Record<string, string | string[] | undefined>): AuditFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(input)) flat[k] = Array.isArray(v) ? v[0] : v;
  const out: AuditFilters = { page: 1 };
  for (const key of Object.keys(auditFilterSchema.shape) as (keyof AuditFilters)[]) {
    const r = auditFilterSchema.shape[key].safeParse(flat[key]);
    if (r.success && r.data !== undefined) (out as Record<string, unknown>)[key] = r.data;
  }
  return out;
}

function tzOffsetMs(timeZone: string, at: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return wall - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** The instant a calendar day starts in the workspace time zone. */
export function zonedDayStart(isoDay: string, timeZone: string): Date {
  const base = parseISODate(isoDay).getTime();
  let guess = base - tzOffsetMs(timeZone, new Date(base));
  guess = base - tzOffsetMs(timeZone, new Date(guess));
  return new Date(guess);
}

export type AuditRow = {
  id: string;
  createdAt: string;
  createdLabel: string;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  transactionId: string | null;
  transactionRef: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  approvalId: string | null;
  reversalId: string | null;
  ip: string | null;
};

export async function queryAuditEvents(workspace: { id: string; timeZone: string }, filters: AuditFilters) {
  const where: Prisma.AuditEventWhereInput = { workspaceId: workspace.id };
  if (filters.actor) where.actorUserId = filters.actor;
  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entityType = filters.entity;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: zonedDayStart(filters.from, workspace.timeZone) } : {}),
      ...(filters.to ? { lt: zonedDayStart(addOneDay(filters.to), workspace.timeZone) } : {}),
    };
  }
  if (filters.q) {
    const ref = /^(?:TXN-?)?(\d{1,9})$/i.exec(filters.q);
    if (ref) {
      const txn = await prisma.transaction.findFirst({ where: { workspaceId: workspace.id, number: Number(ref[1]) }, select: { id: true } });
      where.transactionId = txn?.id ?? "__no_match__";
    } else {
      where.OR = [{ transactionId: filters.q }, { entityId: filters.q }, { approvalId: filters.q }, { reversalId: filters.q }];
    }
  }

  const total = await prisma.auditEvent.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });

  const txnIds = [...new Set(events.map((e) => e.transactionId).filter((v): v is string => Boolean(v)))];
  const txns = txnIds.length
    ? await prisma.transaction.findMany({ where: { workspaceId: workspace.id, id: { in: txnIds } }, select: { id: true, number: true } })
    : [];
  const refById = new Map(txns.map((t) => [t.id, txnRef(t.number)]));

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    createdLabel: formatDateTime(e.createdAt, workspace.timeZone),
    actorUserId: e.actorUserId,
    actorName: e.actorName,
    actorEmail: e.actorEmail,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    transactionId: e.transactionId,
    transactionRef: e.transactionId ? (refById.get(e.transactionId) ?? null) : null,
    reason: e.reason,
    before: e.before ?? null,
    after: e.after ?? null,
    approvalId: e.approvalId,
    reversalId: e.reversalId,
    ip: e.ip,
  }));
  return { rows, total, page, pageCount, pageSize: AUDIT_PAGE_SIZE };
}

function addOneDay(isoDayValue: string) {
  const d = parseISODate(isoDayValue);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function auditFilterOptions(workspaceId: string) {
  const [actions, entities, actors] = await Promise.all([
    prisma.auditEvent.groupBy({ by: ["action"], where: { workspaceId } }),
    prisma.auditEvent.groupBy({ by: ["entityType"], where: { workspaceId } }),
    prisma.auditEvent.groupBy({
      by: ["actorUserId", "actorName", "actorEmail"],
      where: { workspaceId, actorUserId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);
  // One entry per actor, using their most recent name snapshot.
  const latest = new Map<string, { id: string; name: string; email: string | null; at: number }>();
  for (const a of actors) {
    if (!a.actorUserId) continue;
    const at = a._max.createdAt?.getTime() ?? 0;
    const prev = latest.get(a.actorUserId);
    if (!prev || at > prev.at) latest.set(a.actorUserId, { id: a.actorUserId, name: a.actorName, email: a.actorEmail, at });
  }
  return {
    actions: [...new Set([...KNOWN_AUDIT_ACTIONS, ...actions.map((a) => a.action)])].sort(),
    entities: entities.map((e) => e.entityType).sort(),
    actors: [...latest.values()].map(({ id, name, email }) => ({ id, name, email })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Read models for the Super Admin console. Every function returns plain JSON
 * (dates as ISO strings) so results can go straight to client components or
 * API responses. Super Admins only ever see counts and usage metrics — never
 * transaction descriptions or amounts.
 */
import type { NotificationStatus, Prisma, WorkspaceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userRef, workspaceRef } from "@/lib/ids";
import { addDays, parseISODate, todayInTimeZone } from "@/lib/dates";
import { NON_FINANCIAL_ENTITY_TYPES, WORKSPACE_STATUSES } from "./constants";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ───────────────────────────── Platform settings ─────────────────────────────

export const PLATFORM_DEFAULTS = {
  platformName: "VLedger AI",
  defaultCountry: "India",
  defaultCurrency: "INR",
  defaultTimeZone: "Asia/Kolkata",
  defaultFyStartMonth: 4,
  requireMfaForUsers: false,
  sessionTtlHours: 12,
  invitationTtlHours: 72,
  allowSelfPasswordReset: true,
};

export type PlatformSettingsData = typeof PLATFORM_DEFAULTS & { updatedAt: string | null };

export async function getPlatformSettings(): Promise<PlatformSettingsData> {
  const row = await prisma.platformSettings.findUnique({ where: { id: "platform" } });
  if (!row) return { ...PLATFORM_DEFAULTS, updatedAt: null };
  return {
    platformName: row.platformName,
    defaultCountry: row.defaultCountry,
    defaultCurrency: row.defaultCurrency,
    defaultTimeZone: row.defaultTimeZone,
    defaultFyStartMonth: row.defaultFyStartMonth,
    requireMfaForUsers: row.requireMfaForUsers,
    sessionTtlHours: row.sessionTtlHours,
    invitationTtlHours: row.invitationTtlHours,
    allowSelfPasswordReset: row.allowSelfPasswordReset,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Time zone used to display platform-level timestamps. */
export async function platformTimeZone() {
  const row = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { defaultTimeZone: true } });
  return row?.defaultTimeZone ?? PLATFORM_DEFAULTS.defaultTimeZone;
}

/** UTC instant of local midnight for a calendar day in an IANA time zone. */
export function zonedDayStart(isoDay: string, timeZone: string): Date {
  const day = parseISODate(isoDay);
  const offsetAt = (instant: number) => {
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
      }).formatToParts(new Date(instant));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
      return asUtc - instant;
    } catch {
      return 0;
    }
  };
  const guess = day.getTime();
  let result = guess - offsetAt(guess);
  // Second pass corrects for a DST transition between the guess and the result.
  result = guess - offsetAt(result);
  return new Date(result);
}

// ───────────────────────────── Dashboard ─────────────────────────────

export type DashboardData = Awaited<ReturnType<typeof getAdminDashboard>>;

export async function getAdminDashboard(timeZone: string) {
  const today = todayInTimeZone(timeZone);
  const firstDay = addDays(today, -29);
  const since = zonedDayStart(firstDay, timeZone);

  const [statusGroups, totalUsers, activeUsers, newWorkspaces, adapters, exportGroups, recent, postedByWs, membersByWs, workspaces, dailyPosted, dailyMembers] =
    await Promise.all([
      prisma.workspace.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.count({ where: { platformRole: "USER" } }),
      prisma.user.count({ where: { platformRole: "USER", status: "ACTIVE" } }),
      prisma.workspace.count({ where: { createdAt: { gte: since } } }),
      prisma.integrationAdapter.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true, enabled: true } }),
      prisma.exportJob.groupBy({ by: ["adapterKey", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.auditEvent.findMany({
        take: 12,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          actorName: true,
          actorEmail: true,
          action: true,
          entityType: true,
          createdAt: true,
          workspace: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.transaction.groupBy({ by: ["workspaceId"], where: { postedAt: { gte: since } }, _count: { _all: true } }),
      prisma.workspaceMembership.groupBy({ by: ["workspaceId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.workspace.findMany({ select: { id: true, name: true, code: true, status: true } }),
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT to_char(("postedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM "transactions"
        WHERE "postedAt" >= ${since}
        GROUP BY 1`,
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM "workspace_memberships"
        WHERE "createdAt" >= ${since}
        GROUP BY 1`,
    ]);

  const byStatus = Object.fromEntries(WORKSPACE_STATUSES.map((s) => [s, 0])) as Record<WorkspaceStatus, number>;
  for (const g of statusGroups) byStatus[g.status] = g._count._all;
  const totalWorkspaces = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // Workspace activity — usage counts only.
  const posted = new Map(postedByWs.map((g) => [g.workspaceId, g._count._all]));
  const members = new Map(membersByWs.map((g) => [g.workspaceId, g._count._all]));
  const active = workspaces
    .map((w) => ({ id: w.id, name: w.name, code: w.code, status: w.status, posted: posted.get(w.id) ?? 0, newMembers: members.get(w.id) ?? 0 }))
    .filter((w) => w.posted > 0 || w.newMembers > 0);
  // Top 10 for each metric (the chart switches between them).
  const top = (key: "posted" | "newMembers") =>
    [...active].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, 10).filter((w) => w[key] > 0);
  const byWorkspace = [...new Map([...top("posted"), ...top("newMembers")].map((w) => [w.id, w])).values()];

  const postedDay = new Map(dailyPosted.map((r) => [r.day, Number(r.count)]));
  const membersDay = new Map(dailyMembers.map((r) => [r.day, Number(r.count)]));
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(firstDay, i);
    return { day, posted: postedDay.get(day) ?? 0, newMembers: membersDay.get(day) ?? 0 };
  });

  // Integration health — adapter availability and export job outcomes (30 days).
  const jobCounts = new Map<string, { completed: number; failed: number }>();
  for (const g of exportGroups) {
    const c = jobCounts.get(g.adapterKey) ?? { completed: 0, failed: 0 };
    if (g.status === "COMPLETED") c.completed += g._count._all;
    if (g.status === "FAILED") c.failed += g._count._all;
    jobCounts.set(g.adapterKey, c);
  }
  const adapterRows = adapters.map((a) => ({ ...a, ...(jobCounts.get(a.key) ?? { completed: 0, failed: 0 }) }));
  for (const [key, c] of jobCounts) {
    if (!adapters.some((a) => a.key === key)) adapterRows.push({ key, name: key, enabled: false, ...c });
  }

  return {
    kpis: {
      totalWorkspaces,
      active: byStatus.ACTIVE,
      suspended: byStatus.SUSPENDED,
      archived: byStatus.ARCHIVED,
      newWorkspaces,
      totalUsers,
      activeUsers,
    },
    activity: {
      from: firstDay,
      to: today,
      activeWorkspaces: active.length,
      byWorkspace,
      daily,
      totals: {
        posted: daily.reduce((a, d) => a + d.posted, 0),
        newMembers: daily.reduce((a, d) => a + d.newMembers, 0),
      },
    },
    integrations: {
      total: adapters.length,
      enabled: adapters.filter((a) => a.enabled).length,
      completed: adapterRows.reduce((a, r) => a + r.completed, 0),
      failed: adapterRows.reduce((a, r) => a + r.failed, 0),
      adapters: adapterRows,
    },
    recent: recent.map((e) => ({
      id: e.id,
      actorName: e.actorName,
      actorEmail: e.actorEmail,
      action: e.action,
      entityType: e.entityType,
      createdAt: e.createdAt.toISOString(),
      workspace: e.workspace,
    })),
  };
}

// ───────────────────────────── Workspaces ─────────────────────────────

export const WORKSPACES_PAGE_SIZE = 25;

export type WorkspaceListFilters = { q?: string; status?: string; page?: number };

function workspaceSearch(q?: string): Prisma.WorkspaceWhereInput {
  const term = q?.trim().slice(0, 100);
  if (!term) return {};
  const or: Prisma.WorkspaceWhereInput[] = [
    { name: { contains: term, mode: "insensitive" } },
    { code: { contains: term, mode: "insensitive" } },
    { companyName: { contains: term, mode: "insensitive" } },
    { companyEmail: { contains: term, mode: "insensitive" } },
  ];
  const ref = /^ws-?0*(\d{1,9})$/i.exec(term);
  if (ref) or.push({ seq: Number(ref[1]) });
  return { OR: or };
}

export function parseWorkspaceStatus(value: string | undefined | null): WorkspaceStatus | undefined {
  const v = value?.toUpperCase();
  return (WORKSPACE_STATUSES as readonly string[]).includes(v ?? "") ? (v as WorkspaceStatus) : undefined;
}

export async function listWorkspaces(filters: WorkspaceListFilters) {
  const search = workspaceSearch(filters.q);
  const status = parseWorkspaceStatus(filters.status);
  const where: Prisma.WorkspaceWhereInput = { ...search, ...(status ? { status } : {}) };
  const page = Math.max(1, Math.floor(filters.page ?? 1));

  const [total, rows, statusGroups] = await Promise.all([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
      skip: (page - 1) * WORKSPACES_PAGE_SIZE,
      take: WORKSPACES_PAGE_SIZE,
      select: {
        id: true,
        seq: true,
        code: true,
        name: true,
        companyName: true,
        companyEmail: true,
        country: true,
        defaultCurrency: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.workspace.groupBy({ by: ["status"], where: search, _count: { _all: true } }),
  ]);

  const ids = rows.map((r) => r.id);
  const [memberGroups, admins] = ids.length
    ? await Promise.all([
        prisma.workspaceMembership.groupBy({ by: ["workspaceId", "status"], where: { workspaceId: { in: ids } }, _count: { _all: true } }),
        prisma.workspaceMembership.findMany({
          where: { workspaceId: { in: ids }, role: { isAdmin: true }, status: { not: "DISABLED" } },
          orderBy: { createdAt: "asc" },
          select: { workspaceId: true, status: true, user: { select: { name: true, email: true } } },
        }),
      ])
    : [[], []];

  const counts = Object.fromEntries(WORKSPACE_STATUSES.map((s) => [s, 0])) as Record<WorkspaceStatus, number>;
  for (const g of statusGroups) counts[g.status] = g._count._all;

  return {
    page,
    pageSize: WORKSPACES_PAGE_SIZE,
    total,
    counts: { ALL: Object.values(counts).reduce((a, b) => a + b, 0), ...counts },
    items: rows.map((w) => {
      const m = memberGroups.filter((g) => g.workspaceId === w.id);
      const by = (s: string) => m.find((g) => g.status === s)?._count._all ?? 0;
      return {
        id: w.id,
        ref: workspaceRef(w.seq),
        code: w.code,
        name: w.name,
        companyName: w.companyName,
        companyEmail: w.companyEmail,
        country: w.country,
        currency: w.defaultCurrency,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
        members: { active: by("ACTIVE"), invited: by("INVITED"), disabled: by("DISABLED") },
        admins: admins.filter((a) => a.workspaceId === w.id).map((a) => ({ name: a.user.name, email: a.user.email, status: a.status })),
      };
    }),
  };
}

export type WorkspaceDetail = NonNullable<Awaited<ReturnType<typeof getWorkspaceDetail>>>;

export async function getWorkspaceDetail(workspaceId: string) {
  if (!workspaceId || workspaceId.length > 64) return null;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) return null;

  const [createdBy, admins, invitations, memberGroups, txnGroups, journalCount, exportCount, importCount, lastEvent, statusHistory, adminRole] =
    await Promise.all([
      ws.createdById ? prisma.user.findUnique({ where: { id: ws.createdById }, select: { name: true, email: true } }) : null,
      prisma.workspaceMembership.findMany({
        where: { workspaceId: ws.id, role: { isAdmin: true } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          role: { select: { name: true } },
          user: {
            select: {
              id: true,
              seq: true,
              name: true,
              email: true,
              status: true,
              lastLoginAt: true,
              mfaCredential: { select: { enabledAt: true } },
            },
          },
        },
      }),
      prisma.workspaceInvitation.findMany({
        where: { workspaceId: ws.id, status: "PENDING", role: { isAdmin: true } },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, invitedByName: true, createdAt: true, expiresAt: true, role: { select: { name: true } } },
      }),
      prisma.workspaceMembership.groupBy({ by: ["status"], where: { workspaceId: ws.id }, _count: { _all: true } }),
      prisma.transaction.groupBy({ by: ["status"], where: { workspaceId: ws.id }, _count: { _all: true } }),
      prisma.journalEntry.count({ where: { workspaceId: ws.id } }),
      prisma.exportJob.count({ where: { workspaceId: ws.id } }),
      prisma.importJob.count({ where: { workspaceId: ws.id } }),
      prisma.auditEvent.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, action: true, actorName: true } }),
      prisma.auditEvent.findMany({
        where: { workspaceId: ws.id, action: "WORKSPACE_STATUS_CHANGED" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, createdAt: true, actorName: true, reason: true, before: true, after: true },
      }),
      prisma.role.findFirst({ where: { workspaceId: ws.id, isAdmin: true }, orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    ]);

  // Latest delivery status for each pending admin invitation email.
  const emails = [...new Set(invitations.map((i) => i.email))];
  const logs = emails.length
    ? await prisma.notificationLog.findMany({
        where: { workspaceId: ws.id, toEmail: { in: emails }, template: "WORKSPACE_ADMIN_INVITATION" },
        orderBy: { createdAt: "desc" },
        select: { toEmail: true, status: true, error: true, createdAt: true },
      })
    : [];

  const now = Date.now();
  const memberCount = (s: string) => memberGroups.find((g) => g.status === s)?._count._all ?? 0;
  const txnByStatus = Object.fromEntries(txnGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const transactionsTotal = txnGroups.reduce((a, g) => a + g._count._all, 0);
  const statusOf = (v: Prisma.JsonValue | null) =>
    v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>).status === "string"
      ? ((v as Record<string, unknown>).status as string)
      : null;

  return {
    workspace: {
      id: ws.id,
      ref: workspaceRef(ws.seq),
      code: ws.code,
      name: ws.name,
      companyName: ws.companyName,
      companyEmail: ws.companyEmail,
      country: ws.country,
      defaultCurrency: ws.defaultCurrency,
      fyStartMonth: ws.fyStartMonth,
      timeZone: ws.timeZone,
      status: ws.status,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
      suspendedAt: iso(ws.suspendedAt),
      archivedAt: iso(ws.archivedAt),
      createdBy: createdBy ? { name: createdBy.name, email: createdBy.email } : null,
    },
    /** Currency can only change before any transaction or journal exists. */
    currencyLocked: transactionsTotal > 0 || journalCount > 0,
    adminRole,
    admins: admins.map((m) => ({
      membershipId: m.id,
      status: m.status,
      roleName: m.role.name,
      since: m.createdAt.toISOString(),
      user: {
        id: m.user.id,
        ref: userRef(m.user.seq),
        name: m.user.name,
        email: m.user.email,
        status: m.user.status,
        lastLoginAt: iso(m.user.lastLoginAt),
        mfaEnabled: Boolean(m.user.mfaCredential?.enabledAt),
      },
    })),
    invitations: invitations.map((i) => {
      const log = logs.find((l) => l.toEmail === i.email && l.createdAt >= new Date(i.createdAt.getTime() - 5_000));
      return {
        id: i.id,
        email: i.email,
        name: i.name,
        roleName: i.role.name,
        invitedByName: i.invitedByName,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() < now,
        delivery: log ? { status: log.status, error: log.error, at: log.createdAt.toISOString() } : null,
      };
    }),
    usage: {
      members: { active: memberCount("ACTIVE"), invited: memberCount("INVITED"), disabled: memberCount("DISABLED") },
      transactions: { total: transactionsTotal, byStatus: txnByStatus },
      journalEntries: journalCount,
      exportJobs: exportCount,
      importJobs: importCount,
      lastActivity: lastEvent ? { at: lastEvent.createdAt.toISOString(), action: lastEvent.action, actorName: lastEvent.actorName } : null,
    },
    statusHistory: statusHistory.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      actorName: e.actorName,
      reason: e.reason,
      from: statusOf(e.before),
      to: statusOf(e.after),
    })),
  };
}

// ───────────────────────────── Activity log ─────────────────────────────

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityFilters = {
  q?: string;
  actor?: string;
  workspace?: string;
  from?: string;
  to?: string;
  entity?: string;
  page?: number;
};

function validDay(s: string | undefined) {
  if (!s) return null;
  try {
    parseISODate(s);
    return s;
  } catch {
    return null;
  }
}

/** Whether an event's payload may be shown in the Super Admin console. */
export function auditDetailsVisible(e: { workspaceId: string | null; entityType: string; transactionId: string | null }) {
  if (e.transactionId) return false;
  if (e.workspaceId === null) return true;
  return NON_FINANCIAL_ENTITY_TYPES.has(e.entityType);
}

export async function listActivity(filters: ActivityFilters, timeZone: string) {
  const and: Prisma.AuditEventWhereInput[] = [];
  const q = filters.q?.trim().slice(0, 100);
  if (q) and.push({ action: { contains: q.replace(/\s+/g, "_"), mode: "insensitive" } });
  const actor = filters.actor?.trim().slice(0, 100);
  if (actor) and.push({ OR: [{ actorName: { contains: actor, mode: "insensitive" } }, { actorEmail: { contains: actor, mode: "insensitive" } }] });
  if (filters.workspace === "platform") and.push({ workspaceId: null });
  else if (filters.workspace) and.push({ workspaceId: filters.workspace.slice(0, 64) });
  const from = validDay(filters.from);
  const to = validDay(filters.to);
  if (from) and.push({ createdAt: { gte: zonedDayStart(from, timeZone) } });
  if (to) and.push({ createdAt: { lt: zonedDayStart(addDays(to, 1), timeZone) } });
  if (filters.entity) and.push({ entityType: filters.entity.slice(0, 64) });
  const where: Prisma.AuditEventWhereInput = and.length ? { AND: and } : {};
  const page = Math.max(1, Math.floor(filters.page ?? 1));

  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      include: { workspace: { select: { id: true, name: true, code: true } } },
    }),
  ]);

  return {
    page,
    pageSize: ACTIVITY_PAGE_SIZE,
    total,
    items: rows.map((e) => {
      const visible = auditDetailsVisible(e);
      return {
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        actorUserId: e.actorUserId,
        actorName: e.actorName,
        actorEmail: e.actorEmail,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        workspace: e.workspace,
        ip: e.ip,
        userAgent: e.userAgent,
        redacted: !visible,
        reason: visible ? e.reason : null,
        before: visible ? e.before : null,
        after: visible ? e.after : null,
      };
    }),
  };
}

export async function activityFilterOptions() {
  const [workspaces, entities] = await Promise.all([
    prisma.workspace.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.auditEvent.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } }),
  ]);
  return { workspaces, entityTypes: entities.map((e) => e.entityType) };
}

// ───────────────────────────── Email outbox ─────────────────────────────

export const OUTBOX_PAGE_SIZE = 50;
const NOTIFICATION_STATUSES: NotificationStatus[] = ["SENT", "FAILED", "DEV_LOGGED"];

export async function listOutbox(filters: { status?: string; template?: string; page?: number }) {
  const status = NOTIFICATION_STATUSES.find((s) => s === filters.status?.toUpperCase());
  const template = filters.template?.trim().slice(0, 64) || undefined;
  const where: Prisma.NotificationLogWhereInput = { ...(status ? { status } : {}), ...(template ? { template } : {}) };
  const page = Math.max(1, Math.floor(filters.page ?? 1));

  const [total, rows, templates, statusGroups] = await Promise.all([
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * OUTBOX_PAGE_SIZE,
      take: OUTBOX_PAGE_SIZE,
    }),
    prisma.notificationLog.groupBy({ by: ["template"], orderBy: { template: "asc" } }),
    prisma.notificationLog.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const wsIds = [...new Set(rows.map((r) => r.workspaceId).filter((x): x is string => Boolean(x)))];
  const workspaces = wsIds.length ? await prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true, code: true } }) : [];

  return {
    page,
    pageSize: OUTBOX_PAGE_SIZE,
    total,
    templates: templates.map((t) => t.template),
    counts: Object.fromEntries(NOTIFICATION_STATUSES.map((s) => [s, statusGroups.find((g) => g.status === s)?._count._all ?? 0])) as Record<NotificationStatus, number>,
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      toEmail: r.toEmail,
      template: r.template,
      subject: r.subject,
      status: r.status,
      error: r.error,
      providerMessageId: r.providerMessageId,
      devBody: r.devBody,
      workspace: workspaces.find((w) => w.id === r.workspaceId) ?? null,
    })),
  };
}

import { z } from "zod";
import type { Workspace, WorkspaceSettings } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff, type Actor } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { MONTH_NAMES, addDays, formatDate, startOfMonth, todayInTimeZone } from "@/lib/dates";
import { formatMoney, money2 } from "@/lib/money";
import { workspaceRef } from "@/lib/ids";
import { incomeExpenseTotals } from "@/lib/accounting/reports";
import { sendEmail } from "@/lib/email/send";
import { transactionSummaryEmail } from "@/lib/email/templates";
import { rateLimit } from "@/lib/auth/rate-limit";
import { TX_OPTIONS, auditMeta, type AdminCtx } from "./common";

export type SettingsDTO = {
  autoPostEnabled: boolean;
  autoPostMinConfidence: number;
  requireApproval: boolean;
  approvalThreshold: string | null;
  duplicateWindowDays: number;
  mfaRequiredForUsers: boolean;
  dailySummaryEmail: boolean;
  monthlySummaryEmail: boolean;
  updatedAt: string | null;
};

export type WorkspaceInfoDTO = {
  id: string;
  ref: string;
  name: string;
  code: string;
  companyName: string;
  companyEmail: string;
  country: string;
  defaultCurrency: string;
  fyStartMonth: number;
  fyStartLabel: string;
  timeZone: string;
  status: string;
  createdAt: string;
};

const DEFAULTS = {
  autoPostEnabled: false,
  autoPostMinConfidence: 0.9,
  requireApproval: false,
  approvalThreshold: null,
  duplicateWindowDays: 3,
  mfaRequiredForUsers: false,
  dailySummaryEmail: false,
  monthlySummaryEmail: false,
};

export function serializeSettings(s: WorkspaceSettings | null): SettingsDTO {
  if (!s) return { ...DEFAULTS, updatedAt: null };
  return {
    autoPostEnabled: s.autoPostEnabled,
    autoPostMinConfidence: s.autoPostMinConfidence,
    requireApproval: s.requireApproval,
    approvalThreshold: s.approvalThreshold === null ? null : money2(s.approvalThreshold),
    duplicateWindowDays: s.duplicateWindowDays,
    mfaRequiredForUsers: s.mfaRequiredForUsers,
    dailySummaryEmail: s.dailySummaryEmail,
    monthlySummaryEmail: s.monthlySummaryEmail,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function serializeWorkspaceInfo(w: Workspace): WorkspaceInfoDTO {
  return {
    id: w.id,
    ref: workspaceRef(w.seq),
    name: w.name,
    code: w.code,
    companyName: w.companyName,
    companyEmail: w.companyEmail,
    country: w.country,
    defaultCurrency: w.defaultCurrency,
    fyStartMonth: w.fyStartMonth,
    fyStartLabel: MONTH_NAMES[w.fyStartMonth - 1] ?? String(w.fyStartMonth),
    timeZone: w.timeZone,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
  };
}

export const settingsPatchSchema = z
  .object({
    autoPostEnabled: z.boolean(),
    autoPostMinConfidence: z.number().min(0.5, "Minimum confidence is 50%").max(1, "Maximum confidence is 100%"),
    requireApproval: z.boolean(),
    approvalThreshold: z
      .union([z.string(), z.number()])
      .nullable()
      .transform((v) => (v === null || v === "" ? null : String(v).replace(/,/g, "").trim()))
      .refine((v) => v === null || /^\d{1,15}(\.\d{1,2})?$/.test(v), "Enter a positive amount with at most 2 decimals, or leave it empty"),
    duplicateWindowDays: z.number().int("Use whole days").min(0).max(30, "Use at most 30 days"),
    mfaRequiredForUsers: z.boolean(),
    dailySummaryEmail: z.boolean(),
    monthlySummaryEmail: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function updateSettings(ctx: AdminCtx, body: z.infer<typeof settingsPatchSchema>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspaceSettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
    const current = serializeSettings(existing);
    const { updatedAt: _u, ...currentValues } = current;
    const nextValues = {
      ...currentValues,
      ...body,
      ...(body.autoPostMinConfidence !== undefined ? { autoPostMinConfidence: Math.round(body.autoPostMinConfidence * 100) / 100 } : {}),
      ...(body.approvalThreshold !== undefined ? { approvalThreshold: body.approvalThreshold === null ? null : money2(body.approvalThreshold) } : {}),
    };
    const d = diff(currentValues, nextValues);
    if (!d.changed) return { settings: current, changed: false };
    const data = {
      autoPostEnabled: nextValues.autoPostEnabled,
      autoPostMinConfidence: nextValues.autoPostMinConfidence,
      requireApproval: nextValues.requireApproval,
      approvalThreshold: nextValues.approvalThreshold,
      duplicateWindowDays: nextValues.duplicateWindowDays,
      mfaRequiredForUsers: nextValues.mfaRequiredForUsers,
      dailySummaryEmail: nextValues.dailySummaryEmail,
      monthlySummaryEmail: nextValues.monthlySummaryEmail,
    };
    const saved = await tx.workspaceSettings.upsert({
      where: { workspaceId: ctx.workspace.id },
      create: { workspaceId: ctx.workspace.id, ...data },
      update: data,
    });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: "WORKSPACE_SETTINGS",
      entityId: saved.id,
      action: "WORKSPACE_SETTINGS_UPDATED",
      before: d.before,
      after: d.after,
    });
    return { settings: serializeSettings(saved), changed: true };
  }, TX_OPTIONS);
}

export const summarySchema = z.object({ period: z.enum(["daily", "monthly"]) });

export type SummaryResult = {
  period: "daily" | "monthly";
  from: string;
  to: string;
  label: string;
  totals: { income: string; expenses: string; net: string; count: number };
  recipients: { name: string; email: string; status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string }[];
};

/** Emails posted income/expense totals for today or this month to every active Workspace Admin. */
export async function sendSummaryNow(ctx: AdminCtx, period: "daily" | "monthly"): Promise<SummaryResult> {
  const limit = await rateLimit(`ws-summary:${ctx.workspace.id}`, 10, 60 * 60);
  if (!limit.allowed) throw new ApiError(429, "Summaries were sent too often. Try again later.", "RATE_LIMITED");
  const meta = auditMeta(ctx);
  return sendWorkspaceSummary(ctx.workspace, period, "current", { actor: meta.actor, ip: meta.ip, userAgent: meta.userAgent });
}

/**
 * Computes posted totals for a period and emails them to the workspace's active
 * admins. `current` = today / month-to-date (manual send); `previous` = the last
 * complete day / month (scheduled send).
 */
export async function sendWorkspaceSummary(
  ws: Pick<Workspace, "id" | "name" | "timeZone" | "defaultCurrency">,
  period: "daily" | "monthly",
  range: "current" | "previous",
  meta: { actor: Actor; ip?: string; userAgent?: string },
): Promise<SummaryResult> {
  const today = todayInTimeZone(ws.timeZone);
  let from: string;
  let to: string;
  if (period === "daily") {
    from = to = range === "current" ? today : addDays(today, -1);
  } else if (range === "current") {
    from = startOfMonth(today);
    to = today;
  } else {
    to = addDays(startOfMonth(today), -1);
    from = startOfMonth(to);
  }
  const label = period === "daily" ? formatDate(from) : `${MONTH_NAMES[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}${range === "current" ? " (to date)" : ""}`;
  const totals = await incomeExpenseTotals(ws.id, { from, to });
  const count = totals.incomeCount + totals.expenseCount;

  const admins = await prisma.workspaceMembership.findMany({
    where: { workspaceId: ws.id, status: "ACTIVE", role: { isAdmin: true }, user: { status: "ACTIVE" } },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const money = (v: string) => formatMoney(v, ws.defaultCurrency, { decimals: true });
  const recipients: SummaryResult["recipients"] = [];
  for (const { user } of admins) {
    const mail = transactionSummaryEmail({
      name: user.name,
      workspaceName: ws.name,
      period: period === "daily" ? "Daily" : "Monthly",
      rangeLabel: label,
      income: money(totals.income),
      expenses: money(totals.expenses),
      net: money(totals.net),
      count,
    });
    const result = await sendEmail({ to: user.email, toName: user.name, ...mail, template: "TRANSACTION_SUMMARY", workspaceId: ws.id, userId: user.id });
    recipients.push({ name: user.name, email: user.email, status: result.status, ...(result.error ? { error: result.error } : {}) });
  }

  await audit(prisma, {
    workspaceId: ws.id,
    actor: meta.actor,
    ip: meta.ip,
    userAgent: meta.userAgent,
    entityType: "WORKSPACE",
    entityId: ws.id,
    action: "SUMMARY_EMAIL_SENT",
    after: {
      period,
      from,
      to,
      income: totals.income,
      expenses: totals.expenses,
      net: totals.net,
      transactions: count,
      recipients: recipients.map((r) => `${r.email}: ${r.status}`),
    },
  });

  return { period, from, to, label, totals: { income: totals.income, expenses: totals.expenses, net: totals.net, count }, recipients };
}

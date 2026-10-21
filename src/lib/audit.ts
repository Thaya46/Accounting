import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

/** Transaction lifecycle actions (requirement §5) plus platform/workspace events. */
export const TXN_ACTIONS = ["CREATED", "UPDATED", "SUBMITTED", "APPROVED", "REJECTED", "POSTED", "REVERSED", "EXPORTED", "IMPORTED"] as const;
export type TxnAction = (typeof TXN_ACTIONS)[number];

export type Actor = { id: string | null; name: string; email?: string | null };

export type AuditInput = {
  workspaceId?: string | null;
  actor: Actor;
  entityType: string;
  entityId?: string | null;
  transactionId?: string | null;
  action: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  approvalId?: string | null;
  reversalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

function json(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Appends an audit event. Audit rows are immutable — a database trigger rejects
 * UPDATE and DELETE on audit_events.
 */
export async function audit(db: Tx, input: AuditInput) {
  return db.auditEvent.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      transactionId: input.transactionId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      before: json(input.before),
      after: json(input.after),
      approvalId: input.approvalId ?? null,
      reversalId: input.reversalId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    },
  });
}

/** Returns only the fields that changed between two snapshots. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const bv = JSON.stringify(before[key] ?? null);
    const av = JSON.stringify(after[key] ?? null);
    if (bv !== av) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

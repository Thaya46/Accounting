import type { Transaction } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { canViewTransaction, needsApproval } from "@/lib/accounting/transactions";
import { notFound } from "@/lib/errors";
import { isoDate } from "@/lib/dates";
import { txnRef } from "@/lib/ids";
import { money2, type DecimalLike } from "@/lib/money";
import type { SavedTransaction, TransactionAbilities } from "./types";

/**
 * Loads the minimal record for an action and enforces visibility: the caller's
 * own transaction, TRANSACTION_VIEW, or — for approvers acting from the queue —
 * a transaction that is pending approval or approved. Anything else is a 404 so
 * the existence of other people's records is not revealed.
 */
export async function assertActionable(ctx: WorkspaceContext, id: string, opts: { approverAccess?: boolean } = {}) {
  if (!id || id.length > 64) throw notFound("Transaction not found");
  const t = await prisma.transaction.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true, workspaceId: true, createdById: true, status: true },
  });
  if (!t) throw notFound("Transaction not found");
  const visible =
    canViewTransaction(ctx, t) ||
    (opts.approverAccess && ctx.permissions.has("TRANSACTION_APPROVE") && (t.status === "PENDING_APPROVAL" || t.status === "APPROVED"));
  if (!visible) throw notFound("Transaction not found");
  return t;
}

/** What the caller may do with a transaction in its current state (UI hints; the service re-checks). */
export function transactionAbilities(
  ctx: WorkspaceContext,
  t: { createdById: string; status: string; amount: DecimalLike; exchangeRate?: DecimalLike; missing: string[] },
): TransactionAbilities {
  const p = ctx.permissions;
  const own = t.createdById === ctx.user.id;
  const editable = t.status === "DRAFT" || t.status === "REJECTED";
  const canSubmitRole = p.has("TRANSACTION_CREATE") || p.has("TRANSACTION_EDIT_DRAFT");
  const pending = t.status === "PENDING_APPROVAL";
  const canApprove = pending && p.has("TRANSACTION_APPROVE");
  const postable = t.status === "DRAFT" || t.status === "APPROVED";
  let postBlockedReason: string | null = null;
  if (postable && t.status === "DRAFT" && needsApproval(ctx, money2(t.amount), String(t.exchangeRate ?? "1"))) {
    postBlockedReason = "This transaction needs approval before it can be posted. Submit it for approval.";
  } else if (postable && t.missing.length) {
    postBlockedReason = `Complete these fields first: ${t.missing.join(", ")}.`;
  }
  return {
    canEdit: editable && p.has("TRANSACTION_EDIT_DRAFT") && (own || p.has("TRANSACTION_VIEW")),
    canSubmit: editable && canSubmitRole && (own || (p.has("TRANSACTION_EDIT_DRAFT") && p.has("TRANSACTION_VIEW"))),
    canApprove,
    selfApprovalBlocked: canApprove && own && !ctx.membership.isAdmin,
    canApproveAndPost: canApprove && p.has("TRANSACTION_POST"),
    canPost: postable && p.has("TRANSACTION_POST"),
    postBlockedReason,
    canReverse: t.status === "POSTED" && p.has("TRANSACTION_REVERSE"),
  };
}

export function serializeSaved(t: Transaction): SavedTransaction {
  return {
    id: t.id,
    number: t.number,
    ref: txnRef(t.number),
    status: t.status,
    type: t.type,
    amount: money2(t.amount),
    currency: t.currency,
    date: isoDate(t.date),
    description: t.description,
    createdByName: t.createdByName,
  };
}

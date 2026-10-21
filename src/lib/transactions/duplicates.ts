import { prisma, type Tx } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { findPossibleDuplicates } from "@/lib/accounting/transactions";
import { txnRef } from "@/lib/ids";
import type { DuplicateWarning } from "./types";

type DuplicateInput = { type: string; amount: string; date: string; description: string };

/**
 * Possible duplicates for an entry, redacted for callers who may not view
 * other people's transactions: they learn that a similar entry exists, but not
 * its description or creator.
 */
export async function checkDuplicates(ctx: WorkspaceContext, input: DuplicateInput, excludeId?: string, db: Tx = prisma): Promise<DuplicateWarning[]> {
  const found = await findPossibleDuplicates(db, ctx, input, excludeId);
  if (!found.length) return [];
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");
  const owners = canViewAll
    ? new Map<string, string>()
    : new Map(
        (
          await db.transaction.findMany({
            where: { workspaceId: ctx.workspace.id, id: { in: found.map((d) => d.id) } },
            select: { id: true, createdById: true },
          })
        ).map((t) => [t.id, t.createdById]),
      );
  return found.slice(0, 10).map((d) => {
    const visible = canViewAll || owners.get(d.id) === ctx.user.id;
    return {
      id: visible ? d.id : null,
      ref: txnRef(d.number),
      date: d.date,
      amount: d.amount,
      description: visible ? d.description : null,
      enteredBy: visible ? d.createdByName : null,
      status: d.status,
      score: Math.round(d.score * 100) / 100,
      visible,
    };
  });
}

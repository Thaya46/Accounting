import { requireWorkspace } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/dates";
import { listApprovalQueue } from "@/lib/transactions/queries";
import type { ApprovalQueueItem } from "@/lib/transactions/types";
import { PageHeader } from "@/components/ui/feedback";
import { ApprovalQueueView } from "@/components/transactions/approval-queue";

export const metadata = { title: "Approvals" };

function ago(iso: string | null, now: number) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_APPROVE");
  const queue = await listApprovalQueue(ctx);
  const now = Date.now();
  const decorate = (i: ApprovalQueueItem) => ({ ...i, ageLabel: ago(i.actorAt, now), actorAtLabel: i.actorAt ? formatDateTime(i.actorAt, ctx.workspace.timeZone) : "" });

  return (
    <>
      <PageHeader
        title="Approvals"
        description={`${queue.pending.length} waiting for a decision · ${queue.approved.length} approved and waiting to be posted`}
      />
      <ApprovalQueueView
        workspaceId={workspaceId}
        pending={queue.pending.map(decorate)}
        approved={queue.approved.map(decorate)}
        canPost={ctx.permissions.has("TRANSACTION_POST")}
        isAdmin={ctx.membership.isAdmin}
      />
    </>
  );
}

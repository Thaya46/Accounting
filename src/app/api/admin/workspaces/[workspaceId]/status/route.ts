import { prisma } from "@/lib/db";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { adminApi } from "@/lib/admin/server";
import { workspaceStatusSchema } from "@/lib/admin/schemas";

/**
 * POST /api/admin/workspaces/:id/status — activate, suspend or archive a
 * workspace. Access is enforced on every request by the workspace guards, so a
 * suspended or archived workspace is closed to its members immediately.
 */
export const POST = route(async (req, { workspaceId }) => {
  const { actor, meta } = await adminApi();
  const body = await parseBody(req, workspaceStatusSchema);

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId ?? "" } });
    if (!ws) throw notFound("Workspace not found");
    if (ws.status === body.status) throw badRequest(`The workspace is already ${body.status.toLowerCase()}.`);

    const now = new Date();
    const data =
      body.status === "ACTIVE"
        ? { status: body.status, suspendedAt: null, archivedAt: null }
        : body.status === "SUSPENDED"
          ? { status: body.status, suspendedAt: now, archivedAt: null }
          : { status: body.status, archivedAt: now };

    // Optimistic guard against a concurrent status change.
    const res = await tx.workspace.updateMany({ where: { id: ws.id, status: ws.status }, data });
    if (res.count !== 1) throw badRequest("The workspace status changed in the meantime. Refresh and try again.");
    const updated = await tx.workspace.findUniqueOrThrow({ where: { id: ws.id } });

    await audit(tx, {
      workspaceId: ws.id,
      actor,
      entityType: "WORKSPACE",
      entityId: ws.id,
      action: "WORKSPACE_STATUS_CHANGED",
      reason: body.reason,
      before: { status: ws.status, suspendedAt: ws.suspendedAt, archivedAt: ws.archivedAt },
      after: { status: updated.status, suspendedAt: updated.suspendedAt, archivedAt: updated.archivedAt },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return updated;
  });

  return json({
    workspace: {
      id: workspace.id,
      status: workspace.status,
      suspendedAt: workspace.suspendedAt?.toISOString() ?? null,
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
    },
  });
});

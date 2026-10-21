import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, json, notFound, parseBody, route } from "@/lib/api";
import { audit, diff } from "@/lib/audit";
import { adminApi } from "@/lib/admin/server";
import { workspaceUpdateSchema } from "@/lib/admin/schemas";
import { getWorkspaceDetail } from "@/lib/admin/queries";

/** GET /api/admin/workspaces/:id — workspace profile, admins, pending admin invitations and usage counts. */
export const GET = route(async (_req, { workspaceId }) => {
  await adminApi();
  const detail = await getWorkspaceDetail(workspaceId ?? "");
  if (!detail) throw notFound("Workspace not found");
  return json(detail);
});

/** PATCH /api/admin/workspaces/:id — edits workspace information. Currency is locked once the ledger has entries. */
export const PATCH = route(async (req, { workspaceId }) => {
  const { actor, meta } = await adminApi();
  const body = await parseBody(req, workspaceUpdateSchema);

  const updated = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId ?? "" } });
    if (!ws) throw notFound("Workspace not found");
    if (ws.status === "ARCHIVED") throw badRequest("Archived workspaces are read-only. Activate the workspace to edit its details.");

    if (body.defaultCurrency && body.defaultCurrency !== ws.defaultCurrency) {
      const [txns, journals] = await Promise.all([
        tx.transaction.count({ where: { workspaceId: ws.id } }),
        tx.journalEntry.count({ where: { workspaceId: ws.id } }),
      ]);
      if (txns > 0 || journals > 0) {
        throw badRequest("The default currency cannot be changed after transactions or journal entries have been recorded.", { field: "defaultCurrency" });
      }
    }

    const before = {
      name: ws.name,
      companyName: ws.companyName,
      companyEmail: ws.companyEmail,
      country: ws.country,
      defaultCurrency: ws.defaultCurrency,
      fyStartMonth: ws.fyStartMonth,
      timeZone: ws.timeZone,
    };
    const changes = diff(before, body);
    if (!changes.changed) return { workspace: ws, changed: false };

    const workspace = await tx.workspace.update({ where: { id: ws.id }, data: changes.after as Prisma.WorkspaceUpdateInput });
    await audit(tx, {
      workspaceId: ws.id,
      actor,
      entityType: "WORKSPACE",
      entityId: ws.id,
      action: "WORKSPACE_UPDATED",
      before: changes.before,
      after: changes.after,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { workspace, changed: true };
  });

  const w = updated.workspace;
  return json({
    changed: updated.changed,
    workspace: {
      id: w.id,
      name: w.name,
      companyName: w.companyName,
      companyEmail: w.companyEmail,
      country: w.country,
      defaultCurrency: w.defaultCurrency,
      fyStartMonth: w.fyStartMonth,
      timeZone: w.timeZone,
      status: w.status,
      updatedAt: w.updatedAt.toISOString(),
    },
  });
});

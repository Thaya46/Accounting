import { apiWorkspace, json, parseQuery, route } from "@/lib/api";
import { auditFilterSchema, queryAuditEvents } from "@/lib/workspace-admin/audit-log";

/**
 * GET — workspace audit events (append-only), newest first, 50 per page.
 * Query: actor (user id), action, entity (entity type), q (TXN-0001 / transaction, entity, approval or reversal id),
 * from / to (YYYY-MM-DD, workspace time zone), page.
 */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "AUDIT_VIEW");
  const filters = parseQuery(req, auditFilterSchema);
  return json(await queryAuditEvents({ id: ctx.workspace.id, timeZone: ctx.workspace.timeZone }, filters));
});

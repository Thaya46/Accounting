import { apiWorkspace, json, route } from "@/lib/api";
import { loadPersonalDashboard, loadWorkspaceDashboard } from "@/lib/dashboard/queries";

/**
 * GET /api/w/:workspaceId/dashboard — permission-aware dashboard data.
 * Members with REPORTS_VIEW receive the workspace view; others only their own figures.
 */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId);
  if (ctx.permissions.has("REPORTS_VIEW")) {
    return json({ view: "workspace", currency: ctx.workspace.defaultCurrency, ...(await loadWorkspaceDashboard(ctx)) });
  }
  return json({ view: "personal", currency: ctx.workspace.defaultCurrency, ...(await loadPersonalDashboard(ctx)) });
});

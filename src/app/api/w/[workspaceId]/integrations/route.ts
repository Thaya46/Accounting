import { apiWorkspace, json, route } from "@/lib/api";
import { listAdapterSummaries } from "@/lib/export/integrations";

/** GET /api/w/[workspaceId]/integrations — every adapter with its status for this workspace (DATA_EXPORT or SETTINGS_MANAGE). */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, ["DATA_EXPORT", "SETTINGS_MANAGE"]);
  return json({ items: await listAdapterSummaries(ctx) });
});

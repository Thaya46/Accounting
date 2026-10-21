import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { exportRequestSchema } from "@/lib/export/filters";
import { previewExport } from "@/lib/export/service";

/** POST /api/w/[workspaceId]/export/preview — validation, status and file preview; nothing is stored (DATA_EXPORT). */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_EXPORT");
  const body = await parseBody(req, exportRequestSchema);
  return json(await previewExport(ctx, body));
});

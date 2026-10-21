import { apiWorkspace, badRequest, route } from "@/lib/api";
import { fileResponse } from "@/lib/export/http";
import { downloadExportFile } from "@/lib/export/service";

/** GET /api/w/[workspaceId]/export/[jobId]/download?file=data|audit — stored export or audit metadata file (DATA_EXPORT). */
export const GET = route(async (req, { workspaceId, jobId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_EXPORT");
  const which = req.nextUrl.searchParams.get("file") ?? "data";
  if (which !== "data" && which !== "audit") throw badRequest("file must be data or audit");
  return fileResponse(await downloadExportFile(ctx, jobId, which));
});

import { apiWorkspace, route } from "@/lib/api";
import { fileResponse } from "@/lib/export/http";
import { importErrorReport } from "@/lib/import/service";

/** GET /api/w/[workspaceId]/import/[jobId]/errors — CSV error report (DATA_IMPORT). */
export const GET = route(async (_req, { workspaceId, jobId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_IMPORT");
  const report = await importErrorReport(ctx, jobId);
  return fileResponse({ ...report, contentType: "text/csv" });
});

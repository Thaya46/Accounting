import { apiWorkspace, json, route } from "@/lib/api";
import { getImportJob } from "@/lib/import/service";

/** GET /api/w/[workspaceId]/import/[jobId] — job, stored preview, results and errors (DATA_IMPORT). */
export const GET = route(async (_req, { workspaceId, jobId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_IMPORT");
  return json(await getImportJob(ctx, jobId));
});

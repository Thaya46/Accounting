import { apiWorkspace, json, route } from "@/lib/api";
import { listImportJobs } from "@/lib/import/service";

/** GET /api/w/[workspaceId]/import — import history (DATA_IMPORT). */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_IMPORT");
  const take = Number(req.nextUrl.searchParams.get("take") ?? 50) || 50;
  return json({ items: await listImportJobs(ctx, take) });
});

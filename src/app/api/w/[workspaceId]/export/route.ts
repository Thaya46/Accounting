import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { exportRequestSchema } from "@/lib/export/filters";
import { generateExport, listExportJobs } from "@/lib/export/service";

/** GET /api/w/[workspaceId]/export — export history (DATA_EXPORT). */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_EXPORT");
  const take = Number(req.nextUrl.searchParams.get("take") ?? 50) || 50;
  return json({ items: await listExportJobs(ctx, take) });
});

/**
 * POST /api/w/[workspaceId]/export — validates and generates an export file plus
 * its audit metadata file, records an ExportJob, ExportJobItems and EXPORTED
 * audit events (DATA_EXPORT).
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_EXPORT");
  const body = await parseBody(req, exportRequestSchema);
  return json({ job: await generateExport(ctx, body) }, 201);
});

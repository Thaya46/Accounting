import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { confirmImportSchema } from "@/lib/import/analyze";
import { confirmImport } from "@/lib/import/service";

/**
 * POST /api/w/[workspaceId]/import/[jobId]/confirm —
 * `{ accountMap, categoryMap, skipDuplicates, postBalanced, acknowledgeWorkspaceMismatch }`.
 * Creates transactions as the authenticated importer (source IMPORT); the file's creator is kept
 * only as external provenance. postBalanced requires TRANSACTION_POST (DATA_IMPORT).
 */
export const POST = route(async (req, { workspaceId, jobId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_IMPORT");
  const body = await parseBody(req, confirmImportSchema);
  return json(await confirmImport(ctx, jobId, body));
});

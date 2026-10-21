import { z } from "zod";
import { ApiError, apiWorkspace, json, parseBody, route } from "@/lib/api";
import { MAX_IMPORT_BYTES } from "@/lib/import/analyze";
import { previewImport } from "@/lib/import/service";

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().max(MAX_IMPORT_BYTES, "The file is larger than 5 MB."),
});

/**
 * POST /api/w/[workspaceId]/import/preview — `{ fileName, content }` (file text, ≤ 5 MB).
 * Validates the canonical JSON, checks workspace, accounts, categories and duplicates,
 * and stores an ImportJob in PREVIEW status (DATA_IMPORT).
 */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "DATA_IMPORT");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES * 2 + 4096) throw new ApiError(413, "The file is larger than 5 MB.", "PAYLOAD_TOO_LARGE");
  const body = await parseBody(req, bodySchema);
  return json(await previewImport(ctx, body), 201);
});

import { z } from "zod";
import { json, parseQuery, route } from "@/lib/api";
import { adminApi } from "@/lib/admin/server";
import { listActivity, platformTimeZone } from "@/lib/admin/queries";

const query = z.object({
  q: z.string().max(100).optional(),
  actor: z.string().max(100).optional(),
  workspace: z.string().max(64).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  entity: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

/**
 * GET /api/admin/activity — system-wide audit log (read-only, 50 per page).
 * `workspace=platform` returns platform-level events only. Payloads of
 * financial records are redacted for the Super Admin.
 */
export const GET = route(async (req) => {
  await adminApi();
  const filters = parseQuery(req, query);
  return json(await listActivity(filters, await platformTimeZone()));
});

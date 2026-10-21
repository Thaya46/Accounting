import { z } from "zod";
import { apiSuperAdmin, json, parseBody, route } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import { ADAPTER_CATALOG, type AdapterKey } from "@/lib/export/adapter-keys";
import { listPlatformAdapters, setPlatformAdapterEnabled } from "@/lib/export/integrations";

/** GET /api/admin/integrations — all adapters, platform availability and 30-day usage counts (Super Admin). */
export const GET = route(async () => {
  await apiSuperAdmin();
  return json({ items: await listPlatformAdapters() });
});

const patchSchema = z.object({
  key: z.enum(ADAPTER_CATALOG.map((a) => a.key) as [AdapterKey, ...AdapterKey[]]),
  enabled: z.boolean(),
});

/** PATCH /api/admin/integrations — `{ key, enabled }` toggles platform availability (audited as INTEGRATION_ADAPTER_UPDATED). */
export const PATCH = route(async (req) => {
  const { user } = await apiSuperAdmin();
  const body = await parseBody(req, patchSchema);
  const item = await setPlatformAdapterEnabled({ id: user.id, name: user.name, email: user.email }, body.key, body.enabled, await requestMeta());
  return json({ item });
});

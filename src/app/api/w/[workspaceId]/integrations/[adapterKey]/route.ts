import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { getIntegrationDetail, integrationUpdateSchema, updateIntegration } from "@/lib/export/integrations";

/** GET /api/w/[workspaceId]/integrations/[adapterKey] — adapter spec, status, configuration and account mappings (DATA_EXPORT or SETTINGS_MANAGE). */
export const GET = route(async (_req, { workspaceId, adapterKey }) => {
  const ctx = await apiWorkspace(workspaceId, ["DATA_EXPORT", "SETTINGS_MANAGE"]);
  return json(await getIntegrationDetail(ctx, adapterKey));
});

/**
 * PUT /api/w/[workspaceId]/integrations/[adapterKey] — body `{ config?, mappings?: [{accountId, externalCode, externalName?}] }`.
 * Configuration needs SETTINGS_MANAGE; account mappings need DATA_EXPORT or SETTINGS_MANAGE. Empty externalCode removes a mapping.
 */
export const PUT = route(async (req, { workspaceId, adapterKey }) => {
  const ctx = await apiWorkspace(workspaceId, ["DATA_EXPORT", "SETTINGS_MANAGE"]);
  const body = await parseBody(req, integrationUpdateSchema);
  const result = await updateIntegration(ctx, adapterKey, body);
  return json({ ...result, ...(await getIntegrationDetail(ctx, adapterKey)) });
});

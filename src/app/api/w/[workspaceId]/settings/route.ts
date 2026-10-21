import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { serializeSettings, serializeWorkspaceInfo, settingsPatchSchema, updateSettings } from "@/lib/workspace-admin/settings";

/** GET — workspace profile (read-only, managed by the Super Admin) and accounting/workflow settings. */
export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "SETTINGS_MANAGE");
  return json({ workspace: serializeWorkspaceInfo(ctx.workspace), settings: serializeSettings(ctx.workspace.settings) });
});

/**
 * PATCH — update settings. Body: any of { autoPostEnabled, autoPostMinConfidence (0.5–1), requireApproval,
 * approvalThreshold (amount string | null), duplicateWindowDays (0–30), mfaRequiredForUsers, dailySummaryEmail, monthlySummaryEmail }
 */
export const PATCH = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "SETTINGS_MANAGE");
  const body = await parseBody(req, settingsPatchSchema);
  return json(await updateSettings(ctx, body));
});

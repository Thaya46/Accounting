import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { sendSummaryNow, summarySchema } from "@/lib/workspace-admin/settings";

/** POST — email today's (daily) or this month's (monthly) posted totals to every active Workspace Admin. Body: { period } */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "SETTINGS_MANAGE");
  const body = await parseBody(req, summarySchema);
  return json(await sendSummaryNow(ctx, body.period));
});

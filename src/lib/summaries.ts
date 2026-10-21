import { prisma } from "@/lib/db";
import { sendWorkspaceSummary } from "@/lib/workspace-admin/settings";

/**
 * Sends the scheduled daily (previous day) or monthly (previous month) summary
 * to every active workspace that has opted in. Run once per period from a
 * scheduler: `npm run summaries -- daily` or `POST /api/cron/summaries?period=daily`.
 */
export async function runScheduledSummaries(period: "daily" | "monthly") {
  const workspaces = await prisma.workspace.findMany({
    where: { status: "ACTIVE", settings: period === "daily" ? { dailySummaryEmail: true } : { monthlySummaryEmail: true } },
    select: { id: true, name: true, timeZone: true, defaultCurrency: true },
  });
  const results = [];
  for (const ws of workspaces) {
    try {
      const r = await sendWorkspaceSummary(ws, period, "previous", { actor: { id: null, name: "System (scheduled summary)" } });
      results.push({ workspace: ws.name, label: r.label, recipients: r.recipients.length, statuses: r.recipients.map((x) => x.status) });
    } catch (err) {
      results.push({ workspace: ws.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

import { z } from "zod";
import { apiWorkspace, json, notFound, parseQuery, route } from "@/lib/api";
import { loadReport, reportDef } from "@/lib/dashboard/report-data";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const querySchema = z.object({
  period: z.enum(["fy", "prev-fy", "this-month", "last-month", "custom"]).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  asOf: isoDay.optional(),
  accountId: z.string().trim().min(1).max(64).optional(),
});

/**
 * GET /api/w/:workspaceId/reports/:report?period=&from=&to=&asOf=&accountId=
 * Same data as the report pages, computed from posted journal entries only.
 */
export const GET = route(async (req, { workspaceId, report }) => {
  const ctx = await apiWorkspace(workspaceId, "REPORTS_VIEW");
  const def = reportDef(report ?? "");
  if (!def) throw notFound("Unknown report");
  const q = parseQuery(req, querySchema);
  const result = await loadReport(ctx, def.slug, q);
  if (result.slug === "general-ledger" && q.accountId && !result.data) throw notFound("Account not found");
  return json({ report: def.slug, title: def.title, basis: "posted journal entries", ...result });
});

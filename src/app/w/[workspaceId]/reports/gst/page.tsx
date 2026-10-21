import { requireWorkspace } from "@/lib/auth/guards";
import { tallyGstSummary } from "@/lib/accounting/tally-reports";
import { financialYearFor, todayInTimeZone } from "@/lib/dates";
import { PageHeader } from "@/components/ui/feedback";
import { GstSummaryView } from "@/components/tally/gst-summary-view";

export const metadata = { title: "GST Summary (GSTR-1 & GSTR-3B)" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "REPORTS_VIEW");
  const ws = ctx.workspace;

  const today = todayInTimeZone(ws.timeZone);
  const fy = financialYearFor(today, ws.fyStartMonth);
  const from = sp.from || fy.from;
  const to = sp.to || fy.to;

  const data = await tallyGstSummary(ws.id, from, to);

  return (
    <>
      <PageHeader
        title="GST Summary & Returns"
        description={`Gateway of Tally › Display More Reports › Statutory Reports › GST Reports. GSTR-1 & GSTR-3B tax summary for ${ws.name}.`}
      />
      <GstSummaryView
        currency={ws.defaultCurrency}
        period={{ from, to }}
        totalTaxable={data.totalTaxable}
        totalCgst={data.totalCgst}
        totalSgst={data.totalSgst}
        totalIgst={data.totalIgst}
        totalTax={data.totalTax}
        outwardCount={data.outwardCount}
        inwardCount={data.inwardCount}
        outwardSupplies={data.outwardSupplies}
        inwardSupplies={data.inwardSupplies}
      />
    </>
  );
}

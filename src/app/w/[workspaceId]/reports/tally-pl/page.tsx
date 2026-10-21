import { requireWorkspace } from "@/lib/auth/guards";
import { tallyTradingAndPnL } from "@/lib/accounting/tally-reports";
import { financialYearFor, todayInTimeZone } from "@/lib/dates";
import { PageHeader } from "@/components/ui/feedback";
import { TradingPnlView } from "@/components/tally/trading-pnl-view";

export const metadata = { title: "Trading & Profit and Loss A/c" };

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

  const data = await tallyTradingAndPnL(ws.id, from, to);

  return (
    <>
      <PageHeader
        title="Trading & Profit and Loss Account"
        description={`Gateway of Tally › Profit & Loss A/c. Standard double-entry statement for ${ws.name} (${fy.label}).`}
      />
      <TradingPnlView
        currency={ws.defaultCurrency}
        period={{ from, to }}
        trading={data.trading}
        pl={data.pl}
      />
    </>
  );
}

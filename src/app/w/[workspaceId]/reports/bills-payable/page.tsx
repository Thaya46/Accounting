import { requireWorkspace } from "@/lib/auth/guards";
import { tallyOutstandingBills } from "@/lib/accounting/tally-reports";
import { todayInTimeZone } from "@/lib/dates";
import { PageHeader } from "@/components/ui/feedback";
import { OutstandingView } from "@/components/tally/outstanding-view";

export const metadata = { title: "Bills Payable (Outstanding)" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "REPORTS_VIEW");
  const ws = ctx.workspace;

  const asOf = sp.asOf || todayInTimeZone(ws.timeZone);
  const data = await tallyOutstandingBills(ws.id, "CREDITOR", asOf);

  return (
    <>
      <PageHeader
        title="Bills Payable (Outstanding)"
        description={`Gateway of Tally › Display More Reports › Statements of Accounts › Outstandings › Payables. Aging analysis of all supplier liabilities for ${ws.name}.`}
      />
      <OutstandingView
        workspaceId={ws.id}
        currency={ws.defaultCurrency}
        asOf={data.asOf}
        partyType="CREDITOR"
        totalPending={data.totalPending}
        total0To30={data.total0To30}
        total31To60={data.total31To60}
        total61To90={data.total61To90}
        totalAbove90={data.totalAbove90}
        parties={data.parties}
      />
    </>
  );
}

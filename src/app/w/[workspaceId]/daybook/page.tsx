import { requireWorkspace } from "@/lib/auth/guards";
import { loadDayBook } from "@/lib/accounting/daybook";
import { todayInTimeZone } from "@/lib/dates";
import { PageHeader } from "@/components/ui/feedback";
import { DayBookView } from "@/components/tally/daybook-view";

export const metadata = { title: "Tally Day Book" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ date?: string; type?: string; search?: string }>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_VIEW");
  const ws = ctx.workspace;

  const targetDate = sp.date || todayInTimeZone(ws.timeZone);
  const data = await loadDayBook(ws.id, {
    date: targetDate,
    voucherType: sp.type,
    search: sp.search,
  });

  return (
    <>
      <PageHeader
        title="Day Book"
        description={`Gateway of Tally › Display More Reports › Day Book. Complete register of all vouchers for ${data.date}.`}
      />
      <DayBookView
        workspaceId={ws.id}
        currency={ws.defaultCurrency}
        date={data.date}
        totalDebit={data.totalDebit}
        totalCredit={data.totalCredit}
        count={data.count}
        entries={data.entries}
      />
    </>
  );
}

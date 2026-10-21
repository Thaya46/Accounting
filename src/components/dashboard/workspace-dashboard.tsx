import Link from "next/link";
import { BarChart3, Landmark, PieChart, Scale, TrendingDown, TrendingUp, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { QuickEntry } from "@/components/transactions/quick-entry";
import { ChartStyles } from "@/components/charts/chart-theme";
import { TrendChart } from "@/components/charts/trend-chart";
import { CategoryBars } from "@/components/charts/category-bars";
import { UserActivityChart } from "@/components/charts/user-activity-chart";
import { formatMoney } from "@/lib/money";
import type { WorkspaceDashboardData } from "@/lib/dashboard/queries";
import { KpiCard } from "./kpi-card";
import {
  BalancesCard,
  ExportHistoryCard,
  PendingApprovalsCard,
  RecentTransactionsCard,
  SectionCard,
  UserActivityTable,
} from "./widgets";

export function WorkspaceDashboard({
  workspaceId,
  data,
  currency,
  timeZone,
  canCreate,
}: {
  workspaceId: string;
  data: WorkspaceDashboardData;
  currency: string;
  timeZone: string;
  canCreate: boolean;
}) {
  const reportsHref = `/w/${workspaceId}/reports`;
  const pl = `${reportsHref}/profit-and-loss?period=fy`;
  const changeLabel = `vs ${data.comparison.label}`;
  const noPrior = <span>No {data.comparison.prevLabel} figures to compare</span>;
  const net = Number(data.kpis.netProfit.value);
  const trendHasData = data.trend.some((t) => t.income !== 0 || t.expenses !== 0);
  const userRows = data.byUser.slice(0, 8);

  return (
    <div className="space-y-6">
      <ChartStyles />
      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total income"
          value={data.kpis.income.value}
          currency={currency}
          icon={TrendingUp}
          change={data.kpis.income.change}
          changeLabel={changeLabel}
          footnote={noPrior}
          href={pl}
        />
        <KpiCard
          label="Total expenses"
          value={data.kpis.expenses.value}
          currency={currency}
          icon={TrendingDown}
          change={data.kpis.expenses.change}
          changeLabel={changeLabel}
          upIsGood={false}
          footnote={noPrior}
          href={pl}
        />
        <KpiCard
          label={net < 0 ? "Net loss" : "Net profit"}
          value={data.kpis.netProfit.value}
          currency={currency}
          icon={Scale}
          change={data.kpis.netProfit.change}
          changeLabel={changeLabel}
          valueTone={net > 0 ? "income" : net < 0 ? "expense" : null}
          footnote={noPrior}
          href={pl}
        />
        <KpiCard
          label="Cash & bank"
          value={data.balances.cashTotal}
          currency={currency}
          icon={Landmark}
          footnote={
            <span>
              {data.balances.accounts.filter((a) => a.subtype !== "CREDIT_CARD").length} accounts
              {data.balances.hasCards && ` · card dues ${formatMoney(data.balances.cardTotal, currency)}`}
            </span>
          }
          href={`${reportsHref}/balance-sheet`}
        />
      </section>

      {canCreate && (
        <section aria-label="Quick entry" className="grid gap-4 md:grid-cols-2">
          <QuickEntry workspaceId={workspaceId} mode="voice" />
          <QuickEntry workspaceId={workspaceId} mode="text" />
        </section>
      )}

      {!data.hasPostings && (
        <EmptyState
          icon={BarChart3}
          title="No posted entries yet"
          description="Figures, charts and reports are generated from posted journal entries. Post your first transaction or set opening balances to see them here."
          className="rounded-xl border border-dashed bg-card"
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Monthly financial trends"
          description="Income vs expenses over the last 12 months, from posted entries"
          className="lg:col-span-2"
          action={
            <Link href={`${reportsHref}/profit-and-loss`} className="hidden shrink-0 text-sm font-medium text-primary hover:underline sm:inline">
              P&amp;L report
            </Link>
          }
        >
          {trendHasData ? (
            <TrendChart data={data.trend} currency={currency} />
          ) : (
            <EmptyState icon={BarChart3} title="No income or expenses in the last 12 months" className="py-14" />
          )}
        </SectionCard>
        <BalancesCard workspaceId={workspaceId} data={data.balances} currency={currency} asOf={data.today} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Expense category breakdown"
          description={
            Number(data.breakdown.total) > 0 ? (
              <>
                {data.fy.label} · total <span className="tabular">{formatMoney(data.breakdown.total, currency)}</span>
              </>
            ) : (
              data.fy.label
            )
          }
        >
          {data.breakdown.items.length ? (
            <CategoryBars items={data.breakdown.items} currency={currency} />
          ) : (
            <EmptyState icon={PieChart} title="No expenses posted this financial year" className="py-10" />
          )}
        </SectionCard>

        <SectionCard title="Transactions by user" description={`${data.fy.label} · entries recorded and posted amounts per user`}>
          {data.byUser.length ? (
            <div className="space-y-4">
              <UserActivityChart
                currency={currency}
                data={userRows.map((r) => ({ userId: r.userId, name: r.name, count: r.count, income: Number(r.income), expenses: Number(r.expenses) }))}
              />
              <div className="-mx-5">
                <UserActivityTable rows={data.byUser} currency={currency} />
              </div>
              {data.byUser.length > userRows.length && (
                <p className="text-xs text-muted-foreground">Chart shows the 8 most active users; the table lists everyone.</p>
              )}
            </div>
          ) : (
            <EmptyState icon={Users} title="No transactions recorded this financial year" className="py-10" />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <RecentTransactionsCard workspaceId={workspaceId} items={data.recent.items} scope={data.recent.scope} canCreate={canCreate} className="xl:col-span-2" />
        <div className="grid content-start gap-4">
          <PendingApprovalsCard workspaceId={workspaceId} data={data.pending} />
          {data.exports && <ExportHistoryCard workspaceId={workspaceId} items={data.exports} timeZone={timeZone} />}
        </div>
      </div>
    </div>
  );
}

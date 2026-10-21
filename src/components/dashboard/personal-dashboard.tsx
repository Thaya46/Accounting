import Link from "next/link";
import { Clock, FilePen, ListChecks, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { QuickEntry } from "@/components/transactions/quick-entry";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PersonalDashboardData } from "@/lib/dashboard/queries";
import { ActivityFeed, RecentTransactionsCard, SectionCard } from "./widgets";

function TotalTile({
  label,
  value,
  count,
  currency,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  count: number;
  currency: string;
  tone: "income" | "expense";
  icon: typeof TrendingUp;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tone === "income" ? "bg-income-soft text-income" : "bg-expense-soft text-expense")}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tracking-tight">{formatMoney(value, currency)}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {count} posted {count === 1 ? "entry" : "entries"} this financial year
      </p>
    </Card>
  );
}

function CountTile({ label, value, icon: Icon, href, tone }: { label: string; value: number; icon: typeof Clock; href: string; tone?: "warning" | "danger" }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
          tone === "warning" && value > 0 && "bg-warning-soft text-warning",
          tone === "danger" && value > 0 && "bg-expense-soft text-expense",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

export function PersonalDashboard({
  workspaceId,
  data,
  currency,
  timeZone,
  canCreate,
}: {
  workspaceId: string;
  data: PersonalDashboardData;
  currency: string;
  timeZone: string;
  canCreate: boolean;
}) {
  const mine = `/w/${workspaceId}/transactions/mine`;
  return (
    <div className="space-y-6">
      {canCreate && (
        <section aria-label="Quick entry" className="grid gap-4 md:grid-cols-2">
          <QuickEntry workspaceId={workspaceId} mode="voice" />
          <QuickEntry workspaceId={workspaceId} mode="text" />
        </section>
      )}

      <section aria-label="My totals" className="grid gap-4 sm:grid-cols-2">
        <TotalTile label="My recorded income" value={data.totals.income} count={data.totals.incomeCount} currency={currency} tone="income" icon={TrendingUp} />
        <TotalTile label="My recorded expenses" value={data.totals.expenses} count={data.totals.expenseCount} currency={currency} tone="expense" icon={TrendingDown} />
      </section>

      <section aria-label="My entries by status" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CountTile label="All my transactions" value={data.counts.total} icon={ListChecks} href={mine} />
        <CountTile label="Drafts" value={data.counts.draft} icon={FilePen} href={`${mine}?status=DRAFT`} />
        <CountTile label="Pending approval" value={data.counts.pending} icon={Clock} href={`${mine}?status=PENDING_APPROVAL`} tone="warning" />
        <CountTile label="Rejected" value={data.counts.rejected} icon={XCircle} href={`${mine}?status=REJECTED`} tone="danger" />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <RecentTransactionsCard
          workspaceId={workspaceId}
          items={data.recent}
          scope="mine"
          canCreate={canCreate}
          title="My transactions"
          showEnteredBy={false}
          className="xl:col-span-2"
        />
        <SectionCard title="Recent activity" description="Your actions and updates on your transactions">
          <ActivityFeed workspaceId={workspaceId} items={data.activity} timeZone={timeZone} />
        </SectionCard>
      </div>
    </div>
  );
}

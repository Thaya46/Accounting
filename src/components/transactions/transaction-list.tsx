import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Hash, Inbox, Scale, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { dec, formatMoney } from "@/lib/money";
import { activeFilterCount, filtersToQuery, type TransactionFilters } from "@/lib/transactions/filters";
import type { MemberOption, TransactionListResult } from "@/lib/transactions/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { TransactionFilterBar } from "./transaction-filters";
import { TransactionsTable } from "./transactions-table";

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone?: "income" | "expense" | "neutral" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tone === "income" ? "bg-income-soft text-income" : tone === "expense" ? "bg-expense-soft text-expense" : "bg-accent text-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("tabular truncate text-base font-semibold sm:text-lg", tone === "income" && "text-income", tone === "expense" && "text-expense")}>{value}</p>
      </div>
    </div>
  );
}

/** Totals strip + filter bar + table + pagination, shared by "All" and "My" transactions. */
export function TransactionListSection({
  workspaceId,
  basePath,
  result,
  filters,
  categories,
  members,
  showEnteredBy,
  resolvedRange,
  emptyAction,
  emptyDescription,
}: {
  workspaceId: string;
  basePath: string;
  result: TransactionListResult;
  filters: TransactionFilters;
  categories: { id: string; name: string; kind: "INCOME" | "EXPENSE"; isActive: boolean }[];
  members: MemberOption[];
  showEnteredBy: boolean;
  resolvedRange: { from?: string; to?: string };
  emptyAction?: React.ReactNode;
  emptyDescription: string;
}) {
  const { totals } = result;
  const net = dec(totals.net);
  const hasFilters = activeFilterCount(filters) > 0;
  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.total, result.page * result.pageSize);
  const pageHref = (p: number) => `${basePath}${filtersToQuery({ ...filters, page: p })}`;

  return (
    <>
      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Income" value={formatMoney(totals.income, totals.currency)} icon={ArrowDownLeft} tone="income" />
        <Stat label="Expenses" value={formatMoney(totals.expense, totals.currency)} icon={ArrowUpRight} tone="expense" />
        <Stat label="Net" value={`${net.isNegative() ? "−" : ""}${formatMoney(net.abs().toString(), totals.currency)}`} icon={Scale} tone={net.isNegative() ? "expense" : net.isZero() ? "neutral" : "income"} />
        <Stat label="Transactions" value={totals.count.toLocaleString("en-IN")} icon={Hash} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Totals in {totals.currency} for the {hasFilters ? "filtered" : "listed"} transactions{totals.excludesInactive ? ", excluding reversed and rejected entries" : ""}.
      </p>

      <TransactionFilterBar filters={filters} members={members} categories={categories} showEnteredBy={showEnteredBy} resolvedRange={resolvedRange} />

      <Card className="overflow-hidden">
        {result.rows.length ? (
          <TransactionsTable workspaceId={workspaceId} rows={result.rows} filters={filters} />
        ) : hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="No transactions match these filters"
            description="Try widening the date range or removing a filter."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={basePath}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Inbox} title="No transactions yet" description={emptyDescription} action={emptyAction} />
        )}
        {result.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm sm:flex-row">
            <p className="text-muted-foreground">
              Showing <span className="tabular font-medium text-foreground">{from.toLocaleString("en-IN")}</span>–
              <span className="tabular font-medium text-foreground">{to.toLocaleString("en-IN")}</span> of{" "}
              <span className="tabular font-medium text-foreground">{result.total.toLocaleString("en-IN")}</span>
            </p>
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(result.page - 1)} scroll={false}>
                    <ChevronLeft /> Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <ChevronLeft /> Previous
                </Button>
              )}
              <span className="tabular text-xs text-muted-foreground">
                Page {result.page} of {result.pageCount}
              </span>
              {result.page < result.pageCount ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(result.page + 1)} scroll={false}>
                    Next <ChevronRight />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next <ChevronRight />
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

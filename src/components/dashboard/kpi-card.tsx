import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatPct } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

/**
 * Stat tile: label · value (proportional figures) · optional delta vs a named
 * period, coloured by direction × whether "up" is good, always with an arrow
 * icon and text so colour never carries the meaning alone.
 */
export function KpiCard({
  label,
  value,
  currency,
  icon: Icon,
  change,
  changeLabel,
  upIsGood = true,
  valueTone,
  footnote,
  href,
}: {
  label: string;
  value: string;
  currency: string;
  icon: LucideIcon;
  change?: number | null;
  changeLabel?: string;
  upIsGood?: boolean;
  valueTone?: "income" | "expense" | null;
  footnote?: React.ReactNode;
  href?: string;
}) {
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const direction = !hasChange || Math.abs(change!) < 0.05 ? 0 : change! > 0 ? 1 : -1;
  const good = direction === 0 ? null : (direction > 0) === upIsGood;
  const DeltaIcon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : Minus;

  const body = (
    <Card className={cn("group relative h-full overflow-hidden p-5 transition-all duration-200", href && "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover")}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl transition-opacity group-hover:opacity-100",
          valueTone === "income" ? "bg-emerald-500/15" : valueTone === "expense" ? "bg-rose-500/15" : "bg-indigo-500/15",
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
            valueTone === "income"
              ? "bg-income-soft text-income ring-income/20"
              : valueTone === "expense"
                ? "bg-expense-soft text-expense ring-expense/20"
                : "bg-accent text-primary ring-primary/15",
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      <p
        className={cn(
          "relative mt-3 truncate text-[1.7rem] font-semibold leading-none tracking-tight",
          valueTone === "income" && "text-income",
          valueTone === "expense" && "text-expense",
        )}
        title={formatMoney(value, currency, { decimals: true })}
      >
        {formatMoney(value, currency)}
      </p>
      <div className="relative mt-3 min-h-5 text-xs text-muted-foreground">
        {hasChange ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className={cn("inline-flex items-center gap-0.5 font-medium", good === true && "text-income", good === false && "text-expense")}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {formatPct(change!)}
            </span>
            <span>{changeLabel}</span>
          </span>
        ) : (
          footnote
        )}
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

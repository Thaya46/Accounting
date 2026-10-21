"use client";

import { motion, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { VIZ } from "./chart-theme";

export type CategoryItem = { name: string; amount: string; share: number; isOther: boolean; count: number };

/**
 * Ranked horizontal bars (one series, one hue) for a part-to-whole breakdown.
 * Every bar carries its value and share at the tip, so the bars double as the
 * table view; the folded "Other" bar is drawn in a de-emphasised tone.
 */
export function CategoryBars({ items, currency, className }: { items: CategoryItem[]; currency: string; className?: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(...items.map((i) => Number(i.amount)), 0);
  return (
    <ul className={cn("vl-viz space-y-3", className)} aria-label="Expenses by category">
      {items.map((item, idx) => {
        const pct = max > 0 ? Math.max((Number(item.amount) / max) * 100, 1.5) : 0;
        return (
          <li key={item.name + idx}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={item.name}>
                {item.isOther ? `Other (${item.count} categories)` : item.name}
              </span>
              <span className="shrink-0 text-right">
                <span className="tabular font-medium">{formatMoney(item.amount, currency)}</span>
                <span className="tabular ml-2 inline-block w-11 text-xs text-muted-foreground">{item.share.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-2.5 w-full" aria-hidden>
              <motion.div
                className="h-full rounded-r-[4px]"
                style={{ background: item.isOther ? VIZ.axis : VIZ.expense, opacity: item.isOther ? 0.55 : 1 }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: reduce ? 0 : idx * 0.04 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import * as React from "react";
import type { TooltipProps } from "recharts";
import { formatMoney } from "@/lib/money";

export type SeriesSpec = Record<string, { label: string; color: string; kind?: "bar" | "line" }>;

/**
 * Tooltip for money series: one readout listing every series at the hovered
 * position. Values lead (strong), series names follow; series are keyed with a
 * short stroke of their color rather than a filled box.
 */
export function MoneyTooltip({
  active,
  payload,
  label,
  currency,
  series,
  footer,
}: TooltipProps<number, string> & {
  currency: string;
  series: SeriesSpec;
  footer?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const row = (payload[0]?.payload ?? {}) as Record<string, unknown>;
  const title = typeof row.fullName === "string" ? row.fullName : label;
  return (
    <div className="min-w-[168px] rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {payload.map((p) => {
          const key = String(p.dataKey ?? p.name ?? "");
          const s = series[key];
          if (!s) return null;
          return (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="tabular text-sm font-semibold">{formatMoney(Number(p.value ?? 0), currency)}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </li>
          );
        })}
      </ul>
      {footer && <div className="mt-1.5 border-t pt-1.5 text-xs text-muted-foreground">{footer(row)}</div>}
    </div>
  );
}

/** Small segmented control to switch a chart to its table view (the accessible twin). */
export function ViewToggle({ view, onChange, label }: { view: "chart" | "table"; onChange: (v: "chart" | "table") => void; label: string }) {
  return (
    <div role="group" aria-label={`${label} view`} className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs print:hidden">
      {(["chart", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={
            "cursor-pointer rounded px-2 py-0.5 font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
            (view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
        >
          {v}
        </button>
      ))}
    </div>
  );
}

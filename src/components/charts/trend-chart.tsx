"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ANIMATION_MS, AXIS_TICK, LegendKey, VIZ } from "./chart-theme";
import { MoneyTooltip, ViewToggle, type SeriesSpec } from "./chart-tooltip";
import { niceTicks } from "./scale";

export type TrendPoint = { month: string; label: string; income: number; expenses: number; net: number };

const SERIES: SeriesSpec = {
  income: { label: "Income", color: VIZ.income, kind: "bar" },
  expenses: { label: "Expenses", color: VIZ.expense, kind: "bar" },
  net: { label: "Net", color: VIZ.net, kind: "line" },
};

/** Monthly income vs expenses (columns) with net as a line, on one money axis. */
export function TrendChart({ data, currency, className }: { data: TrendPoint[]; currency: string; className?: string }) {
  const reduce = useReducedMotion();
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const hasNegative = data.some((d) => d.net < 0 || d.income < 0 || d.expenses < 0);
  const totals = data.reduce((s, d) => ({ income: s.income + d.income, expenses: s.expenses + d.expenses }), { income: 0, expenses: 0 });
  const ticks = niceTicks(data.flatMap((d) => [d.income, d.expenses, d.net]));
  const first = data[0]?.label ?? "";
  const last = data[data.length - 1]?.label ?? "";

  return (
    <div className={cn("vl-viz", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendKey color={VIZ.income} label="Income" />
          <LegendKey color={VIZ.expense} label="Expenses" />
          <LegendKey color={VIZ.net} kind="line" label="Net" />
        </div>
        <ViewToggle view={view} onChange={setView} label="Monthly trend" />
      </div>
      {view === "chart" ? (
        <div
          className="h-[280px] w-full"
          role="img"
          aria-label={`Monthly income and expenses from ${first} to ${last}. Total income ${formatMoney(totals.income, currency)}, total expenses ${formatMoney(totals.expenses, currency)}. Switch to the table view for every value.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={VIZ.grid} strokeWidth={1} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: VIZ.grid }} interval="preserveStartEnd" minTickGap={10} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={68}
                ticks={ticks}
                domain={[ticks[0]!, ticks[ticks.length - 1]!]}
                interval={0}
                tickFormatter={(v: number) => formatCompact(v, currency)}
              />
              {hasNegative && <ReferenceLine y={0} stroke={VIZ.axis} strokeOpacity={0.6} />}
              <Tooltip cursor={{ fill: VIZ.cursor, opacity: 0.7 }} content={<MoneyTooltip currency={currency} series={SERIES} />} />
              <Bar dataKey="income" name="income" fill={VIZ.income} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} animationDuration={ANIMATION_MS} />
              <Bar dataKey="expenses" name="expenses" fill={VIZ.expense} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} animationDuration={ANIMATION_MS} />
              <Line
                type="monotone"
                dataKey="net"
                name="net"
                stroke={VIZ.net}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 4, fill: VIZ.net, stroke: VIZ.surface, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: VIZ.net, stroke: VIZ.surface, strokeWidth: 2 }}
                isAnimationActive={!reduce}
                animationDuration={ANIMATION_MS}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="relative max-h-[280px] overflow-auto scrollbar-thin rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Monthly income, expenses and net</caption>
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Month</th>
                <th className="px-3 py-2 text-right font-semibold">Income</th>
                <th className="px-3 py-2 text-right font-semibold">Expenses</th>
                <th className="px-3 py-2 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-t">
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(d.income, currency)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(d.expenses, currency)}</td>
                  <td className={cn("tabular px-3 py-1.5 text-right font-medium", d.net < 0 ? "text-expense" : d.net > 0 ? "text-income" : "")}>
                    {formatMoney(d.net, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

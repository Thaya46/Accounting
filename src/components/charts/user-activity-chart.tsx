"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact } from "@/lib/money";
import { ANIMATION_MS, AXIS_TICK, LegendKey, VIZ } from "./chart-theme";
import { MoneyTooltip, type SeriesSpec } from "./chart-tooltip";
import { niceTicks } from "./scale";

export type UserActivityPoint = { userId: string; name: string; count: number; income: number; expenses: number };

const SERIES: SeriesSpec = {
  income: { label: "Income", color: VIZ.income },
  expenses: { label: "Expenses", color: VIZ.expense },
};

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function NameTick(props: { x?: number; y?: number; payload?: { value: string } }) {
  const { x = 0, y = 0, payload } = props;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={VIZ.axis} fontSize={12}>
      {truncate(payload?.value ?? "", 14)}
    </text>
  );
}

/** Posted income and expenses per user (horizontal grouped bars, one money axis). */
export function UserActivityChart({ data, currency }: { data: UserActivityPoint[]; currency: string }) {
  const reduce = useReducedMotion();
  const rows = data.map((d) => ({ ...d, fullName: d.name }));
  const height = Math.max(rows.length * 52, 104) + 28;
  const ticks = niceTicks(rows.flatMap((r) => [r.income, r.expenses]));
  return (
    <div className="vl-viz">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <LegendKey color={VIZ.income} label="Posted income" />
        <LegendKey color={VIZ.expense} label="Posted expenses" />
      </div>
      <div style={{ height }} className="w-full" role="img" aria-label="Posted income and expenses by user. The table below lists every value.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="26%">
            <CartesianGrid horizontal={false} stroke={VIZ.grid} strokeWidth={1} />
            <XAxis
              type="number"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
              domain={[ticks[0]!, ticks[ticks.length - 1]!]}
              interval={0}
              tickFormatter={(v: number) => formatCompact(v, currency)}
            />
            <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={{ stroke: VIZ.grid }} tick={<NameTick />} interval={0} />
            <Tooltip
              cursor={{ fill: VIZ.cursor, opacity: 0.7 }}
              content={
                <MoneyTooltip
                  currency={currency}
                  series={SERIES}
                  footer={(row) => `${Number(row.count ?? 0)} ${Number(row.count ?? 0) === 1 ? "entry" : "entries"} recorded`}
                />
              }
            />
            <Bar dataKey="income" fill={VIZ.income} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={!reduce} animationDuration={ANIMATION_MS} />
            <Bar dataKey="expenses" fill={VIZ.expense} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={!reduce} animationDuration={ANIMATION_MS} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

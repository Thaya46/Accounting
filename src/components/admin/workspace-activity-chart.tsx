"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { BarChart3 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/dates";

type Metric = "posted" | "newMembers";
type View = "workspace" | "daily";

const METRICS: Record<Metric, { label: string; color: string; unit: string }> = {
  posted: { label: "Transactions posted", color: "var(--chart-1)", unit: "posted" },
  newMembers: { label: "New members", color: "var(--chart-4)", unit: "new members" },
};

export type WorkspaceActivityProps = {
  byWorkspace: { id: string; name: string; code: string; posted: number; newMembers: number }[];
  daily: { day: string; posted: number; newMembers: number }[];
  totals: { posted: number; newMembers: number };
  activeWorkspaces: number;
};

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

function ChartTooltip({ active, payload, metric }: TooltipProps<number, string> & { metric: Metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as { name?: string; code?: string; day?: string };
  const value = Number(payload[0]!.value ?? 0);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-medium">{row.day ? formatDate(row.day) : row.name}</p>
      {row.code && <p className="font-mono text-[11px] text-muted-foreground">{row.code}</p>}
      <p className="mt-1 flex items-center gap-2">
        <span className="h-2 w-2 rounded-sm" style={{ background: METRICS[metric].color }} aria-hidden />
        <span className="tabular font-semibold">{value.toLocaleString("en-US")}</span>
        <span className="text-muted-foreground">{METRICS[metric].unit}</span>
      </p>
    </div>
  );
}

/** Usage-only activity chart for the Super Admin dashboard (counts, never amounts). */
export function WorkspaceActivityChart({ byWorkspace, daily, totals, activeWorkspaces }: WorkspaceActivityProps) {
  const [view, setView] = React.useState<View>("workspace");
  const [metric, setMetric] = React.useState<Metric>("posted");
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;
  const color = METRICS[metric].color;

  const workspaceRows = React.useMemo(
    () => [...byWorkspace].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)).filter((w) => w[metric] > 0).slice(0, 10),
    [byWorkspace, metric],
  );
  const empty = totals[metric] === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList aria-label="Metric">
            <TabsTrigger value="posted">
              Transactions <span className="tabular text-muted-foreground">{totals.posted.toLocaleString("en-US")}</span>
            </TabsTrigger>
            <TabsTrigger value="newMembers">
              New members <span className="tabular text-muted-foreground">{totals.newMembers.toLocaleString("en-US")}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList aria-label="View">
            <TabsTrigger value="workspace">By workspace</TabsTrigger>
            <TabsTrigger value="daily">Daily</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {empty ? (
        <EmptyState
          icon={BarChart3}
          title={metric === "posted" ? "No transactions posted in the last 30 days" : "No new members in the last 30 days"}
          description="Activity appears here as workspaces post entries and invite people."
          className="h-[260px]"
        />
      ) : view === "workspace" ? (
        <div style={{ height: Math.max(220, workspaceRows.length * 38 + 40) }} role="img" aria-label={`${METRICS[metric].label} by workspace, last 30 days`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={workspaceRows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="code" width={84} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip metric={metric} />} />
              <Bar
                dataKey={metric}
                name={METRICS[metric].label}
                fill={color}
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                isAnimationActive={animate}
                animationDuration={700}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[260px]" role="img" aria-label={`${METRICS[metric].label} per day, last 30 days`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={3}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                tickFormatter={(d: string) => formatDate(d).slice(0, 6)}
              />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={48} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip metric={metric} />} />
              <Bar dataKey={metric} name={METRICS[metric].label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={animate} animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {!empty && view === "workspace" && workspaceRows.length === 10 && activeWorkspaces > 10 && (
        <p className="text-xs text-muted-foreground">Showing the 10 most active of {activeWorkspaces} workspaces.</p>
      )}
    </div>
  );
}

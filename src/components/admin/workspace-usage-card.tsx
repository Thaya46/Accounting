import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import type { WorkspaceDetail } from "@/lib/admin/queries";

const TXN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "REJECTED"] as const;

function Stat({ label, value, sub }: { label: string; value: number; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular">{value.toLocaleString("en-US")}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Usage metrics only — counts, never descriptions or amounts. */
export function WorkspaceUsageCard({ usage, timeZone }: { usage: WorkspaceDetail["usage"]; timeZone: string }) {
  const { members, transactions } = usage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>Activity counts. Financial details remain private to the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Active members" value={members.active} sub={`${members.invited} invited · ${members.disabled} disabled`} />
          <Stat label="Transactions" value={transactions.total} />
          <Stat label="Journal entries" value={usage.journalEntries} />
          <Stat label="Export jobs" value={usage.exportJobs} />
          <Stat label="Import jobs" value={usage.importJobs} />
          <Stat label="Members total" value={members.active + members.invited + members.disabled} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transactions by status</p>
          {transactions.total === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {TXN_STATUSES.filter((s) => transactions.byStatus[s]).map((s) => {
                const n = transactions.byStatus[s] ?? 0;
                const pct = Math.max(2, Math.round((n / transactions.total) * 100));
                return (
                  <li key={s} className="grid grid-cols-[120px_1fr_auto] items-center gap-2 text-xs">
                    <StatusBadge status={s} className="justify-self-start" />
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-10 text-right tabular font-medium">{n.toLocaleString("en-US")}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t pt-3 text-xs">
          <p className="text-muted-foreground">Last activity</p>
          {usage.lastActivity ? (
            <p className="mt-0.5">
              <span className="font-mono">{usage.lastActivity.action}</span> by {usage.lastActivity.actorName}
              <span className="block text-muted-foreground tabular">{formatDateTime(usage.lastActivity.at, timeZone)}</span>
            </p>
          ) : (
            <p className="mt-0.5">No recorded activity yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

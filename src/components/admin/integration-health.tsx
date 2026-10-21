import Link from "next/link";
import { ArrowRight, CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import type { DashboardData } from "@/lib/admin/queries";

export function IntegrationHealthCard({ data }: { data: DashboardData["integrations"] }) {
  const pct = data.total ? Math.round((data.enabled / data.total) * 100) : 0;
  const runs = data.completed + data.failed;
  const successRate = runs ? Math.round((data.completed / runs) * 100) : null;
  const rows = [...data.adapters].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || b.completed + b.failed - (a.completed + a.failed) || a.name.localeCompare(b.name),
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Integration Health</CardTitle>
          <CardDescription>Export adapters and job outcomes, last 30 days</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="-mr-2 shrink-0">
          <Link href="/admin/integrations">
            Manage <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {data.total === 0 && data.adapters.length === 0 ? (
          <EmptyState icon={PlugZap} title="No export adapters registered" description="Adapters appear here once the integration catalogue is seeded." />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Adapters enabled</span>
                <span className="font-semibold tabular">
                  {data.enabled} <span className="font-normal text-muted-foreground">of {data.total}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Adapters enabled">
                <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 px-2 py-2.5">
                <p className="text-lg font-semibold tabular">{data.completed.toLocaleString("en-US")}</p>
                <p className="text-[11px] text-muted-foreground">Succeeded</p>
              </div>
              <div className="rounded-lg bg-muted/60 px-2 py-2.5">
                <p className={data.failed ? "text-lg font-semibold tabular text-expense" : "text-lg font-semibold tabular"}>{data.failed.toLocaleString("en-US")}</p>
                <p className="text-[11px] text-muted-foreground">Failed</p>
              </div>
              <div className="rounded-lg bg-muted/60 px-2 py-2.5">
                <p className="text-lg font-semibold tabular">{successRate === null ? "—" : `${successRate}%`}</p>
                <p className="text-[11px] text-muted-foreground">Success rate</p>
              </div>
            </div>
            <ul className="-mx-1 max-h-[300px] divide-y overflow-y-auto scrollbar-thin">
              {rows.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-3 px-1 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{a.key}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.completed + a.failed > 0 && (
                      <span className="flex items-center gap-2 text-xs tabular">
                        <span className="flex items-center gap-0.5 text-income" title="Successful exports">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {a.completed}
                          <span className="sr-only"> succeeded</span>
                        </span>
                        {a.failed > 0 && (
                          <span className="flex items-center gap-0.5 text-expense" title="Failed exports">
                            <XCircle className="h-3.5 w-3.5" aria-hidden />
                            {a.failed}
                            <span className="sr-only"> failed</span>
                          </span>
                        )}
                      </span>
                    )}
                    <Badge variant={a.enabled ? "success" : "muted"}>{a.enabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

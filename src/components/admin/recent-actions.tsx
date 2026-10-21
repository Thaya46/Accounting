import Link from "next/link";
import { ArrowRight, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/dates";
import type { DashboardData } from "@/lib/admin/queries";
import { ActionBadge } from "./action-badge";

export function RecentActionsCard({ items, timeZone }: { items: DashboardData["recent"]; timeZone: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Recent Platform Actions</CardTitle>
          <CardDescription>Latest audited events across all workspaces</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="-mr-2 shrink-0">
          <Link href="/admin/activity">
            View all <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {items.length === 0 ? (
          <EmptyState icon={ScrollText} title="No activity yet" description="Audited actions such as sign-ins and workspace changes appear here." />
        ) : (
          <ul className="divide-y">
            {items.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={e.actorName} className="h-8 w-8" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.actorName}</p>
                    {e.actorEmail && <p className="truncate text-xs text-muted-foreground">{e.actorEmail}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 sm:pl-0">
                  <ActionBadge action={e.action} />
                  {e.workspace ? (
                    <Link href={`/admin/workspaces/${e.workspace.id}`} className="max-w-[180px] truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
                      {e.workspace.name}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">Platform</span>
                  )}
                  <time dateTime={e.createdAt} className="text-xs text-muted-foreground tabular sm:w-[150px] sm:text-right">
                    {formatDateTime(e.createdAt, timeZone)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { Building2, CirclePause, CircleCheck, Plus, Users } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getAdminDashboard, platformTimeZone } from "@/lib/admin/queries";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/feedback";
import { KpiCard } from "@/components/admin/kpi-card";
import { WorkspaceActivityChart } from "@/components/admin/workspace-activity-chart";
import { IntegrationHealthCard } from "@/components/admin/integration-health";
import { RecentActionsCard } from "@/components/admin/recent-actions";

export const metadata = { title: "Super Admin Dashboard" };

export default async function AdminDashboardPage() {
  const { user } = await requireSuperAdmin();
  const timeZone = await platformTimeZone();
  const data = await getAdminDashboard(timeZone);
  const { kpis, activity } = data;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description={`Welcome back, ${user.name}. Platform health, workspace usage and recent administrative activity.`}
        actions={
          <Button asChild>
            <Link href="/admin/workspaces/new">
              <Plus /> New workspace
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Workspaces"
          value={kpis.totalWorkspaces}
          icon={Building2}
          href="/admin/workspaces"
          hint={kpis.newWorkspaces ? `+${kpis.newWorkspaces} created in the last 30 days` : "No new workspaces in the last 30 days"}
        />
        <KpiCard label="Active Workspaces" value={kpis.active} icon={CircleCheck} tone="success" href="/admin/workspaces?status=ACTIVE" hint="Open to their members" />
        <KpiCard
          label="Suspended Workspaces"
          value={kpis.suspended}
          icon={CirclePause}
          tone="warning"
          href="/admin/workspaces?status=SUSPENDED"
          hint={
            <>
              <span className="tabular">{kpis.archived.toLocaleString("en-US")}</span> archived
            </>
          }
        />
        <KpiCard
          label="Total Users"
          value={kpis.totalUsers}
          icon={Users}
          tone="info"
          hint={
            <>
              <span className="tabular">{kpis.activeUsers.toLocaleString("en-US")}</span> active ·{" "}
              <span className="tabular">{(kpis.totalUsers - kpis.activeUsers).toLocaleString("en-US")}</span> pending or disabled
            </>
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workspace Activity</CardTitle>
            <CardDescription>
              Usage counts from {formatDate(activity.from)} to {formatDate(activity.to)} — transaction details stay private to each workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceActivityChart
              byWorkspace={activity.byWorkspace}
              daily={activity.daily}
              totals={activity.totals}
              activeWorkspaces={activity.activeWorkspaces}
            />
          </CardContent>
        </Card>
        <IntegrationHealthCard data={data.integrations} />
      </div>

      <div className="mt-6">
        <RecentActionsCard items={data.recent} timeZone={timeZone} />
      </div>
    </>
  );
}

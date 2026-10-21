import { requireWorkspace } from "@/lib/auth/guards";
import { loadPersonalDashboard, loadWorkspaceDashboard } from "@/lib/dashboard/queries";
import { DashboardGreeting } from "@/components/dashboard/greeting";
import { WorkspaceDashboard } from "@/components/dashboard/workspace-dashboard";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";

export const metadata = { title: "Dashboard" };

/**
 * Permission-aware dashboard: members with REPORTS_VIEW get the workspace
 * finance view; everyone else sees only their own figures and activity.
 */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId);
  const ws = ctx.workspace;
  const canCreate = ctx.permissions.has("TRANSACTION_CREATE");

  if (ctx.permissions.has("REPORTS_VIEW")) {
    const data = await loadWorkspaceDashboard(ctx);
    return (
      <>
        <DashboardGreeting
          name={ctx.user.name}
          workspaceName={ws.name}
          roleName={ctx.membership.roleName}
          fyLabel={data.fy.label}
          fyRange={data.fy.rangeLabel}
          timeZone={ws.timeZone}
          scopeLabel="Workspace overview"
        />
        <WorkspaceDashboard workspaceId={ws.id} data={data} currency={ws.defaultCurrency} timeZone={ws.timeZone} canCreate={canCreate} />
      </>
    );
  }

  const data = await loadPersonalDashboard(ctx);
  return (
    <>
      <DashboardGreeting
        name={ctx.user.name}
        workspaceName={ws.name}
        roleName={ctx.membership.roleName}
        fyLabel={data.fy.label}
        fyRange={data.fy.rangeLabel}
        timeZone={ws.timeZone}
        scopeLabel="Your activity"
      />
      <PersonalDashboard workspaceId={ws.id} data={data} currency={ws.defaultCurrency} timeZone={ws.timeZone} canCreate={canCreate} />
    </>
  );
}

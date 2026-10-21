import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth/guards";
import { todayInTimeZone } from "@/lib/dates";
import { userRef } from "@/lib/ids";
import { listAdapterSummaries } from "@/lib/export/integrations";
import { listExportJobs } from "@/lib/export/service";
import { PageHeader } from "@/components/ui/feedback";
import { ExportCenter } from "@/components/export/export-center";

export const metadata = { title: "Export Center" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "DATA_EXPORT");
  const wsId = ctx.workspace.id;
  const [adapters, history, members, categories, accounts] = await Promise.all([
    listAdapterSummaries(ctx),
    listExportJobs(ctx, 50),
    prisma.workspaceMembership.findMany({ where: { workspaceId: wsId }, select: { user: { select: { id: true, seq: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.accountCategory.findMany({ where: { workspaceId: wsId }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.account.findMany({ where: { workspaceId: wsId }, select: { id: true, code: true, name: true, type: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
  ]);

  return (
    <>
      <PageHeader
        title="Export Center"
        description="Export this workspace's accounting data as canonical JSON or convert it to a supported accounting software import format. Every export keeps full creator attribution in a separate audit metadata file."
      />
      <ExportCenter
        workspaceId={wsId}
        currency={ctx.workspace.defaultCurrency}
        fyStartMonth={ctx.workspace.fyStartMonth}
        today={todayInTimeZone(ctx.workspace.timeZone)}
        adapters={adapters}
        users={members.map((m) => ({ id: m.user.id, name: m.user.name, ref: userRef(m.user.seq) }))}
        categories={categories}
        accounts={accounts}
        history={history}
        canManageSettings={ctx.permissions.has("SETTINGS_MANAGE")}
      />
    </>
  );
}

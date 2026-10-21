import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth/guards";
import { workspaceRef } from "@/lib/ids";
import { listImportJobs } from "@/lib/import/service";
import { PageHeader } from "@/components/ui/feedback";
import { ImportCenter } from "@/components/import/import-center";

export const metadata = { title: "Import" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "DATA_IMPORT");
  const wsId = ctx.workspace.id;
  const [accounts, categories, history] = await Promise.all([
    prisma.account.findMany({ where: { workspaceId: wsId, isActive: true }, select: { id: true, code: true, name: true, type: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
    prisma.accountCategory.findMany({ where: { workspaceId: wsId, isActive: true }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    listImportJobs(ctx, 50),
  ]);
  return (
    <>
      <PageHeader title="Import" description="Import accounting data from a canonical JSON file. Every record is validated, mapped to this workspace and checked for duplicates before anything is created." />
      <ImportCenter
        workspaceId={wsId}
        workspaceLabel={`${ctx.workspace.name} (${workspaceRef(ctx.workspace.seq)})`}
        currency={ctx.workspace.defaultCurrency}
        actorName={ctx.actor.name}
        canPost={ctx.permissions.has("TRANSACTION_POST")}
        accounts={accounts}
        categories={categories}
        history={history}
      />
    </>
  );
}

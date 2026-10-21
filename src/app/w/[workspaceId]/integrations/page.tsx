import { requireWorkspace } from "@/lib/auth/guards";
import { listAdapterSummaries } from "@/lib/export/integrations";
import { PageHeader } from "@/components/ui/feedback";
import { IntegrationsPanel } from "@/components/export/integrations-panel";

export const metadata = { title: "Integrations" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "SETTINGS_MANAGE");
  const adapters = await listAdapterSummaries(ctx);
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Accounting software adapters for this workspace: what each target accepts, how attribution is carried, its settings and the account mappings it needs."
      />
      <IntegrationsPanel workspaceId={ctx.workspace.id} adapters={adapters} />
    </>
  );
}

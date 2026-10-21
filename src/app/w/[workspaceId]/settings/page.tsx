import { requireWorkspace } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/dates";
import { serializeSettings, serializeWorkspaceInfo } from "@/lib/workspace-admin/settings";
import { PageHeader } from "@/components/ui/feedback";
import { SettingsClient } from "@/components/workspace-admin/settings/settings-client";

export const metadata = { title: "Workspace Settings" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "SETTINGS_MANAGE");
  const settings = serializeSettings(ctx.workspace.settings);
  const updatedLabel = ctx.workspace.settings ? formatDateTime(ctx.workspace.settings.updatedAt, ctx.workspace.timeZone) : null;

  return (
    <>
      <PageHeader title="Workspace Settings" description="Accounting rules, approval workflow, security and email preferences for this workspace." />
      <SettingsClient workspaceId={ctx.workspace.id} workspace={serializeWorkspaceInfo(ctx.workspace)} settings={settings} updatedLabel={updatedLabel} />
    </>
  );
}

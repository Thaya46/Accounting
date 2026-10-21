import { requireWorkspace } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui/feedback";
import { SecurityPanel } from "@/components/account/security-panel";

export const metadata = { title: "Security" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  return (
    <>
      <PageHeader title="Security settings" description="Two-step verification, password and active sessions." />
      <SecurityPanel />
    </>
  );
}

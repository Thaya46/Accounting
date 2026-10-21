import { requireWorkspace } from "@/lib/auth/guards";
import { loadProfile } from "@/lib/account";
import { PageHeader } from "@/components/ui/feedback";
import { ProfilePanel } from "@/components/account/profile-panel";

export const metadata = { title: "Profile" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId);
  return (
    <>
      <PageHeader title="Profile" description="Your account details and workspace memberships." />
      <ProfilePanel {...await loadProfile(ctx.user)} />
    </>
  );
}

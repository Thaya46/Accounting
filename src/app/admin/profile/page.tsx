import { requireSuperAdmin } from "@/lib/auth/guards";
import { loadProfile } from "@/lib/account";
import { PageHeader } from "@/components/ui/feedback";
import { ProfilePanel } from "@/components/account/profile-panel";

export const metadata = { title: "Profile" };

export default async function Page() {
  const { user } = await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Profile" description="Your account details." />
      <ProfilePanel {...await loadProfile(user)} />
    </>
  );
}

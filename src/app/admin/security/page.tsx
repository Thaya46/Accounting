import { requireSuperAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui/feedback";
import { SecurityPanel } from "@/components/account/security-panel";

export const metadata = { title: "Security" };

export default async function Page() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Security settings" description="Two-step verification, password and active sessions." />
      <SecurityPanel />
    </>
  );
}

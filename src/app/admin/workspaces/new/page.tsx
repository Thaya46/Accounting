import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getPlatformSettings } from "@/lib/admin/queries";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/feedback";
import { WorkspaceCreateForm } from "@/components/admin/workspace-create-form";

export const metadata = { title: "New workspace" };

export default async function NewWorkspacePage() {
  await requireSuperAdmin();
  const settings = await getPlatformSettings();

  return (
    <>
      <PageHeader
        title="Create workspace"
        description="Set up a new company workspace and invite its first administrator."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/workspaces">
              <ArrowLeft /> All workspaces
            </Link>
          </Button>
        }
      />
      <WorkspaceCreateForm
        defaults={{
          country: settings.defaultCountry,
          currency: settings.defaultCurrency,
          timeZone: settings.defaultTimeZone,
          fyStartMonth: settings.defaultFyStartMonth,
        }}
      />
    </>
  );
}

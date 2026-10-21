import { requireSuperAdmin } from "@/lib/auth/guards";
import { listPlatformAdapters } from "@/lib/export/integrations";
import { PageHeader } from "@/components/ui/feedback";
import { AdminIntegrations } from "@/components/export/admin-integrations";

export const metadata = { title: "Export Integrations" };

export default async function Page() {
  await requireSuperAdmin();
  const items = await listPlatformAdapters();
  return (
    <>
      <PageHeader title="Export Integrations" description="Platform-wide availability of accounting software adapters, their implementation status, specification sources and usage." />
      <AdminIntegrations items={items} />
    </>
  );
}

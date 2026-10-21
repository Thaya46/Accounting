import { requireWorkspace } from "@/lib/auth/guards";
import { listContacts } from "@/lib/workspace-admin/contacts";
import { PageHeader } from "@/components/ui/feedback";
import { ContactsClient } from "@/components/workspace-admin/contacts/contacts-client";

export const metadata = { title: "Customers & Vendors" };

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const { tab } = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const [customers, vendors] = await Promise.all([listContacts(ctx.workspace.id, "customer"), listContacts(ctx.workspace.id, "vendor")]);

  return (
    <>
      <PageHeader title="Customers & Vendors" description="People and companies you receive money from or pay. Names are unique within the workspace." />
      <ContactsClient workspaceId={ctx.workspace.id} customers={customers} vendors={vendors} initialTab={tab} />
    </>
  );
}

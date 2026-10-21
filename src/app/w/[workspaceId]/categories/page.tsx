import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth/guards";
import { listCategories } from "@/lib/workspace-admin/categories";
import { PageHeader } from "@/components/ui/feedback";
import { CategoriesClient, type LedgerOption } from "@/components/workspace-admin/categories/categories-client";

export const metadata = { title: "Categories" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const [categories, accounts] = await Promise.all([
    listCategories(ctx.workspace.id),
    prisma.account.findMany({
      where: { workspaceId: ctx.workspace.id, type: { in: ["INCOME", "EXPENSE"] } },
      select: { id: true, code: true, name: true, type: true, isActive: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Income and expense categories, the ledger accounts they post to, and the keywords the AI uses to recognise them."
      />
      <CategoriesClient workspaceId={ctx.workspace.id} categories={categories} accounts={accounts as LedgerOption[]} />
    </>
  );
}

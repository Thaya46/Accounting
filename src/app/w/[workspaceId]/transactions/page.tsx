import Link from "next/link";
import { PenLine, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { todayInTimeZone } from "@/lib/dates";
import { parseFilters, resolveDateRange } from "@/lib/transactions/filters";
import { listCategoryFilterOptions, listTransactions } from "@/lib/transactions/queries";
import { PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { TransactionListSection } from "@/components/transactions/transaction-list";

export const metadata = { title: "All Transactions" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_VIEW");
  const filters = parseFilters(await searchParams);
  const [result, categories] = await Promise.all([listTransactions(ctx, filters), listCategoryFilterOptions(ctx)]);
  const resolvedRange = resolveDateRange(filters, todayInTimeZone(ctx.workspace.timeZone), ctx.workspace.fyStartMonth);
  const canCreate = ctx.permissions.has("TRANSACTION_CREATE");
  const base = `/w/${workspaceId}/transactions`;

  const actions = canCreate ? (
    <>
      <Button asChild variant="outline">
        <Link href={`${base}/new`}>
          <PenLine /> Manual entry
        </Link>
      </Button>
      <Button asChild>
        <Link href={`/w/${workspaceId}/entry`}>
          <Sparkles /> AI entry
        </Link>
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="All Transactions" description="Every income, expense, transfer and journal in this workspace, with who entered it." actions={actions} />
      <TransactionListSection
        workspaceId={workspaceId}
        basePath={base}
        result={result}
        filters={filters}
        categories={categories}
        members={result.members}
        showEnteredBy
        resolvedRange={resolvedRange}
        emptyDescription="Transactions recorded by any member of this workspace will appear here."
        emptyAction={actions}
      />
    </>
  );
}

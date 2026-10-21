import Link from "next/link";
import { PenLine, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { todayInTimeZone } from "@/lib/dates";
import { parseFilters, resolveDateRange } from "@/lib/transactions/filters";
import { listCategoryFilterOptions, listTransactions } from "@/lib/transactions/queries";
import { PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { TransactionListSection } from "@/components/transactions/transaction-list";

export const metadata = { title: "My Transactions" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId);
  const filters = parseFilters(await searchParams);
  delete filters.by; // always the signed-in user here
  const [result, categories] = await Promise.all([listTransactions(ctx, filters, { mineOnly: true }), listCategoryFilterOptions(ctx)]);
  const resolvedRange = resolveDateRange(filters, todayInTimeZone(ctx.workspace.timeZone), ctx.workspace.fyStartMonth);
  const canCreate = ctx.permissions.has("TRANSACTION_CREATE");

  const actions = canCreate ? (
    <>
      <Button asChild variant="outline">
        <Link href={`/w/${workspaceId}/transactions/new`}>
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
      <PageHeader title="My Transactions" description={`Entries you recorded in ${ctx.workspace.name}, with their approval and posting status.`} actions={actions} />
      <TransactionListSection
        workspaceId={workspaceId}
        basePath={`/w/${workspaceId}/transactions/mine`}
        result={result}
        filters={filters}
        categories={categories}
        members={[]}
        showEnteredBy={false}
        resolvedRange={resolvedRange}
        emptyDescription={canCreate ? "Record your first expense or income — by typing, speaking, or with the manual form." : "You have not recorded any transactions in this workspace."}
        emptyAction={actions}
      />
    </>
  );
}

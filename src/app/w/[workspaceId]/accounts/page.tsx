import { requireWorkspace } from "@/lib/auth/guards";
import { financialYearFor, todayInTimeZone } from "@/lib/dates";
import { listAccounts } from "@/lib/workspace-admin/accounts";
import { ensureTallyGroups } from "@/lib/accounting/tally-groups";
import { PageHeader } from "@/components/ui/feedback";
import { CoaClient } from "@/components/workspace-admin/accounts/coa-client";
import { NewAccountButton } from "@/components/workspace-admin/accounts/account-dialog";

export const metadata = { title: "Chart of Accounts" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, ["ACCOUNTS_MANAGE", "REPORTS_VIEW"]);
  const canManage = ctx.permissions.has("ACCOUNTS_MANAGE");
  await ensureTallyGroups(ctx.workspace.id);
  const accounts = await listAccounts(ctx.workspace.id);
  const today = todayInTimeZone(ctx.workspace.timeZone);
  const fyStart = financialYearFor(today, ctx.workspace.fyStartMonth).from;

  return (
    <>
      <PageHeader
        title="Chart of Accounts"
        description={`Ledger accounts for ${ctx.workspace.name}, grouped by type. Amounts in ${ctx.workspace.defaultCurrency}.`}
        actions={canManage ? <NewAccountButton workspaceId={ctx.workspace.id} /> : undefined}
      />
      <CoaClient
        workspaceId={ctx.workspace.id}
        accounts={accounts}
        currency={ctx.workspace.defaultCurrency}
        canManage={canManage}
        defaultOpeningDate={fyStart}
        today={today}
      />
    </>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { loadTransactionDetail } from "@/lib/transactions/detail";
import { loadFormOptions } from "@/lib/transactions/options";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/transaction-form";

export const metadata = { title: "Edit Transaction" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string; transactionId: string }> }) {
  const { workspaceId, transactionId } = await params;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_EDIT_DRAFT");
  const detail = await loadTransactionDetail(ctx, transactionId);
  if (!detail) notFound();
  const detailUrl = `/w/${workspaceId}/transactions/${transactionId}`;
  if (!detail.abilities.canEdit) redirect(detailUrl);
  const options = await loadFormOptions(ctx);
  const { view } = detail;

  return (
    <>
      <PageHeader
        title={`Edit ${view.ref}`}
        description={`Entered by ${view.createdBy.nameSnapshot} · ${view.status === "REJECTED" ? "rejected — fix and resubmit" : "draft"}`}
        actions={
          <Button asChild variant="outline">
            <Link href={detailUrl}>
              <ArrowLeft /> Back to transaction
            </Link>
          </Button>
        }
      />
      {view.status === "REJECTED" && view.approvals.length > 0 && (
        <Alert variant="danger" title="This transaction was rejected" className="mb-6">
          {view.approvals[view.approvals.length - 1].comment ?? "No comment was given."} — {view.approvals[view.approvals.length - 1].decidedByName}
        </Alert>
      )}
      <TransactionForm
        options={options}
        mode="edit"
        transactionId={view.id}
        transactionRef={view.ref}
        initial={detail.initial}
        creator={{ name: view.createdBy.nameSnapshot, ref: view.createdBy.ref }}
      />
    </>
  );
}

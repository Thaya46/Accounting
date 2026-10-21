import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { loadFormOptions } from "@/lib/transactions/options";
import { PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/transaction-form";

export const metadata = { title: "Manual Entry" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_CREATE");
  const options = await loadFormOptions(ctx);
  return (
    <>
      <PageHeader
        title="Manual Entry"
        description="Record an expense, income, transfer or a balanced multi-line journal."
        actions={
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceId}/entry`}>
              <Sparkles /> Use AI or voice instead
            </Link>
          </Button>
        }
      />
      <TransactionForm options={options} mode="create" />
    </>
  );
}

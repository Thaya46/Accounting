import Link from "next/link";
import { PenLine } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { aiProviderStatus } from "@/lib/ai/provider";
import { loadFormOptions } from "@/lib/transactions/options";
import { PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { AiEntry } from "@/components/transactions/ai-entry";

export const metadata = { title: "AI & Voice Entry" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "TRANSACTION_CREATE");
  const options = await loadFormOptions(ctx);

  const status = aiProviderStatus();
  const providerLabel =
    status.provider === "none" || !status.configured
      ? "Built-in rules"
      : status.provider === "anthropic"
        ? "Claude, with built-in rules as fallback"
        : "OpenAI-compatible, with built-in rules as fallback";

  const modeParam = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const qParam = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const mode = modeParam === "voice" ? "voice" : "text";
  const q = qParam?.trim() ? qParam.trim().slice(0, 1000) : null;

  return (
    <>
      <PageHeader
        title="AI & Voice Entry"
        description="Record income, expenses and transfers in plain words — typed or spoken. Review the extracted fields, then save."
        actions={
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceId}/transactions/new`}>
              <PenLine /> Manual entry
            </Link>
          </Button>
        }
      />
      <AiEntry key={q ?? mode} options={options} initialMode={mode} initialQuery={q} providerLabel={providerLabel} />
    </>
  );
}

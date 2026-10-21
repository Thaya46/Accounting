"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CheckCheck, Pencil, Send, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import type { SavedTransaction, TransactionAbilities } from "@/lib/transactions/types";
import { Button } from "@/components/ui/button";
import { Alert, FormField } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { GuardedButton } from "./form-parts";

type DecisionMode = "approve" | "reject" | "approve-post";

const SELF_APPROVAL = "You cannot approve or reject your own transaction. Another approver must review it.";

/** State- and permission-aware action bar for a transaction. Every action goes through the API. */
export function TransactionActions({
  workspaceId,
  transactionId,
  refLabel,
  abilities,
  journalDate,
  today,
}: {
  workspaceId: string;
  transactionId: string;
  refLabel: string;
  abilities: TransactionAbilities;
  /** Original journal date (reversals cannot be dated earlier). */
  journalDate: string | null;
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<DecisionMode | null>(null);
  const [comment, setComment] = React.useState("");
  const [postOpen, setPostOpen] = React.useState(false);
  const [reverseOpen, setReverseOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reverseDate, setReverseDate] = React.useState(today < (journalDate ?? today) ? (journalDate ?? today) : today);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const base = `/api/w/${workspaceId}/transactions/${transactionId}`;

  async function call(name: string, path: string, body: unknown, success: (t: SavedTransaction) => string) {
    setBusy(name);
    setDialogError(null);
    try {
      const r = await apiFetch<{ transaction: SavedTransaction }>(`${base}/${path}`, { method: "POST", body });
      toast.success(success(r.transaction));
      setDecision(null);
      setPostOpen(false);
      setReverseOpen(false);
      setComment("");
      setReason("");
      router.refresh();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "The action failed";
      setDialogError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const a = abilities;
  const any = a.canEdit || a.canSubmit || a.canApprove || a.canPost || a.canReverse;
  if (!any) return null;

  const decisionTitle = decision === "reject" ? `Reject ${refLabel}` : decision === "approve-post" ? `Approve & post ${refLabel}` : `Approve ${refLabel}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {a.canEdit && (
        <Button asChild variant="outline">
          <Link href={`/w/${workspaceId}/transactions/${transactionId}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
      )}
      {a.canSubmit && (
        <Button variant="secondary" loading={busy === "submit"} disabled={Boolean(busy)} onClick={() => call("submit", "submit", {}, (t) => `${t.ref} submitted for approval`)}>
          <Send /> Submit
        </Button>
      )}
      {a.canApprove && (
        <>
          <GuardedButton variant="outline" blockedReason={a.selfApprovalBlocked ? SELF_APPROVAL : null} disabled={Boolean(busy)} onClick={() => setDecision("reject")} className="text-expense hover:text-expense">
            <ThumbsDown /> Reject
          </GuardedButton>
          <GuardedButton variant="outline" blockedReason={a.selfApprovalBlocked ? SELF_APPROVAL : null} disabled={Boolean(busy)} onClick={() => setDecision("approve")}>
            <ThumbsUp /> Approve
          </GuardedButton>
          {a.canApproveAndPost && (
            <GuardedButton variant="success" blockedReason={a.selfApprovalBlocked ? SELF_APPROVAL : null} disabled={Boolean(busy)} onClick={() => setDecision("approve-post")}>
              <CheckCheck /> Approve &amp; Post
            </GuardedButton>
          )}
        </>
      )}
      {a.canPost && (
        <GuardedButton blockedReason={a.postBlockedReason} disabled={Boolean(busy)} onClick={() => setPostOpen(true)}>
          <CheckCircle2 /> Post
        </GuardedButton>
      )}
      {a.canReverse && (
        <Button variant="outline" className="text-expense hover:text-expense" disabled={Boolean(busy)} onClick={() => setReverseOpen(true)}>
          <Undo2 /> Reverse
        </Button>
      )}

      {/* Approve / reject */}
      <Dialog open={decision !== null} onOpenChange={(o) => !o && (setDecision(null), setDialogError(null))}>
        <DialogContent
          title={decisionTitle}
          description={
            decision === "reject"
              ? "The creator will see your comment and can fix and resubmit the transaction."
              : decision === "approve-post"
                ? "Approves the transaction and posts a balanced journal entry to the general ledger."
                : "Approves the transaction. It can then be posted to the ledger."
          }
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (decision === "reject" && !comment.trim()) {
                setDialogError("A comment is required when rejecting.");
                return;
              }
              void call(
                decision ?? "approve",
                "approve",
                { decision: decision === "reject" ? "REJECTED" : "APPROVED", comment: comment.trim() || null, post: decision === "approve-post" },
                (t) => (decision === "reject" ? `${t.ref} rejected` : t.status === "POSTED" ? `${t.ref} approved and posted` : `${t.ref} approved`),
              );
            }}
          >
            <FormField label={decision === "reject" ? "Reason for rejecting" : "Comment"} htmlFor="decision-comment" required={decision === "reject"} hint={decision === "reject" ? undefined : "Optional"}>
              <Textarea id="decision-comment" value={comment} maxLength={1000} rows={3} onChange={(e) => setComment(e.target.value)} autoFocus />
            </FormField>
            {dialogError && <Alert variant="danger">{dialogError}</Alert>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant={decision === "reject" ? "destructive" : decision === "approve-post" ? "success" : "default"} loading={busy !== null}>
                {decision === "reject" ? "Reject" : decision === "approve-post" ? "Approve & post" : "Approve"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Post */}
      <Dialog open={postOpen} onOpenChange={(o) => (setPostOpen(o), setDialogError(null))}>
        <DialogContent title={`Post ${refLabel}?`} description="A balanced journal entry is written to the general ledger. Posted entries cannot be edited — corrections are made by reversal.">
          {dialogError && <Alert variant="danger">{dialogError}</Alert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button loading={busy === "post"} onClick={() => call("post", "post", {}, (t) => `${t.ref} posted to the ledger`)}>
              <CheckCircle2 /> Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse */}
      <Dialog open={reverseOpen} onOpenChange={(o) => (setReverseOpen(o), setDialogError(null))}>
        <DialogContent title={`Reverse ${refLabel}`} description="Creates a mirror-image journal entry. The original entry and its attribution stay unchanged in the ledger and audit history.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3) {
                setDialogError("Give a reason for the reversal.");
                return;
              }
              void call("reverse", "reverse", { reason: reason.trim(), date: reverseDate || null }, (t) => `${t.ref} reversed`);
            }}
          >
            <FormField label="Reason" htmlFor="reverse-reason" required>
              <Textarea id="reverse-reason" value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of TXN-0041" autoFocus />
            </FormField>
            <FormField label="Reversal date" htmlFor="reverse-date" hint={journalDate ? "Cannot be earlier than the original entry date." : undefined}>
              <Input id="reverse-date" type="date" value={reverseDate} min={journalDate ?? undefined} onChange={(e) => setReverseDate(e.target.value)} />
            </FormField>
            {dialogError && <Alert variant="danger">{dialogError}</Alert>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" loading={busy === "reverse"}>
                <Undo2 /> Reverse transaction
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

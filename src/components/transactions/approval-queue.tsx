"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, CheckCircle2, Clock, Inbox, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDate } from "@/lib/dates";
import type { ApprovalQueueItem, SavedTransaction } from "@/lib/transactions/types";
import { Badge, TypeBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { AmountText, EnteredBy } from "./display";
import { GuardedButton } from "./form-parts";

type Item = ApprovalQueueItem & { ageLabel: string; actorAtLabel: string };

const SELF_APPROVAL = "You cannot approve or reject your own transaction. Another approver must review it.";

function ItemSummary({ item, workspaceId }: { item: Item; workspaceId: string }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {item.canView ? (
          <Link href={`/w/${workspaceId}/transactions/${item.id}`} className="tabular text-sm font-semibold hover:text-primary hover:underline">
            {item.ref}
          </Link>
        ) : (
          <span className="tabular text-sm font-semibold">{item.ref}</span>
        )}
        <TypeBadge type={item.type} />
        <span className="text-xs text-muted-foreground">{formatDate(item.date)}</span>
      </div>
      <p className="truncate font-medium">{item.description}</p>
      <p className="truncate text-xs text-muted-foreground">
        {[item.categoryName, item.debitAccountName && `Dr ${item.debitAccountName}`, item.creditAccountName && `Cr ${item.creditAccountName}`, item.counterparty].filter(Boolean).join(" · ") ||
          (item.type === "JOURNAL" ? "Multi-line journal" : "—")}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Entered by <EnteredBy name={item.enteredBy} className="font-medium text-foreground" />
        </span>
      </div>
    </div>
  );
}

/** Approval queue: pending decisions and approved entries awaiting posting. */
export function ApprovalQueueView({
  workspaceId,
  pending,
  approved,
  canPost,
  isAdmin,
}: {
  workspaceId: string;
  pending: Item[];
  approved: Item[];
  canPost: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<Item | null>(null);
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function act(item: Item, key: string, path: string, body: unknown, success: (t: SavedTransaction) => string) {
    setBusy(`${item.id}:${key}`);
    setError(null);
    try {
      const r = await apiFetch<{ transaction: SavedTransaction }>(`/api/w/${workspaceId}/transactions/${item.id}/${path}`, { method: "POST", body });
      toast.success(success(r.transaction));
      setRejecting(null);
      setComment("");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The action failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  const blocked = (item: Item) => (item.isOwn && !isAdmin ? SELF_APPROVAL : null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" /> Waiting for approval
            <Badge variant="warning">{pending.length}</Badge>
          </CardTitle>
          <CardDescription>Oldest first. Rejecting requires a comment the creator will see.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing to approve" description="Submitted transactions will appear here." />
          ) : (
            <ul className="divide-y border-t">
              <AnimatePresence initial={false}>
                {pending.map((item) => (
                  <motion.li key={item.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                    <ItemSummary item={item} workspaceId={workspaceId} />
                    <div className="flex shrink-0 flex-col gap-1 md:w-44 md:items-end">
                      <AmountText amount={item.amount} currency={item.currency} type={item.type} className="text-lg" />
                      <span className="text-xs text-muted-foreground" title={item.actorAtLabel}>
                        Submitted {item.ageLabel}
                        {item.actorName ? ` by ${item.actorName}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 md:w-auto md:justify-end">
                      <GuardedButton
                        size="sm"
                        variant="outline"
                        className="text-expense hover:text-expense"
                        blockedReason={blocked(item)}
                        disabled={busy !== null}
                        onClick={() => {
                          setRejecting(item);
                          setComment("");
                          setError(null);
                        }}
                      >
                        <ThumbsDown /> Reject
                      </GuardedButton>
                      <GuardedButton
                        size="sm"
                        variant="outline"
                        blockedReason={blocked(item)}
                        loading={busy === `${item.id}:approve`}
                        disabled={busy !== null}
                        onClick={() => act(item, "approve", "approve", { decision: "APPROVED" }, (t) => `${t.ref} approved`)}
                      >
                        <ThumbsUp /> Approve
                      </GuardedButton>
                      {canPost && (
                        <GuardedButton
                          size="sm"
                          variant="success"
                          blockedReason={blocked(item) ?? (item.missing.length ? `Missing: ${item.missing.join(", ")}` : null)}
                          loading={busy === `${item.id}:approve-post`}
                          disabled={busy !== null}
                          onClick={() => act(item, "approve-post", "approve", { decision: "APPROVED", post: true }, (t) => (t.status === "POSTED" ? `${t.ref} approved and posted` : `${t.ref} approved`))}
                        >
                          <CheckCheck /> Approve &amp; Post
                        </GuardedButton>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-info" /> Approved — awaiting posting
            <Badge variant="info">{approved.length}</Badge>
          </CardTitle>
          <CardDescription>{canPost ? "Post these to the general ledger." : "Someone with posting permission will post these."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {approved.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All caught up" description="Approved transactions waiting to be posted will appear here." />
          ) : (
            <ul className="divide-y border-t">
              <AnimatePresence initial={false}>
                {approved.map((item) => (
                  <motion.li key={item.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                    <ItemSummary item={item} workspaceId={workspaceId} />
                    <div className="flex shrink-0 flex-col gap-1 md:w-44 md:items-end">
                      <AmountText amount={item.amount} currency={item.currency} type={item.type} className="text-lg" />
                      <span className="text-xs text-muted-foreground" title={item.actorAtLabel}>
                        Approved {item.ageLabel}
                        {item.actorName ? ` by ${item.actorName}` : ""}
                      </span>
                    </div>
                    {canPost && (
                      <div className="flex gap-2 md:justify-end">
                        <GuardedButton
                          size="sm"
                          blockedReason={item.missing.length ? `Missing: ${item.missing.join(", ")}` : null}
                          loading={busy === `${item.id}:post`}
                          disabled={busy !== null}
                          onClick={() => act(item, "post", "post", {}, (t) => `${t.ref} posted to the ledger`)}
                        >
                          <CheckCircle2 /> Post
                        </GuardedButton>
                      </div>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent title={`Reject ${rejecting?.ref ?? ""}`} description="The creator will see your comment and can fix and resubmit the transaction.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rejecting) return;
              if (!comment.trim()) {
                setError("A comment is required when rejecting.");
                return;
              }
              void act(rejecting, "reject", "approve", { decision: "REJECTED", comment: comment.trim() }, (t) => `${t.ref} rejected`);
            }}
          >
            <FormField label="Reason for rejecting" htmlFor="reject-comment" required>
              <Textarea id="reject-comment" value={comment} rows={3} maxLength={1000} onChange={(e) => setComment(e.target.value)} autoFocus />
            </FormField>
            {error && <Alert variant="danger">{error}</Alert>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" loading={busy !== null}>
                <ThumbsDown /> Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

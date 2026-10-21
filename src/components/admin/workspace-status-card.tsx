"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, CirclePause, CirclePlay, History } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { errorMessage } from "./form-errors";

type Status = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

const ACTIONS: Record<Status, { label: string; verb: string; icon: typeof Archive; variant: "success" | "outline" | "destructive"; explain: string }> = {
  ACTIVE: {
    label: "Activate",
    verb: "activate",
    icon: CirclePlay,
    variant: "success",
    explain: "Members regain access immediately and pending invitations can be accepted again.",
  },
  SUSPENDED: {
    label: "Suspend",
    verb: "suspend",
    icon: CirclePause,
    variant: "outline",
    explain: "All members lose access immediately. Data is kept intact and the workspace can be reactivated at any time.",
  },
  ARCHIVED: {
    label: "Archive",
    verb: "archive",
    icon: Archive,
    variant: "destructive",
    explain: "The workspace is closed and becomes read-only in this console. Records are retained for audit; it can be reactivated later.",
  },
};

export type StatusHistoryItem = { id: string; at: string; actorName: string; reason: string | null; from: string | null; to: string | null };

export function WorkspaceStatusCard({
  workspaceId,
  workspaceName,
  status,
  suspendedAt,
  archivedAt,
  createdAt,
  history,
  timeZone,
}: {
  workspaceId: string;
  workspaceName: string;
  status: Status;
  suspendedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  history: StatusHistoryItem[];
  timeZone: string;
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState<Status | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const options: Status[] = status === "ACTIVE" ? ["SUSPENDED", "ARCHIVED"] : status === "SUSPENDED" ? ["ACTIVE", "ARCHIVED"] : ["ACTIVE"];

  function open(s: Status) {
    setTarget(s);
    setReason("");
    setError(null);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (reason.trim().length < 3) {
      setError("Give a reason (at least 3 characters)");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/workspaces/${workspaceId}/status`, { method: "POST", body: { status: target, reason: reason.trim() } });
      toast.success(`${workspaceName} is now ${target.toLowerCase()}`);
      setTarget(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err, "Could not change the status"));
    } finally {
      setSaving(false);
    }
  }

  const action = target ? ACTIONS[target] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardDescription>Controls whether members can access this workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <span className="text-sm text-muted-foreground">Current status</span>
          <StatusBadge status={status} />
        </div>
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="tabular">{formatDateTime(createdAt, timeZone)}</dd>
          </div>
          {suspendedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Suspended</dt>
              <dd className="tabular">{formatDateTime(suspendedAt, timeZone)}</dd>
            </div>
          )}
          {archivedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Archived</dt>
              <dd className="tabular">{formatDateTime(archivedAt, timeZone)}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          {options.map((s) => {
            const a = ACTIONS[s];
            const Icon = a.icon;
            return (
              <Button key={s} variant={a.variant} size="sm" onClick={() => open(s)}>
                <Icon /> {a.label}
              </Button>
            );
          })}
        </div>

        {history.length > 0 && (
          <div className="border-t pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" /> Status history
            </p>
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {h.from && <StatusBadge status={h.from} />}
                    {h.from && h.to && <span className="text-muted-foreground">→</span>}
                    {h.to && <StatusBadge status={h.to} />}
                  </div>
                  {h.reason && <p className="mt-1 text-foreground/90">“{h.reason}”</p>}
                  <p className="mt-0.5 text-muted-foreground">
                    {h.actorName} · {formatDateTime(h.at, timeZone)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(o) => !o && !saving && setTarget(null)}>
        {action && target && (
          <DialogContent title={`${action.label} ${workspaceName}?`} description={action.explain}>
            <form onSubmit={confirm} className="space-y-4">
              <FormField label="Reason" htmlFor="status-reason" required error={error} hint="Recorded in the audit log with your name.">
                <Textarea
                  id="status-reason"
                  value={reason}
                  maxLength={500}
                  autoFocus
                  aria-invalid={Boolean(error)}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(null);
                  }}
                  placeholder={target === "ACTIVE" ? "e.g. Subscription renewed" : target === "SUSPENDED" ? "e.g. Payment overdue" : "e.g. Company closed"}
                />
              </FormField>
              {target === "ARCHIVED" && <Alert variant="warning">Archiving does not delete any data. Financial records stay immutable and auditable.</Alert>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" variant={action.variant === "outline" ? "default" : action.variant} loading={saving}>
                  {action.label} workspace
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

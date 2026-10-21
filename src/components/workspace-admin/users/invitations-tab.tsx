"use client";

import * as React from "react";
import { Ban, MailOpen, RefreshCw } from "lucide-react";
import { PERMISSIONS } from "@/lib/permissions";
import type { InvitationRow } from "@/lib/workspace-admin/members";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog, SearchInput, useMutation } from "../shared";
import { DeliveryNotice, type Delivery } from "./invite-dialog";

const EMAIL_LABEL: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  SENT: { label: "Delivered to Brevo", variant: "success" },
  DEV_LOGGED: { label: "Not sent (outbox)", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" },
};

export function InvitationsTab({ workspaceId, invitations, actorIsAdmin }: { workspaceId: string; invitations: InvitationRow[]; actorIsAdmin: boolean }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [revoking, setRevoking] = React.useState<InvitationRow | null>(null);
  const [resendResult, setResendResult] = React.useState<{ email: string; delivery: Delivery } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const { run } = useMutation();

  const q = query.trim().toLowerCase();
  const rows = invitations.filter((i) => (status === "all" || i.status === status) && (!q || [i.name, i.email, i.roleName, i.invitedByName].some((v) => v.toLowerCase().includes(q))));

  async function resend(inv: InvitationRow) {
    setBusyId(inv.id);
    const data = await run<{ invitation: { email: string }; delivery: Delivery }>(
      `/api/w/${workspaceId}/invitations/${inv.id}/resend`,
      { method: "POST" },
      { success: (d) => (d.delivery.status === "SENT" ? `A new invitation link was sent to ${d.invitation.email}` : null) },
    );
    setBusyId(null);
    if (data && data.delivery.status !== "SENT") setResendResult({ email: data.invitation.email, delivery: data.delivery });
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Search invitee, role or inviter…" className="sm:w-80" />
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Filter by status">
          <option value="all">All invitations</option>
          <option value="PENDING">Pending</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="EXPIRED">Expired</option>
          <option value="REVOKED">Revoked</option>
        </NativeSelect>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={MailOpen}
          title={invitations.length ? "No invitations match your filters" : "No invitations yet"}
          description={invitations.length ? "Try a different search or status." : "Invitations you send appear here with their delivery status."}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Invitee</TH>
              <TH>Role</TH>
              <TH>Invited by</TH>
              <TH>Sent</TH>
              <TH>Expires</TH>
              <TH>Status</TH>
              <TH>Email</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((inv) => {
              const locked = inv.roleIsAdmin && !actorIsAdmin;
              const email = inv.emailStatus ? EMAIL_LABEL[inv.emailStatus] : null;
              return (
                <TR key={inv.id}>
                  <TD className="min-w-[200px]">
                    <p className="font-medium">{inv.name}</p>
                    <p className="text-xs text-muted-foreground">{inv.email}</p>
                    {(inv.employeeId || inv.department) && (
                      <p className="text-[11px] text-muted-foreground">{[inv.employeeId, inv.department].filter(Boolean).join(" · ")}</p>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={inv.roleIsAdmin ? "default" : "secondary"}>{inv.roleName}</Badge>
                      {inv.permissionKeys.length > 0 && (
                        <Tooltip content={inv.permissionKeys.map((k) => PERMISSIONS[k].label).join(", ")}>
                          <span tabIndex={0}>
                            <Badge variant="outline">+{inv.permissionKeys.length} extra</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">{inv.invitedByName}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{inv.createdLabel}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{inv.status === "ACCEPTED" ? `Accepted ${inv.acceptedLabel ?? ""}` : inv.expiresLabel}</TD>
                  <TD>
                    <StatusBadge status={inv.status} />
                  </TD>
                  <TD>{email ? <Badge variant={email.variant}>{email.label}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      {inv.status !== "ACCEPTED" && (
                        <Button size="sm" variant="outline" onClick={() => resend(inv)} loading={busyId === inv.id} disabled={locked || (busyId !== null && busyId !== inv.id)}>
                          <RefreshCw /> Resend
                        </Button>
                      )}
                      {inv.status === "PENDING" && (
                        <Button size="sm" variant="ghost" className="text-expense hover:text-expense" onClick={() => setRevoking(inv)} disabled={locked}>
                          <Ban /> Revoke
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this invitation?"
        description={revoking ? `The link sent to ${revoking.email} stops working immediately. They stay listed as Invited, and you can send a new invitation later.` : undefined}
        confirmLabel="Revoke invitation"
        destructive
        reason="optional"
        onConfirm={async (reason) => {
          if (!revoking) return;
          const res = await run(`/api/w/${workspaceId}/invitations/${revoking.id}/revoke`, { method: "POST", body: { reason: reason || null } }, { success: "Invitation revoked" });
          return res !== null;
        }}
      />

      <Dialog open={resendResult !== null} onOpenChange={(o) => !o && setResendResult(null)}>
        <DialogContent title="New invitation created">
          {resendResult && <DeliveryNotice email={resendResult.email} delivery={resendResult.delivery} />}
          <DialogFooter>
            <Button onClick={() => setResendResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

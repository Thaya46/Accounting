"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, MailWarning, RotateCw, ShieldCheck, ShieldOff, UserPlus, Users, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { adminInviteSchema } from "@/lib/admin/schemas";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Avatar, Tooltip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import type { WorkspaceDetail } from "@/lib/admin/queries";
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from "./form-errors";

type Delivery = { status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string };

function announceDelivery(email: string, delivery: Delivery, workspaceActive: boolean) {
  if (delivery.status === "SENT") {
    toast.success(`Invitation emailed to ${email}`, {
      description: workspaceActive ? undefined : "The workspace is suspended — the link works once it is activated.",
    });
  } else {
    toast.warning(`Invitation created, but the email to ${email} was not delivered`, {
      description: "Open the Email Outbox to retrieve the invitation link.",
      duration: 10_000,
    });
  }
}

export function WorkspaceAdminsCard({
  workspaceId,
  workspaceStatus,
  admins,
  invitations,
  timeZone,
}: {
  workspaceId: string;
  workspaceStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  admins: WorkspaceDetail["admins"];
  invitations: WorkspaceDetail["invitations"];
  timeZone: string;
}) {
  const router = useRouter();
  const archived = workspaceStatus === "ARCHIVED";

  // Assign dialog
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", email: "" });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [assigning, setAssigning] = React.useState(false);

  // Resend / revoke
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<WorkspaceDetail["invitations"][number] | null>(null);
  const [revokeReason, setRevokeReason] = React.useState("");

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setAssignError(null);
    const parsed = adminInviteSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setAssigning(true);
    try {
      const res = await apiFetch<{ invitation: { email: string }; delivery: Delivery; workspaceActive: boolean }>(`/api/admin/workspaces/${workspaceId}/admins`, {
        method: "POST",
        body: parsed.data,
      });
      announceDelivery(res.invitation.email, res.delivery, res.workspaceActive);
      setAssignOpen(false);
      setForm({ name: "", email: "" });
      router.refresh();
    } catch (err) {
      const fe = apiFieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) setAssignError(errorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function resend(id: string) {
    setBusyId(id);
    try {
      const res = await apiFetch<{ invitation: { email: string }; delivery: Delivery; workspaceActive: boolean }>(`/api/admin/invitations/${id}/resend`, {
        method: "POST",
        body: {},
      });
      announceDelivery(res.invitation.email, res.delivery, res.workspaceActive);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not resend the invitation"));
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(e: React.FormEvent) {
    e.preventDefault();
    if (!revoking) return;
    setBusyId(revoking.id);
    try {
      await apiFetch(`/api/admin/invitations/${revoking.id}/revoke`, { method: "POST", body: { reason: revokeReason.trim() || undefined } });
      toast.success(`Invitation for ${revoking.email} revoked`);
      setRevoking(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not revoke the invitation"));
    } finally {
      setBusyId(null);
    }
  }

  const activeAdmins = admins.filter((a) => a.status === "ACTIVE").length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Workspace Admins</CardTitle>
          <CardDescription>Administrators manage users, settings and approvals inside the workspace.</CardDescription>
        </div>
        <Button
          size="sm"
          disabled={archived}
          title={archived ? "Activate the workspace to invite administrators" : undefined}
          onClick={() => {
            setErrors({});
            setAssignError(null);
            setAssignOpen(true);
          }}
        >
          <UserPlus /> Assign another admin
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {activeAdmins === 0 && !archived && (
          <Alert variant="warning" title="No active administrator">
            {invitations.length ? "The admin invitation has not been accepted yet." : "Invite an administrator so this workspace can be managed."}
          </Alert>
        )}

        {admins.length === 0 ? (
          <EmptyState icon={Users} title="No administrators yet" className="py-6" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {admins.map((a) => (
              <li key={a.membershipId} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={a.user.name} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {a.user.name}
                      <span className="font-mono text-[11px] font-normal text-muted-foreground">{a.user.ref}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{a.user.email}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
                  <StatusBadge status={a.status} />
                  {a.user.status === "DISABLED" && <Badge variant="danger">Account disabled</Badge>}
                  {a.status === "ACTIVE" &&
                    (a.user.mfaEnabled ? (
                      <Badge variant="info">
                        <ShieldCheck className="h-3 w-3" /> MFA
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <ShieldOff className="h-3 w-3" /> No MFA
                      </Badge>
                    ))}
                  <span className="text-xs text-muted-foreground">
                    {a.user.lastLoginAt ? `Last login ${formatDateTime(a.user.lastLoginAt, timeZone)}` : "Never signed in"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending admin invitations</p>
          {invitations.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No pending invitations.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{inv.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge status={inv.expired ? "EXPIRED" : "PENDING"} />
                      <span className="text-muted-foreground">
                        {inv.expired ? "Expired" : "Expires"} {formatDateTime(inv.expiresAt, timeZone)}
                      </span>
                      {inv.delivery ? (
                        inv.delivery.status === "SENT" ? (
                          <span className="inline-flex items-center gap-1 text-income">
                            <Mail className="h-3 w-3" /> Emailed
                          </span>
                        ) : (
                          <Tooltip content={inv.delivery.error ?? "Not delivered"}>
                            <Link href="/admin/outbox" className="inline-flex items-center gap-1 text-warning hover:underline">
                              <MailWarning className="h-3 w-3" /> {inv.delivery.status === "FAILED" ? "Email failed" : "In dev outbox"}
                            </Link>
                          </Tooltip>
                        )
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Invited by {inv.invitedByName} · {formatDateTime(inv.createdAt, timeZone)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" loading={busyId === inv.id && !revoking} disabled={archived || busyId !== null} onClick={() => resend(inv.id)}>
                      {busyId !== inv.id && <RotateCw />} Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-expense hover:text-expense"
                      disabled={busyId !== null}
                      onClick={() => {
                        setRevokeReason("");
                        setRevoking(inv);
                      }}
                    >
                      <XCircle /> Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <Dialog open={assignOpen} onOpenChange={(o) => !assigning && setAssignOpen(o)}>
        <DialogContent title="Assign another Workspace Admin" description="They receive a secure invitation to set their own password and enrol MFA.">
          <form onSubmit={assign} noValidate className="space-y-4">
            {assignError && <Alert variant="danger">{assignError}</Alert>}
            {workspaceStatus === "SUSPENDED" && (
              <Alert variant="warning">This workspace is suspended. The invitation can be accepted once it is activated.</Alert>
            )}
            <FormField label="Full name" htmlFor="admin-name" required error={errors.name}>
              <Input
                id="admin-name"
                value={form.name}
                maxLength={120}
                autoFocus
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }));
                  setErrors((er) => ({ ...er, name: undefined }));
                }}
              />
            </FormField>
            <FormField label="Email" htmlFor="admin-email" required error={errors.email}>
              <Input
                id="admin-email"
                type="email"
                value={form.email}
                maxLength={254}
                autoComplete="off"
                aria-invalid={Boolean(errors.email)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, email: e.target.value }));
                  setErrors((er) => ({ ...er, email: undefined }));
                }}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={assigning}>
                Cancel
              </Button>
              <Button type="submit" loading={assigning}>
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && busyId === null && setRevoking(null)}>
        {revoking && (
          <DialogContent title="Revoke invitation?" description={`The link sent to ${revoking.email} stops working immediately. You can invite them again later.`}>
            <form onSubmit={revoke} className="space-y-4">
              <FormField label="Reason (optional)" htmlFor="revoke-reason" hint="Recorded in the audit log.">
                <Textarea id="revoke-reason" value={revokeReason} maxLength={500} onChange={(e) => setRevokeReason(e.target.value)} />
              </FormField>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRevoking(null)} disabled={busyId !== null}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" loading={busyId === revoking.id}>
                  Revoke invitation
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

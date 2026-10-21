"use client";

import * as React from "react";
import { MailCheck, MailWarning, UserPlus } from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";
import type { RoleRow } from "@/lib/workspace-admin/roles";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { PermissionPicker, useMutation } from "../shared";

export type Delivery = { status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string; outbox?: boolean };

export function DeliveryNotice({ email, delivery }: { email: string; delivery: Delivery }) {
  if (delivery.status === "SENT") {
    return (
      <Alert variant="success" title="Invitation email sent">
        A secure one-time link was emailed to <strong>{email}</strong>. They choose their own password when they accept.
      </Alert>
    );
  }
  return (
    <Alert variant="warning" title="The invitation was created, but the email was not delivered">
      <p>
        {delivery.status === "DEV_LOGGED" ? "Email delivery (Brevo) is not configured on this server." : "Brevo could not deliver the email."}
        {delivery.error ? ` ${delivery.error}` : ""}
      </p>
      <p className="mt-1">
        {delivery.outbox === false
          ? "Ask the Super Admin to fix the email settings, then use Resend on the Invitations tab."
          : "The invitation link is available to the Super Admin in the Email Outbox. You can also use Resend on the Invitations tab once email is working."}
      </p>
    </Alert>
  );
}

export function InviteDialog({
  workspaceId,
  roles,
  actorIsAdmin,
  actorPermissions,
}: {
  workspaceId: string;
  roles: RoleRow[];
  actorIsAdmin: boolean;
  actorPermissions: PermissionKey[];
}) {
  const defaultRole = roles.find((r) => r.name === "Staff") ?? roles.find((r) => !r.isAdmin) ?? roles[0];
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", email: "", employeeId: "", department: "", roleId: defaultRole?.id ?? "" });
  const [extras, setExtras] = React.useState<PermissionKey[]>([]);
  const [result, setResult] = React.useState<{ email: string; delivery: Delivery } | null>(null);
  const { pending, run } = useMutation();

  const role = roles.find((r) => r.id === form.roleId);
  const grantableSet = new Set(actorPermissions);
  const roleNotGrantable = role && !actorIsAdmin && (role.isAdmin || role.permissionKeys.some((k) => !grantableSet.has(k)));

  function reset() {
    setForm({ name: "", email: "", employeeId: "", department: "", roleId: defaultRole?.id ?? "" });
    setExtras([]);
    setResult(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const roleKeys = new Set(role?.permissionKeys ?? []);
    const data = await run<{ invitation: { email: string }; delivery: Delivery }>(
      `/api/w/${workspaceId}/members`,
      {
        method: "POST",
        body: {
          name: form.name,
          email: form.email,
          employeeId: form.employeeId || null,
          department: form.department || null,
          roleId: form.roleId,
          permissionKeys: extras.filter((k) => !roleKeys.has(k)),
        },
      },
      { success: (d) => (d.delivery.status === "SENT" ? `Invitation sent to ${d.invitation.email}` : null) },
    );
    if (data) setResult({ email: data.invitation.email, delivery: data.delivery });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <UserPlus /> Invite user
      </Button>
      <DialogContent
        title={result ? "Invitation created" : "Invite a user"}
        description={result ? undefined : "They receive an email with a secure link to set their own password and join this workspace."}
        className="max-w-2xl"
      >
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {result.delivery.status === "SENT" ? <MailCheck className="h-8 w-8 text-income" /> : <MailWarning className="h-8 w-8 text-warning" />}
              <p className="text-sm">
                <strong>{result.email}</strong> now appears as <em>Invited</em> on the Members tab until they accept.
              </p>
            </div>
            <DeliveryNotice email={result.email} delivery={result.delivery} />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Invite another
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Full name" htmlFor="inv-name" required>
                <Input id="inv-name" value={form.name} onChange={set("name")} maxLength={120} autoComplete="off" required />
              </FormField>
              <FormField label="Email address" htmlFor="inv-email" required>
                <Input id="inv-email" type="email" value={form.email} onChange={set("email")} maxLength={254} autoComplete="off" required />
              </FormField>
              <FormField label="Employee ID" htmlFor="inv-emp">
                <Input id="inv-emp" value={form.employeeId} onChange={set("employeeId")} maxLength={50} />
              </FormField>
              <FormField label="Department" htmlFor="inv-dept">
                <Input id="inv-dept" value={form.department} onChange={set("department")} maxLength={80} />
              </FormField>
              <FormField label="Role" htmlFor="inv-role" required hint={role?.description ?? undefined}>
                <NativeSelect id="inv-role" value={form.roleId} onChange={set("roleId")} required>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id} disabled={!actorIsAdmin && r.isAdmin}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Account status" htmlFor="inv-status" hint="Shown as Invited until they accept; you can disable the account at any time.">
                <Input id="inv-status" value="Active once the invitation is accepted" disabled />
              </FormField>
            </div>

            {role?.isAdmin && (
              <Alert variant="info" title="Workspace Admin">
                Workspace Admins have every permission and must set up two-step verification (authenticator app) when they first sign in.
              </Alert>
            )}
            {roleNotGrantable && (
              <Alert variant="warning">You can only grant roles whose permissions you hold yourself. Ask a Workspace Admin to send this invitation.</Alert>
            )}

            <div>
              <p className="mb-1 text-sm font-medium">Assigned permissions</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Permissions marked <span className="font-semibold text-primary">Role</span> come with the selected role. Tick others to grant them to this person only.
              </p>
              <PermissionPicker
                idPrefix="inv"
                value={extras}
                onChange={setExtras}
                included={role?.permissionKeys ?? []}
                grantable={actorIsAdmin ? null : actorPermissions}
                disabled={role?.isAdmin}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={!form.name.trim() || !form.email.trim() || !form.roleId || Boolean(roleNotGrantable)}>
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

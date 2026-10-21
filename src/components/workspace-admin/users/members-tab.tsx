"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, ShieldCheck, ShieldOff, UserCheck, UserX, Users } from "lucide-react";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import type { MemberRow } from "@/lib/workspace-admin/members";
import type { RoleRow } from "@/lib/workspace-admin/roles";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, FormField } from "@/components/ui/feedback";
import { Avatar, Tooltip } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { ConfirmDialog, PermissionPicker, SearchInput, useMutation } from "../shared";

type Common = {
  workspaceId: string;
  roles: RoleRow[];
  currentUserId: string;
  actorIsAdmin: boolean;
  actorPermissions: PermissionKey[];
};

/** Mirrors the server rule so the UI only offers actions the server will accept. */
function canManage(m: MemberRow, c: Common) {
  if (c.actorIsAdmin) return true;
  if (m.userId === c.currentUserId || m.roleIsAdmin) return false;
  const own = new Set(c.actorPermissions);
  return [...m.rolePermissions, ...m.extraPermissions].every((k) => own.has(k));
}

export function MembersTab({ members, ...c }: Common & { members: MemberRow[] }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [editing, setEditing] = React.useState<MemberRow | null>(null);
  const [toggling, setToggling] = React.useState<MemberRow | null>(null);
  const { run } = useMutation();

  const q = query.trim().toLowerCase();
  const rows = members.filter(
    (m) =>
      (status === "all" || m.status === status) &&
      (!q || [m.name, m.email, m.ref, m.employeeId, m.department, m.roleName].some((v) => v?.toLowerCase().includes(q))),
  );
  const activeAdmins = members.filter((m) => m.status === "ACTIVE" && m.roleIsAdmin && m.userStatus === "ACTIVE").length;

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, email, ID, department…" className="sm:w-80" />
        <div className="flex items-center gap-2">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="DISABLED">Disabled</option>
          </NativeSelect>
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular">
            {rows.length} of {members.length}
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Users} title={members.length ? "No members match your filters" : "No members yet"} description={members.length ? "Try a different search or status." : "Invite your first teammate to get started."} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Member</TH>
              <TH>Employee ID</TH>
              <TH>Department</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>MFA</TH>
              <TH>Last login</TH>
              <TH className="w-10">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((m) => {
              const self = m.userId === c.currentUserId;
              const manageable = canManage(m, c);
              return (
                <TR key={m.id}>
                  <TD className="min-w-[220px]">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {m.name}
                          {self && <Badge variant="muted">You</Badge>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{m.ref}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">{m.employeeId ?? "—"}</TD>
                  <TD className="text-muted-foreground">{m.department ?? "—"}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={m.roleIsAdmin ? "default" : "secondary"}>{m.roleName}</Badge>
                      {m.extraPermissions.length > 0 && (
                        <Tooltip content={m.extraPermissions.map((k) => PERMISSIONS[k].label).join(", ")}>
                          <span tabIndex={0} className="cursor-default">
                            <Badge variant="outline">+{m.extraPermissions.length} extra</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={m.status} />
                      {m.userStatus === "DISABLED" && <span className="text-[11px] text-expense">Account disabled platform-wide</span>}
                    </div>
                  </TD>
                  <TD>
                    {m.mfaEnabled ? (
                      <span className="inline-flex items-center gap-1 text-xs text-income">
                        <ShieldCheck className="h-3.5 w-3.5" /> On
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ShieldOff className="h-3.5 w-3.5" /> Off
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{m.lastLoginLabel ?? "Never"}</TD>
                  <TD>
                    {manageable ? (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setEditing(m)}>
                            <Pencil /> Edit access
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {m.status === "DISABLED" ? (
                            <DropdownMenuItem onSelect={() => setToggling(m)}>
                              <UserCheck /> Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => setToggling(m)} disabled={self} className="text-expense focus:text-expense [&_svg]:!text-expense">
                              <UserX /> {m.status === "INVITED" ? "Cancel invitation & disable" : "Disable"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Tooltip content={self ? "Ask another Workspace Admin to change your access" : "Only a Workspace Admin can manage this member"}>
                        <span tabIndex={0} className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground/50">
                          <MoreHorizontal className="h-4 w-4" />
                        </span>
                      </Tooltip>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {editing && <EditMemberDialog member={editing} onClose={() => setEditing(null)} activeAdmins={activeAdmins} {...c} />}

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === "DISABLED" ? `Reactivate ${toggling?.name}?` : `Disable ${toggling?.name}?`}
        description={
          toggling?.status === "DISABLED"
            ? "They will be able to sign in to this workspace again with their existing role and permissions."
            : "They lose access to this workspace immediately. Their past transactions and audit history stay attributed to them."
        }
        confirmLabel={toggling?.status === "DISABLED" ? "Reactivate" : "Disable access"}
        destructive={toggling?.status !== "DISABLED"}
        reason={toggling?.status === "DISABLED" ? "optional" : "required"}
        onConfirm={async (reason) => {
          if (!toggling) return;
          const reactivate = toggling.status === "DISABLED";
          const res = await run<{ sessionsRevoked: boolean }>(
            `/api/w/${c.workspaceId}/members/${toggling.id}`,
            { method: "PATCH", body: reactivate ? { action: "reactivate", reason: reason || null } : { action: "disable", reason } },
            {
              success: (d) =>
                reactivate ? `${toggling.name} reactivated` : `${toggling.name} disabled${d.sessionsRevoked ? " and signed out everywhere" : ""}`,
            },
          );
          return res !== null;
        }}
      >
        {toggling && toggling.status !== "DISABLED" && toggling.roleIsAdmin && toggling.status === "ACTIVE" && activeAdmins <= 1 && (
          <Alert variant="danger">This is the last active Workspace Admin. Give someone else the Workspace Admin role first.</Alert>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function EditMemberDialog({ member, onClose, activeAdmins, workspaceId, roles, currentUserId, actorIsAdmin, actorPermissions }: Common & { member: MemberRow; onClose: () => void; activeAdmins: number }) {
  const [roleId, setRoleId] = React.useState(member.roleId);
  const [extras, setExtras] = React.useState<PermissionKey[]>(member.extraPermissions);
  const [employeeId, setEmployeeId] = React.useState(member.employeeId ?? "");
  const [department, setDepartment] = React.useState(member.department ?? "");
  const { pending, run } = useMutation();

  const role = roles.find((r) => r.id === roleId);
  const self = member.userId === currentUserId;
  const demotingLastAdmin = member.roleIsAdmin && member.status === "ACTIVE" && role && !role.isAdmin && activeAdmins <= 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const roleKeys = new Set(role?.permissionKeys ?? []);
    const ok = await run(
      `/api/w/${workspaceId}/members/${member.id}`,
      {
        method: "PATCH",
        body: { action: "update", roleId, permissionKeys: extras.filter((k) => !roleKeys.has(k)), employeeId: employeeId || null, department: department || null },
      },
      { success: `Access updated for ${member.name}` },
    );
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent title={`Edit ${member.name}`} description={`${member.email} · ${member.ref}`} className="max-w-2xl">
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Role" htmlFor="edit-role" required className="sm:col-span-1">
              <NativeSelect id="edit-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={!actorIsAdmin && r.isAdmin}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Employee ID" htmlFor="edit-emp">
              <Input id="edit-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} maxLength={50} />
            </FormField>
            <FormField label="Department" htmlFor="edit-dept">
              <Input id="edit-dept" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={80} />
            </FormField>
          </div>
          {role?.description && <p className="-mt-2 text-xs text-muted-foreground">{role.description}</p>}

          {demotingLastAdmin && <Alert variant="danger">This is the last active Workspace Admin, so the role cannot be changed until someone else is an admin.</Alert>}
          {self && member.roleIsAdmin && role && !role.isAdmin && !demotingLastAdmin && (
            <Alert variant="warning">You are removing your own Workspace Admin role. You may lose access to this page.</Alert>
          )}
          {role?.isAdmin && !member.roleIsAdmin && !member.mfaEnabled && member.status === "ACTIVE" && (
            <Alert variant="info">Workspace Admins must use two-step verification. {member.name} will be signed out and asked to set it up at next sign-in.</Alert>
          )}
          {member.status === "INVITED" && <Alert variant="info">Changes also apply to their pending invitation.</Alert>}

          <div>
            <p className="mb-1 text-sm font-medium">Permissions</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Permissions marked <span className="font-semibold text-primary">Role</span> come from the {role?.name ?? "selected"} role. Extra permissions apply to this member only.
            </p>
            <PermissionPicker
              idPrefix="edit"
              value={extras}
              onChange={setExtras}
              included={role?.permissionKeys ?? []}
              grantable={actorIsAdmin ? null : actorPermissions}
              disabled={role?.isAdmin}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={Boolean(demotingLastAdmin)}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

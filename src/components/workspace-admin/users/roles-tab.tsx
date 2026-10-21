"use client";

import * as React from "react";
import { Check, Lock, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { PERMISSION_GROUPS } from "@/lib/workspace-admin/constants";
import type { RoleRow } from "@/lib/workspace-admin/roles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { ConfirmDialog, PermissionPicker, useMutation } from "../shared";

type Props = { workspaceId: string; roles: RoleRow[]; actorIsAdmin: boolean; actorPermissions: PermissionKey[]; actorRoleId: string };

export function RolesTab({ workspaceId, roles, actorIsAdmin, actorPermissions, actorRoleId }: Props) {
  const [editing, setEditing] = React.useState<RoleRow | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<RoleRow | null>(null);
  const { run } = useMutation();
  const own = new Set(actorPermissions);

  function editBlock(r: RoleRow): string | null {
    if (r.isAdmin) return "The Workspace Admin role always has every permission";
    if (actorIsAdmin) return null;
    if (r.id === actorRoleId) return "You cannot change the role you hold";
    if (r.permissionKeys.some((k) => !own.has(k))) return "This role has permissions you do not hold";
    return null;
  }
  function deleteBlock(r: RoleRow): string | null {
    if (r.isSystem || r.isAdmin) return "Built-in roles cannot be deleted";
    if (r.memberCount > 0) return `Assigned to ${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`;
    if (r.invitationCount > 0) return "Referenced by invitation history";
    return editBlock(r);
  }

  return (
    <Card>
      <CardHeader className="flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Roles &amp; permissions</CardTitle>
          <CardDescription>Each member gets one role plus optional extra permissions. Changes apply on their next request.</CardDescription>
        </div>
        <Button onClick={() => setEditing("new")} size="sm">
          <Plus /> Create custom role
        </Button>
      </CardHeader>
      <div className="relative w-full overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="sticky left-0 z-10 min-w-[200px] bg-muted px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Permission</th>
              {roles.map((r) => {
                const eb = editBlock(r);
                const db = deleteBlock(r);
                return (
                  <th key={r.id} className="min-w-[140px] px-3 py-3 text-center align-top font-normal">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold">{r.name}</span>
                      <div className="flex flex-wrap justify-center gap-1">
                        {r.isAdmin ? <Badge variant="default">Admin</Badge> : r.isSystem ? <Badge variant="muted">Built-in</Badge> : <Badge variant="info">Custom</Badge>}
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular">
                        {r.activeMemberCount} active · {r.memberCount} total
                      </span>
                      <div className="flex gap-0.5">
                        <Tooltip content={eb ?? "Edit role"}>
                          <span tabIndex={eb ? 0 : -1}>
                            <Button variant="ghost" size="icon-sm" disabled={Boolean(eb)} onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                              {r.isAdmin ? <Lock /> : <Pencil />}
                            </Button>
                          </span>
                        </Tooltip>
                        {!r.isSystem && (
                          <Tooltip content={db ?? "Delete role"}>
                            <span tabIndex={db ? 0 : -1}>
                              <Button variant="ghost" size="icon-sm" disabled={Boolean(db)} onClick={() => setDeleting(r)} aria-label={`Delete ${r.name}`} className="text-expense hover:text-expense">
                                <Trash2 />
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((g) => (
              <React.Fragment key={g.title}>
                <tr className="border-b bg-muted/30">
                  <td colSpan={roles.length + 1} className="sticky left-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.title}
                  </td>
                </tr>
                {g.keys.map((k) => (
                  <tr key={k} className="border-b transition-colors hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <Tooltip content={PERMISSIONS[k].description} side="right">
                        <span tabIndex={0} className="cursor-default font-medium">
                          {PERMISSIONS[k].label}
                        </span>
                      </Tooltip>
                    </td>
                    {roles.map((r) => {
                      const has = r.permissionKeys.includes(k);
                      return (
                        <td key={r.id} className="px-3 py-2 text-center">
                          {has ? (
                            <Check className={cn("mx-auto h-4 w-4", r.isAdmin ? "text-primary" : "text-income")} aria-label="Granted" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="Not granted" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Built-in roles can have their permissions adjusted but not be renamed or deleted. The Workspace Admin role is read-only and always has full access.
      </p>

      {editing && (
        <RoleDialog
          key={editing === "new" ? "new" : editing.id}
          workspaceId={workspaceId}
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          grantable={actorIsAdmin ? null : actorPermissions}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the ${deleting?.name ?? ""} role?`}
        description="The role is removed permanently. This is recorded in the audit log."
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await run(`/api/w/${workspaceId}/roles/${deleting.id}`, { method: "DELETE" }, { success: `Role ${deleting.name} deleted` });
          return res !== null;
        }}
      />
    </Card>
  );
}

function RoleDialog({ workspaceId, role, onClose, grantable }: { workspaceId: string; role: RoleRow | null; onClose: () => void; grantable: PermissionKey[] | null }) {
  const [name, setName] = React.useState(role?.name ?? "");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [keys, setKeys] = React.useState<PermissionKey[]>(role?.permissionKeys ?? []);
  const { pending, run } = useMutation();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...(role?.isSystem ? {} : { name }), description: description || null, permissionKeys: keys };
    const res = role
      ? await run(`/api/w/${workspaceId}/roles/${role.id}`, { method: "PATCH", body }, { success: `Role ${role.name} updated` })
      : await run(`/api/w/${workspaceId}/roles`, { method: "POST", body }, { success: `Role ${name.trim()} created` });
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        title={role ? `Edit ${role.name}` : "Create custom role"}
        description={role ? "Members with this role get the new permissions on their next request." : "Name the role and choose what it allows."}
        className="max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Role name" htmlFor="role-name" required hint={role?.isSystem ? "Built-in role names cannot change." : undefined}>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={role?.isSystem} required />
            </FormField>
            <FormField label="Description" htmlFor="role-desc">
              <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} className="min-h-[36px]" />
            </FormField>
          </div>
          {role && role.activeMemberCount > 0 && (
            <Alert variant="info">
              {role.activeMemberCount} active member{role.activeMemberCount === 1 ? " has" : "s have"} this role.
            </Alert>
          )}
          <div>
            <p className="mb-3 text-sm font-medium">Permissions</p>
            <PermissionPicker idPrefix="role" value={keys} onChange={setKeys} grantable={grantable} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={name.trim().length < 2 || keys.length === 0}>
              {role ? "Save role" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

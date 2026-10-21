"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/misc";

type Props = {
  user: { name: string; email: string; ref: string; platformRole: string };
  memberships: { workspaceName: string; workspaceCode: string; role: string; status: string; employeeId: string | null; department: string | null }[];
};

export function ProfilePanel({ user, memberships }: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(user.name);
  const [saving, setSaving] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/account", { method: "PATCH", body: { name } });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader className="flex-row items-center gap-4">
          <Avatar name={user.name} className="h-14 w-14 text-base" />
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">{user.name}</CardTitle>
            <CardDescription className="truncate">{user.email}</CardDescription>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{user.ref}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <FormField label="Full name" htmlFor="name" hint="Your name appears on transactions you record. Earlier entries keep the name used at the time.">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Email" htmlFor="email" hint="Contact an administrator to change your sign-in email.">
              <Input id="email" value={user.email} disabled />
            </FormField>
            <Button type="submit" size="sm" loading={saving} disabled={name.trim().length < 2 || name === user.name}>
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{user.platformRole === "SUPER_ADMIN" ? "Platform role" : "Workspace memberships"}</CardTitle>
          <CardDescription>{user.platformRole === "SUPER_ADMIN" ? "You manage the whole platform." : "Workspaces you can access and your role in each."}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {user.platformRole === "SUPER_ADMIN" ? (
            <p className="text-sm">Super Admin</p>
          ) : (
            memberships.map((m) => (
              <div key={m.workspaceCode} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium">{m.workspaceName}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.role}
                    {m.department ? ` · ${m.department}` : ""}
                    {m.employeeId ? ` · Employee ${m.employeeId}` : ""}
                  </p>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import * as React from "react";
import { KeyRound, MailOpen, Users } from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";
import type { InvitationRow, MemberRow } from "@/lib/workspace-admin/members";
import type { RoleRow } from "@/lib/workspace-admin/roles";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { SectionCount } from "../shared";
import { MembersTab } from "./members-tab";
import { InvitationsTab } from "./invitations-tab";
import { RolesTab } from "./roles-tab";

const TABS = ["members", "invitations", "roles"] as const;
type Tab = (typeof TABS)[number];

export function UsersClient(props: {
  workspaceId: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  roles: RoleRow[];
  currentUserId: string;
  actorIsAdmin: boolean;
  actorRoleId: string;
  actorPermissions: PermissionKey[];
  initialTab?: string;
}) {
  const [tab, setTab] = React.useState<Tab>(TABS.includes(props.initialTab as Tab) ? (props.initialTab as Tab) : "members");
  const pending = props.invitations.filter((i) => i.status === "PENDING").length;

  function change(value: string) {
    setTab(value as Tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={change}>
      <div className="overflow-x-auto scrollbar-thin">
        <TabsList>
          <TabsTrigger value="members">
            <Users /> Members <SectionCount>{props.members.length}</SectionCount>
          </TabsTrigger>
          <TabsTrigger value="invitations">
            <MailOpen /> Invitations {pending > 0 && <SectionCount>{pending}</SectionCount>}
          </TabsTrigger>
          <TabsTrigger value="roles">
            <KeyRound /> Roles &amp; Permissions
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="members">
        <MembersTab
          workspaceId={props.workspaceId}
          members={props.members}
          roles={props.roles}
          currentUserId={props.currentUserId}
          actorIsAdmin={props.actorIsAdmin}
          actorPermissions={props.actorPermissions}
        />
      </TabsContent>
      <TabsContent value="invitations">
        <InvitationsTab workspaceId={props.workspaceId} invitations={props.invitations} actorIsAdmin={props.actorIsAdmin} />
      </TabsContent>
      <TabsContent value="roles">
        <RolesTab
          workspaceId={props.workspaceId}
          roles={props.roles}
          actorIsAdmin={props.actorIsAdmin}
          actorPermissions={props.actorPermissions}
          actorRoleId={props.actorRoleId}
        />
      </TabsContent>
    </Tabs>
  );
}

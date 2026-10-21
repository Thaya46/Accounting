import { requireWorkspace } from "@/lib/auth/guards";
import { listInvitations, listMembers } from "@/lib/workspace-admin/members";
import { listRoles } from "@/lib/workspace-admin/roles";
import { PageHeader } from "@/components/ui/feedback";
import { InviteDialog } from "@/components/workspace-admin/users/invite-dialog";
import { UsersClient } from "@/components/workspace-admin/users/users-client";

export const metadata = { title: "Users & Roles" };

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const { tab } = await searchParams;
  const ctx = await requireWorkspace(workspaceId, "USERS_MANAGE");
  const [members, invitations, roles] = await Promise.all([
    listMembers(ctx.workspace.id, ctx.workspace.timeZone),
    listInvitations(ctx.workspace.id, ctx.workspace.timeZone),
    listRoles(ctx.workspace.id),
  ]);
  const actorPermissions = [...ctx.permissions];

  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Invite people, manage their roles and permissions, and disable access. Historical attribution is always kept."
        actions={<InviteDialog workspaceId={ctx.workspace.id} roles={roles} actorIsAdmin={ctx.membership.isAdmin} actorPermissions={actorPermissions} />}
      />
      <UsersClient
        workspaceId={ctx.workspace.id}
        members={members}
        invitations={invitations}
        roles={roles}
        currentUserId={ctx.user.id}
        actorIsAdmin={ctx.membership.isAdmin}
        actorRoleId={ctx.membership.roleId}
        actorPermissions={actorPermissions}
        initialTab={tab}
      />
    </>
  );
}

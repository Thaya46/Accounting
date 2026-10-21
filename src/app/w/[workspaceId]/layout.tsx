import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth/guards";
import { getAuth } from "@/lib/auth/session";
import { listUserWorkspaces } from "@/lib/auth/workspace";
import { AppShell } from "@/components/shell/app-shell";
import { TallyShortcutBar } from "@/components/tally/tally-shortcut-bar";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId);
  const [workspaces, auth] = await Promise.all([listUserWorkspaces(ctx.user.id), getAuth()]);
  if (auth && auth.session.activeWorkspaceId !== workspaceId) {
    await prisma.session.update({ where: { id: auth.session.id }, data: { activeWorkspaceId: workspaceId } }).catch(() => {});
  }
  return (
    <AppShell
      variant="workspace"
      user={{ name: ctx.user.name, email: ctx.user.email, roleLabel: ctx.membership.roleName }}
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name, code: ctx.workspace.code }}
      workspaces={workspaces}
      permissions={[...ctx.permissions]}
    >
      {children}
      <TallyShortcutBar workspaceId={ctx.workspace.id} />
    </AppShell>
  );
}

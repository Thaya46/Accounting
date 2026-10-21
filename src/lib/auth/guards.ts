import { cache } from "react";
import { redirect } from "next/navigation";
import type { PermissionKey } from "@/lib/permissions";
import { getAuth, type AuthUser } from "./session";
import { loadWorkspaceContext as loadUncached, type WorkspaceContext } from "./workspace";

/** Memoised per request: the layout and the page share one membership lookup. */
const loadWorkspaceContext = cache((user: AuthUser, workspaceId: string) => loadUncached(user, workspaceId));

/** Page guard: signed in and past the MFA step. */
export async function requireAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.session.mfaVerified) redirect(auth.user.mfaEnabled ? "/mfa" : "/setup-mfa");
  return auth;
}

export async function requireSuperAdmin() {
  const auth = await requireAuth();
  if (auth.user.platformRole !== "SUPER_ADMIN") redirect("/access-denied?reason=super-admin");
  return auth;
}

/**
 * Page guard for /w/[workspaceId]/… routes. Membership, workspace status and the
 * optional permission are all checked on the server.
 */
export async function requireWorkspace(workspaceId: string, permission?: PermissionKey | PermissionKey[]): Promise<WorkspaceContext> {
  const auth = await requireAuth();
  const result = await loadWorkspaceContext(auth.user, workspaceId);
  if (!result.ok) {
    redirect(`/access-denied?reason=${result.error === "INACTIVE" ? "workspace-inactive" : "workspace"}`);
  }
  const needed = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (needed.length && !needed.some((p) => result.ctx.permissions.has(p))) {
    redirect(`/access-denied?reason=permission&workspace=${workspaceId}`);
  }
  return result.ctx;
}

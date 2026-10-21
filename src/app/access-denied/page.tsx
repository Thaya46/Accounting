import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuth } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Access denied" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  workspace: { title: "Access denied", body: "You are not a member of this workspace, or your access has been disabled. Workspace data is only visible to its members." },
  "workspace-inactive": { title: "Workspace unavailable", body: "This workspace is suspended or archived. Contact your administrator." },
  permission: { title: "Permission required", body: "Your role does not include access to this page. Ask a workspace administrator if you need it." },
  "super-admin": { title: "Super Admin only", body: "This area is restricted to platform Super Admins." },
  "no-workspace": { title: "No workspace yet", body: "Your account is not active in any workspace. Ask an administrator to invite you, or check your email for an invitation." },
};

export default async function AccessDenied({ searchParams }: { searchParams: Promise<{ reason?: string; workspace?: string }> }) {
  const { reason = "workspace", workspace } = await searchParams;
  const auth = await getAuth();
  const msg = MESSAGES[reason] ?? MESSAGES.workspace;
  const back = workspace && reason === "permission" ? `/w/${workspace}/dashboard` : "/";
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-expense-soft">
          <ShieldAlert className="h-6 w-6 text-expense" />
        </div>
        <h1 className="text-xl font-semibold">{msg.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{msg.body}</p>
        <div className="mt-6 flex justify-center gap-2">
          {auth ? (
            <Button asChild>
              <Link href={back}>Go to my dashboard</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/feedback";
import { findInvitationByToken } from "@/lib/workspaces/invitations";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findInvitationByToken(token);
  if ("error" in found) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
        <Alert variant="warning" className="mt-6">
          {found.error}
        </Alert>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </>
    );
  }
  const { invitation, existingUserHasPassword } = found;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {invitation.workspace.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {invitation.invitedByName} invited <span className="font-medium text-foreground">{invitation.email}</span> as{" "}
        <span className="font-medium text-foreground">{invitation.role.name}</span>.
      </p>
      <AcceptInviteForm token={token} defaultName={invitation.name} existingAccount={existingUserHasPassword} isAdmin={invitation.role.isAdmin} />
    </>
  );
}

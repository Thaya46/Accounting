import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth, isMfaRequired } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";
import { MfaSetup } from "@/components/auth/mfa-setup";

export const metadata: Metadata = { title: "Set up two-step verification" };

export default async function SetupMfaPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (auth.user.mfaEnabled) redirect(auth.session.mfaVerified ? await homePathFor(auth.user, auth.session.activeWorkspaceId) : "/mfa");
  const required = await isMfaRequired(auth.user.id);
  if (!required && auth.session.mfaVerified) redirect(await homePathFor(auth.user, auth.session.activeWorkspaceId));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Set up two-step verification</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your role requires an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) to protect financial data.
      </p>
      <div className="mt-6">
        <MfaSetup continueLabel="Continue to VLedger" />
      </div>
    </>
  );
}

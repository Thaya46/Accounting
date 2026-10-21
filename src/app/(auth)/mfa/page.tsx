import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verify sign-in" };

export default async function MfaPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (auth.session.mfaVerified) redirect(await homePathFor(auth.user, auth.session.activeWorkspaceId));
  if (!auth.user.mfaEnabled) redirect("/setup-mfa");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app for {auth.user.email}.</p>
      <MfaForm />
    </>
  );
}

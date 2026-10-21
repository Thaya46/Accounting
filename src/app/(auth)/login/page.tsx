import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth?.session.mfaVerified) redirect(await homePathFor(auth.user, auth.session.activeWorkspaceId));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Use the email address your administrator invited.</p>
      <LoginForm />
    </>
  );
}

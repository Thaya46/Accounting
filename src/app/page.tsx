import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";

export default async function Home() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.session.mfaVerified) redirect(auth.user.mfaEnabled ? "/mfa" : "/setup-mfa");
  redirect(await homePathFor(auth.user, auth.session.activeWorkspaceId));
}

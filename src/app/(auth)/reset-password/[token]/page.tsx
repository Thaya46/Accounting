"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { PASSWORD_RULES, PasswordChecklist } from "@/components/auth/password-checklist";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const strong = PASSWORD_RULES.every(([re]) => re.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/reset-password", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {done ? (
        <>
          <Alert variant="success" className="mt-8">
            Your password was changed and all other sessions were signed out.
          </Alert>
          <Button asChild className="mt-6 w-full" size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          {error && <Alert variant="danger">{error}</Alert>}
          <FormField label="New password" htmlFor="password">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </FormField>
          <PasswordChecklist password={password} />
          <FormField label="Confirm password" htmlFor="confirm">
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </FormField>
          <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!strong || !confirm}>
            Update password
          </Button>
        </form>
      )}
    </>
  );
}

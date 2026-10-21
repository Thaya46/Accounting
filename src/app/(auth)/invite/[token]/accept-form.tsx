"use client";

import * as React from "react";
import { apiFetch } from "@/lib/client/api";
import { PASSWORD_RULES, PasswordChecklist } from "@/components/auth/password-checklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";

export function AcceptInviteForm({ token, defaultName, existingAccount, isAdmin }: { token: string; defaultName: string; existingAccount: boolean; isAdmin: boolean }) {
  const [name, setName] = React.useState(defaultName);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const strong = PASSWORD_RULES.every(([re]) => re.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!existingAccount && password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const { next } = await apiFetch<{ next: string }>("/api/auth/invite/accept", { body: { token, name, password } });
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {existingAccount ? (
        <Alert variant="info">You already have a VLedger account. Confirm your password to add this workspace.</Alert>
      ) : (
        <FormField label="Full name" htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </FormField>
      )}
      <FormField label={existingAccount ? "Your password" : "Choose a password"} htmlFor="password">
        <Input id="password" type="password" autoComplete={existingAccount ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </FormField>
      {!existingAccount && (
        <>
          <PasswordChecklist password={password} />
          <FormField label="Confirm password" htmlFor="confirm">
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </FormField>
        </>
      )}
      {isAdmin && <p className="text-xs text-muted-foreground">Next, you&apos;ll set up an authenticator app — required for administrators.</p>}
      <Button type="submit" className="w-full" size="lg" loading={loading} disabled={existingAccount ? !password : !strong || !confirm || name.trim().length < 2}>
        {existingAccount ? "Join workspace" : "Activate account"}
      </Button>
    </form>
  );
}

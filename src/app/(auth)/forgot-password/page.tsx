"use client";

import * as React from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ message: string }>("/api/auth/forgot-password", { body: { email } });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a single-use link that expires in 30 minutes.</p>
      {done ? (
        <Alert variant="success" className="mt-8">
          {done}
        </Alert>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          {error && <Alert variant="danger">{error}</Alert>}
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </FormField>
          <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!email}>
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    </>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";

export function MfaForm() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { next } = await apiFetch<{ next: string }>("/api/auth/mfa/verify", { body: { code, recovery } });
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setLoading(false);
    }
  }

  async function cancel() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {recovery ? (
        <FormField label="Recovery code" htmlFor="code" hint="Each recovery code works once.">
          <Input id="code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxxx-xxxxx" autoFocus />
        </FormField>
      ) : (
        <FormField label="Authentication code" htmlFor="code">
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="h-12 text-center font-mono text-xl tracking-[0.5em]"
            autoFocus
          />
        </FormField>
      )}
      <Button type="submit" className="w-full" size="lg" loading={loading} disabled={recovery ? code.length < 8 : code.length !== 6}>
        Verify
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setRecovery((r) => !r); setCode(""); setError(null); }}>
          {recovery ? "Use authenticator code" : "Use a recovery code"}
        </button>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

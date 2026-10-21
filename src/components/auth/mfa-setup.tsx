"use client";

import * as React from "react";
import { Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, FormField, Skeleton } from "@/components/ui/feedback";

type Setup = { secret: string; otpauthUri: string; qrDataUrl: string };

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const download = () => {
    const blob = new Blob([`VLedger AI recovery codes\nEach code can be used once.\n\n${text}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vledger-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-4 font-mono text-sm">
        {codes.map((c) => (
          <span key={c} className="tabular">
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Recovery codes copied"))}>
          <Copy /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}

/** Authenticator enrolment: QR code → verify code → show one-time recovery codes. */
export function MfaSetup({ continueLabel = "Done", onDone }: { continueLabel?: string; onDone?: () => void }) {
  const [setup, setSetup] = React.useState<Setup | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ recoveryCodes: string[]; next: string } | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    apiFetch<Setup>("/api/auth/mfa/setup")
      .then(setSetup)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not start setup"));
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await apiFetch<{ recoveryCodes: string[]; next: string }>("/api/auth/mfa/setup", { body: { code } });
      setResult(r);
      toast.success("Two-step verification is on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-5">
        <Alert variant="success" title="Two-step verification enabled">
          Save these backup recovery codes somewhere safe. Use one if you lose access to your authenticator app. They are shown only once.
        </Alert>
        <RecoveryCodes codes={result.recoveryCodes} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          I have saved my recovery codes
        </label>
        <Button
          className="w-full"
          size="lg"
          disabled={!saved}
          onClick={() => {
            if (onDone) onDone();
            else {
              window.location.assign(result.next);
            }
          }}
        >
          <ShieldCheck /> {continueLabel}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-5">
      {error && <Alert variant="danger">{error}</Alert>}
      <ol className="space-y-4 text-sm">
        <li>
          <p className="font-medium">1. Scan this QR code with your authenticator app</p>
          <div className="mt-3 flex flex-col items-center gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-start">
            {setup ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="rounded" />
            ) : (
              <Skeleton className="h-[180px] w-[180px] bg-slate-100" />
            )}
            <div className="min-w-0 text-slate-700">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <KeyRound className="h-3.5 w-3.5" /> Can&apos;t scan? Enter this key:
              </p>
              <p className="mt-1 break-all font-mono text-xs">{setup?.secret.replace(/(.{4})/g, "$1 ").trim() ?? "…"}</p>
            </div>
          </div>
        </li>
        <li>
          <p className="font-medium">2. Enter the 6-digit code it shows</p>
          <FormField label="Verification code" htmlFor="totp" className="mt-2">
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="h-11 text-center font-mono text-lg tracking-[0.4em]"
            />
          </FormField>
        </li>
      </ol>
      <Button type="submit" className="w-full" size="lg" loading={loading} disabled={code.length !== 6 || !setup}>
        Verify and enable
      </Button>
    </form>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, FormField, Skeleton } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { MfaSetup, RecoveryCodes } from "@/components/auth/mfa-setup";
import { PASSWORD_RULES, PasswordChecklist } from "@/components/auth/password-checklist";

type Security = {
  mfaEnabled: boolean;
  mfaRequired: boolean;
  recoveryCodesRemaining: number;
  sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[];
};

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SecurityPanel() {
  const router = useRouter();
  const [data, setData] = React.useState<Security | null>(null);
  const [enrolOpen, setEnrolOpen] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [newCodes, setNewCodes] = React.useState<string[] | null>(null);
  const [code, setCode] = React.useState("");
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => apiFetch<Security>("/api/account/security").then(setData).catch((e) => toast.error(e.message)), []);
  React.useEffect(() => {
    load();
  }, [load]);

  async function act(name: string, body: Record<string, unknown>, success?: string) {
    setBusy(name);
    try {
      const r = await apiFetch<Record<string, unknown>>("/api/account/security", { body });
      if (success) toast.success(success);
      await load();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const strong = PASSWORD_RULES.every(([re]) => re.test(pw.next));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Two-step verification
          </CardTitle>
          <CardDescription>Authenticator-app codes (TOTP) protect your account even if your password leaks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data ? (
            <Skeleton className="h-16" />
          ) : data.mfaEnabled ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">Enabled</Badge>
                {data.mfaRequired && <Badge variant="info">Required for your role</Badge>}
                <span className="text-sm text-muted-foreground">{data.recoveryCodesRemaining} of 10 recovery codes left</span>
              </div>
              {data.recoveryCodesRemaining <= 3 && <Alert variant="warning">You are running low on recovery codes. Generate a new set.</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { setCode(""); setNewCodes(null); setRegenOpen(true); }}>
                  <RefreshCw /> New recovery codes
                </Button>
                {!data.mfaRequired && (
                  <Button variant="outline" size="sm" className="text-expense" onClick={() => { setCode(""); setPw((p) => ({ ...p, current: "" })); setDisableOpen(true); }}>
                    <ShieldOff /> Turn off
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Badge variant="warning">Not enabled</Badge>
              <p className="text-sm text-muted-foreground">Add an authenticator app to secure sign-in.</p>
              <Button size="sm" onClick={() => setEnrolOpen(true)}>
                <ShieldCheck /> Set up authenticator
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="password">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Change password
          </CardTitle>
          <CardDescription>Changing your password signs out your other sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.next !== pw.confirm) return toast.error("New passwords do not match");
              const r = await act("password", { action: "change_password", currentPassword: pw.current, newPassword: pw.next }, "Password changed");
              if (r) setPw({ current: "", next: "", confirm: "" });
            }}
          >
            <FormField label="Current password" htmlFor="cur">
              <Input id="cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </FormField>
            <FormField label="New password" htmlFor="new">
              <Input id="new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </FormField>
            {pw.next && <PasswordChecklist password={pw.next} />}
            <FormField label="Confirm new password" htmlFor="conf">
              <Input id="conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </FormField>
            <Button type="submit" size="sm" loading={busy === "password"} disabled={!pw.current || !strong || !pw.confirm}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-primary" /> Active sessions
            </CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </div>
          <Button variant="outline" size="sm" loading={busy === "others"} onClick={() => act("others", { action: "revoke_other_sessions" }, "Other sessions signed out")}>
            <LogOut /> Sign out others
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {!data ? (
            <Skeleton className="h-20" />
          ) : (
            data.sessions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {describeAgent(s.userAgent)} {s.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    IP {s.ip ?? "unknown"} · signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => act(s.id, { action: "revoke_session", sessionId: s.id }, "Session signed out")} loading={busy === s.id}>
                    Sign out
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={enrolOpen} onOpenChange={setEnrolOpen}>
        <DialogContent title="Set up authenticator app" className="max-w-md">
          <MfaSetup
            continueLabel="Done"
            onDone={() => {
              setEnrolOpen(false);
              load();
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent title="Generate new recovery codes" description="Your existing recovery codes will stop working.">
          {newCodes ? (
            <>
              <RecoveryCodes codes={newCodes} />
              <DialogFooter>
                <Button onClick={() => setRegenOpen(false)}>I saved them</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <FormField label="Authenticator code" htmlFor="regen-code">
                <Input id="regen-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </FormField>
              <DialogFooter>
                <Button
                  loading={busy === "regen"}
                  disabled={code.length !== 6}
                  onClick={async () => {
                    const r = await act("regen", { action: "regenerate_recovery_codes", code });
                    if (r?.recoveryCodes) setNewCodes(r.recoveryCodes as string[]);
                  }}
                >
                  Generate
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent title="Turn off two-step verification" description="Confirm with your password and a current authenticator code.">
          <FormField label="Password" htmlFor="dis-pw">
            <Input id="dis-pw" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </FormField>
          <FormField label="Authenticator code" htmlFor="dis-code">
            <Input id="dis-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy === "disable"}
              disabled={!pw.current || code.length !== 6}
              onClick={async () => {
                const r = await act("disable", { action: "disable_mfa", password: pw.current, code }, "Two-step verification turned off");
                if (r) {
                  setDisableOpen(false);
                  setPw((p) => ({ ...p, current: "" }));
                }
              }}
            >
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

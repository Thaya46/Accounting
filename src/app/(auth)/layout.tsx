import { BadgeCheck, ShieldCheck, Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0d1530] p-10 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 font-bold">V</div>
          <span className="text-lg font-semibold">VLedger AI</span>
        </div>
        <div className="relative mt-auto max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Every entry balanced. Every entry traceable to the person who made it.</h2>
          <ul className="space-y-4 text-sm text-slate-300">
            <li className="flex gap-3">
              <Sparkles className="h-5 w-5 shrink-0 text-indigo-300" />
              Record income and expenses by voice or plain language — you review before anything is posted.
            </li>
            <li className="flex gap-3">
              <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-300" />
              Double-entry ledger with an append-only audit trail, per-workspace isolation and canonical JSON exports.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-sky-300" />
              Authenticator-app MFA, secure sessions, and invitations that never email a password.
            </li>
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-slate-500">© {new Date().getFullYear()} VLedger AI</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">V</div>
            <span className="text-lg font-semibold">VLedger AI</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

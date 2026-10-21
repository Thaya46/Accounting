import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, ChevronLeft, ListChecks } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn, titleCaseEnum } from "@/lib/utils";
import { generalLedger } from "@/lib/accounting/reports";
import { isReconcilable, reconciliationState } from "@/lib/accounting/reconciliation";
import { accountOverview } from "@/lib/dashboard/account";
import { periodPresets, rangeLabel, resolvePeriod } from "@/lib/dashboard/periods";
import { subtypeLabel } from "@/lib/dashboard/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PrintStyles } from "@/components/reports/print-styles";
import { PeriodControls } from "@/components/reports/period-controls";
import { ReportActions } from "@/components/reports/report-actions";
import { LedgerTable, ledgerCsv } from "@/components/reports/ledger-table";
import { GENERATED_NOTE } from "@/components/reports/statement";
import { ReconcilePanel } from "@/components/reports/reconcile-panel";
import { ReconciliationHistory } from "@/components/reports/reconciliation-history";

export const metadata = { title: "Account ledger" };

type Params = Promise<{ workspaceId: string; accountId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { workspaceId, accountId } = await params;
  const ctx = await requireWorkspace(workspaceId, ["REPORTS_VIEW", "ACCOUNTS_MANAGE"]);
  const sp = await searchParams;
  const ws = ctx.workspace;
  const currency = ws.defaultCurrency;
  const today = todayInTimeZone(ws.timeZone);

  const account = await accountOverview(ws.id, accountId, today);
  if (!account) notFound();

  const reconcilable = isReconcilable(account.subtype);
  const tab = one(sp.tab) === "reconcile" && reconcilable ? "reconcile" : "ledger";
  const canManage = ctx.permissions.has("ACCOUNTS_MANAGE");
  const base = `/w/${ws.id}/accounts/${account.id}`;
  const period = resolvePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) }, today, ws.fyStartMonth);

  const [ledger, recon] = await Promise.all([
    tab === "ledger" ? generalLedger(ws.id, account.id, period.from, period.to) : Promise.resolve(null),
    tab === "reconcile" ? reconciliationState(ws.id, account.id) : Promise.resolve(null),
  ]);
  const company = ws.companyName || ws.name;
  const balanceNegative = dec(account.balance).isNegative();

  return (
    <div className="vl-report">
      <PrintStyles />
      <div className="mb-5 print:hidden">
        <Link href={`/w/${ws.id}/accounts`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Chart of accounts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{account.name}</h1>
              <Badge variant="outline" className="font-mono">
                {account.code}
              </Badge>
              {!account.isActive && <Badge variant="muted">Inactive</Badge>}
              {account.isSystem && <Badge variant="secondary">System</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {titleCaseEnum(account.type)}
              {account.subtype && ` · ${subtypeLabel(account.subtype)}`}
              {account.description && ` · ${account.description}`}
            </p>
          </div>
          {tab === "ledger" && ledger && (
            <ReportActions rows={ledgerCsv(ledger, company)} filename={`${ws.code}-ledger-${account.code}-${period.from}-to-${period.to}`} />
          )}
        </div>
      </div>

      {/* Print-only heading */}
      <div className="mb-4 hidden text-center print:block">
        <p className="text-xs font-semibold uppercase tracking-wider">{company}</p>
        <h1 className="text-lg font-semibold">
          {tab === "ledger" ? "General Ledger" : "Reconciliation"} — {account.code} {account.name}
        </h1>
        {tab === "ledger" && <p className="text-sm">For the period {rangeLabel(period.from, period.to)}</p>}
      </div>

      <Card className="mb-5 p-5 print:border-0 print:p-0 print:shadow-none">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
          <Detail label="Account type">{titleCaseEnum(account.type)}</Detail>
          <Detail label="Subtype">{subtypeLabel(account.subtype) ?? "—"}</Detail>
          <Detail label="Bank details">
            {account.bankName || account.accountNumberLast4 ? (
              <>
                {account.bankName ?? "Bank"}
                {account.accountNumberLast4 && <span className="text-muted-foreground"> ••••{account.accountNumberLast4}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Detail>
          <Detail label="Opening balance">
            {dec(account.openingBalance).isZero() && !account.openingBalanceDate ? (
              <span className="text-muted-foreground">Not set</span>
            ) : (
              <>
                <span className="tabular">{formatMoney(account.openingBalance, currency, { decimals: true })}</span>
                {account.openingBalanceDate && <span className="text-xs font-normal text-muted-foreground"> on {formatDate(account.openingBalanceDate)}</span>}
              </>
            )}
          </Detail>
          <Detail label={`Current balance (${formatDate(today)})`}>
            <span className={cn("tabular text-base font-semibold", balanceNegative && "text-expense")}>{formatMoney(account.balance, currency, { decimals: true })}</span>
          </Detail>
          <Detail label="Postings">
            {account.postingCount}
            {account.firstEntryDate && <span className="text-xs font-normal text-muted-foreground"> since {formatDate(account.firstEntryDate)}</span>}
          </Detail>
        </dl>
      </Card>

      {reconcilable && (
        <nav aria-label="Account views" className="mb-4 print:hidden">
          <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
            {[
              { key: "ledger", label: "General ledger", icon: BookOpen, href: base },
              { key: "reconcile", label: "Reconciliation", icon: ListChecks, href: `${base}?tab=reconcile` },
            ].map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {tab === "ledger" && ledger && (
        <>
          <PeriodControls basePath={base} current={period} presets={periodPresets(today, ws.fyStartMonth)} className="mb-4" />
          <Card className="overflow-hidden print:rounded-none print:border-0 print:shadow-none">
            <div className="flex flex-col gap-1 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
              <h2 className="text-sm font-semibold">General ledger · {rangeLabel(period.from, period.to)}</h2>
              <p className="text-xs text-muted-foreground">Debits {formatMoney(ledger.totalDebit, currency, { decimals: true })} · Credits {formatMoney(ledger.totalCredit, currency, { decimals: true })}</p>
            </div>
            <LedgerTable workspaceId={ws.id} data={ledger} currency={currency} />
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">{GENERATED_NOTE}</p>
          </Card>
        </>
      )}

      {tab === "reconcile" && recon && (
        <div className="space-y-5">
          <ReconcilePanel
            workspaceId={ws.id}
            accountId={account.id}
            accountType={recon.accountType}
            subtype={account.subtype}
            currency={currency}
            today={today}
            clearedBalance={recon.clearedBalance}
            clearedCount={recon.clearedCount}
            lastStatementDate={recon.lastStatementDate}
            lines={recon.unreconciled}
            truncated={recon.truncated}
            canManage={canManage}
          />
          <ReconciliationHistory items={recon.history} currency={currency} timeZone={ws.timeZone} />
        </div>
      )}
    </div>
  );
}

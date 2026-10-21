import Link from "next/link";
import { ArrowLeftRight, ArrowRight, BookOpen, FileSpreadsheet, Landmark, ListTree, Scale, TrendingUp, type LucideIcon } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { financialYearFor, todayInTimeZone } from "@/lib/dates";
import { REPORTS, type ReportSlug } from "@/lib/dashboard/report-data";
import { PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { cashAndBankBalances } from "@/lib/accounting/reports";
import { subtypeLabel } from "@/lib/dashboard/format";

export const metadata = { title: "Reports" };

const ICONS: Record<ReportSlug, LucideIcon> = {
  "profit-and-loss": TrendingUp,
  "balance-sheet": Scale,
  "trial-balance": FileSpreadsheet,
  "cash-flow": ArrowLeftRight,
  "general-ledger": BookOpen,
  journal: ListTree,
};

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "REPORTS_VIEW");
  const ws = ctx.workspace;
  const today = todayInTimeZone(ws.timeZone);
  const fy = financialYearFor(today, ws.fyStartMonth);
  const [entryCount, balances] = await Promise.all([prisma.journalEntry.count({ where: { workspaceId: ws.id } }), cashAndBankBalances(ws.id, today)]);
  const ledgers = balances.filter((b) => b.isActive);

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          <>
            Financial statements for {ws.name}, generated from posted journal entries only. Current period: {fy.label}.
          </>
        }
        actions={<Badge variant="muted">{entryCount} posted journal {entryCount === 1 ? "entry" : "entries"}</Badge>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = ICONS[r.slug];
          return (
            <Link
              key={r.slug}
              href={`/w/${ws.id}/reports/${r.slug}`}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-primary/40">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold tracking-tight">{r.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {r.mode === "asOf" ? "As of today" : r.slug === "general-ledger" ? "Choose an account" : fy.label}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Card>
            </Link>
          );
        })}
      </div>

      <section className="mt-8" aria-labelledby="tally-reports-heading">
        <h2 id="tally-reports-heading" className="mb-1 text-base font-semibold tracking-tight">
          TallyPrime Statements &amp; Compliance
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">Standard Tally reports with Gross Profit, Outstanding Aging, and GST compliance.</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href={`/w/${ws.id}/daybook`} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-primary/40">
              <span className="font-semibold text-sm">Day Book</span>
              <p className="mt-1 text-xs text-muted-foreground">Daily voucher register with detailed/condensed drill-down (Alt+F1).</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                Open Day Book <ArrowRight className="h-3 w-3" />
              </span>
            </Card>
          </Link>

          <Link href={`/w/${ws.id}/reports/tally-pl`} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-primary/40">
              <span className="font-semibold text-sm">Trading &amp; P&amp;L Account</span>
              <p className="mt-1 text-xs text-muted-foreground">Trading A/c (Gross Profit) + Profit &amp; Loss (Net Profit).</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                View Statement <ArrowRight className="h-3 w-3" />
              </span>
            </Card>
          </Link>

          <Link href={`/w/${ws.id}/reports/bills-receivable`} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-primary/40">
              <span className="font-semibold text-sm">Bills Receivable (Aging)</span>
              <p className="mt-1 text-xs text-muted-foreground">Customer outstanding aging (0-30, 31-60, 61-90, 90+ days).</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                View Receivables <ArrowRight className="h-3 w-3" />
              </span>
            </Card>
          </Link>

          <Link href={`/w/${ws.id}/reports/gst`} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-primary/40">
              <span className="font-semibold text-sm">GST Summary &amp; Returns</span>
              <p className="mt-1 text-xs text-muted-foreground">Outward supplies (GSTR-1) and Input Tax Credits (GSTR-3B).</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                View GST Summary <ArrowRight className="h-3 w-3" />
              </span>
            </Card>
          </Link>
        </div>
      </section>

      {ledgers.length > 0 && (
        <section className="mt-8" aria-labelledby="ledgers-heading">
          <h2 id="ledgers-heading" className="mb-1 text-base font-semibold tracking-tight">
            Bank &amp; cash ledgers
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">Open an account to see its ledger and reconcile it against a statement.</p>
          <Card className="divide-y">
            {ledgers.map((b) => (
              <Link key={b.id} href={`/w/${ws.id}/accounts/${b.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
                <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.code} · {subtypeLabel(b.subtype)}
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">{formatMoney(b.balance, ws.defaultCurrency, { decimals: true })}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </Card>
        </section>
      )}
    </>
  );
}

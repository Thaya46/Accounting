import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { formatDate } from "@/lib/dates";
import { dec, money2 } from "@/lib/money";
import { asOfPresets, periodPresets, rangeLabel } from "@/lib/dashboard/periods";
import { loadReport, reportDef, JOURNAL_LIMIT } from "@/lib/dashboard/report-data";
import { Alert } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { AsOfControls, PeriodControls } from "@/components/reports/period-controls";
import { ReportActions, type CsvRows } from "@/components/reports/report-actions";
import { BalancedBadge, ReportFrame } from "@/components/reports/statement";
import {
  AccountPicker,
  BalanceSheetView,
  balanceSheetCsv,
  balanceSheetDifference,
  CashCheckBadge,
  CashFlowView,
  cashFlowCsv,
  GeneralLedgerView,
  JournalView,
  journalCsv,
  journalTotalsBalanced,
  ledgerCsv,
  ProfitAndLossView,
  profitAndLossCsv,
  TrialBalanceView,
  trialBalanceCsv,
} from "@/components/reports/report-views";

type Params = Promise<{ workspaceId: string; report: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { report } = await params;
  return { title: reportDef(report)?.title ?? "Report" };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { workspaceId, report: slug } = await params;
  const def = reportDef(slug);
  if (!def) notFound();
  const ctx = await requireWorkspace(workspaceId, "REPORTS_VIEW");
  const sp = await searchParams;
  const ws = ctx.workspace;
  const report = await loadReport(ctx, def.slug, {
    period: one(sp.period),
    from: one(sp.from),
    to: one(sp.to),
    asOf: one(sp.asOf),
    accountId: one(sp.accountId),
  });

  const basePath = `/w/${ws.id}/reports/${def.slug}`;
  const company = ws.companyName || ws.name;
  const fileBase = `${ws.code}-${def.slug}`;
  const frame = { workspaceId: ws.id, title: def.title, description: def.description, companyName: company, timeZone: ws.timeZone };
  const actions = (rows: CsvRows, filename: string) => <ReportActions rows={rows} filename={filename} />;
  const periodControls = (keep: Record<string, string | null> = {}) =>
    "period" in report ? <PeriodControls basePath={basePath} current={report.period} presets={periodPresets(report.today, ws.fyStartMonth)} keep={keep} /> : null;
  const asOfControls = () =>
    "asOf" in report ? <AsOfControls basePath={basePath} current={report.asOf} presets={asOfPresets(report.today, ws.fyStartMonth)} /> : null;

  switch (report.slug) {
    case "profit-and-loss":
      return (
        <ReportFrame
          {...frame}
          periodLabel={`For the period ${rangeLabel(report.period.from, report.period.to)}`}
          actions={actions(profitAndLossCsv(report, company), `${fileBase}-${report.period.from}-to-${report.period.to}`)}
          controls={periodControls()}
        >
          <ProfitAndLossView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
    case "balance-sheet":
      return (
        <ReportFrame
          {...frame}
          periodLabel={`As of ${formatDate(report.asOf.asOf)}`}
          status={<BalancedBadge balanced={report.data.balanced} difference={balanceSheetDifference(report)} currency={report.currency} />}
          actions={actions(balanceSheetCsv(report, company), `${fileBase}-as-of-${report.asOf.asOf}`)}
          controls={asOfControls()}
        >
          {!report.data.balanced && (
            <div className="px-5 pt-4">
              <Alert variant="warning" title="Assets do not equal liabilities plus equity">
                Check for unbalanced or partially imported journal entries. Every posted entry must have equal debits and credits.
              </Alert>
            </div>
          )}
          <BalanceSheetView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
    case "trial-balance":
      return (
        <ReportFrame
          {...frame}
          periodLabel={`As of ${formatDate(report.asOf.asOf)}`}
          status={
            <BalancedBadge
              balanced={report.data.balanced}
              difference={money2(dec(report.data.totalDebit).minus(dec(report.data.totalCredit)))}
              currency={report.currency}
            />
          }
          actions={actions(trialBalanceCsv(report, company), `${fileBase}-as-of-${report.asOf.asOf}`)}
          controls={asOfControls()}
        >
          {!report.data.balanced && (
            <div className="px-5 pt-4">
              <Alert variant="warning" title="Total debits do not equal total credits">
                The ledger should always balance. Review recent journal entries and contact support if this persists.
              </Alert>
            </div>
          )}
          <TrialBalanceView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
    case "cash-flow":
      return (
        <ReportFrame
          {...frame}
          periodLabel={`For the period ${rangeLabel(report.period.from, report.period.to)}`}
          status={<CashCheckBadge report={report} />}
          actions={actions(cashFlowCsv(report, company), `${fileBase}-${report.period.from}-to-${report.period.to}`)}
          controls={periodControls()}
        >
          <p className="border-b px-5 py-2.5 text-xs text-muted-foreground">
            Direct method: movements in bank, cash and wallet accounts, attributed to their counter-accounts. Transfers between cash accounts net to zero.
          </p>
          <CashFlowView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
    case "general-ledger": {
      const title = report.data ? `${def.title} — ${report.data.account.code} ${report.data.account.name}` : def.title;
      return (
        <ReportFrame
          {...frame}
          title={title}
          periodLabel={`For the period ${rangeLabel(report.period.from, report.period.to)}`}
          actions={report.data ? actions(ledgerCsv(report.data, company), `${fileBase}-${report.data.account.code}-${report.period.from}-to-${report.period.to}`) : undefined}
          controls={
            <div className="space-y-3">
              <AccountPicker basePath={basePath} workspaceId={ws.id} report={report} />
              {periodControls({ accountId: report.accountId })}
            </div>
          }
        >
          <GeneralLedgerView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
    }
    case "journal":
      return (
        <ReportFrame
          {...frame}
          periodLabel={`For the period ${rangeLabel(report.period.from, report.period.to)}`}
          status={
            report.data.length ? (
              journalTotalsBalanced(report) ? (
                <Badge variant="success">Debits equal credits ✓</Badge>
              ) : (
                <Badge variant="warning">Debits and credits differ</Badge>
              )
            ) : undefined
          }
          actions={actions(journalCsv(report, company), `${fileBase}-${report.period.from}-to-${report.period.to}`)}
          controls={periodControls()}
        >
          {report.truncated && (
            <div className="px-5 pt-4 print:hidden">
              <Alert variant="info" title={`Showing the first ${JOURNAL_LIMIT} entries`}>
                Narrow the period to see later entries in this register.
              </Alert>
            </div>
          )}
          <JournalView report={report} workspaceId={ws.id} companyName={company} />
        </ReportFrame>
      );
  }
}

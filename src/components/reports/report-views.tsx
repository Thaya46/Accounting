import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/dates";
import { journalRef, txnRef } from "@/lib/ids";
import { Decimal, dec, money2 } from "@/lib/money";
import { cn, titleCaseEnum } from "@/lib/utils";
import type { LoadedReport } from "@/lib/dashboard/report-data";
import { subtypeLabel } from "@/lib/dashboard/format";
import type { CsvRows } from "./report-actions";
import { EntryTypeBadge } from "./entry-type-badge";
import { LedgerTable, ledgerCsv } from "./ledger-table";
import {
  AccountRow,
  amt,
  BalancedBadge,
  EmptyRow,
  GrandTotalRow,
  SectionHeading,
  StatementColumnsHeader,
  StatementTable,
  SubtotalRow,
} from "./statement";

type Of<S extends LoadedReport["slug"]> = Extract<LoadedReport, { slug: S }>;

type ViewProps<S extends LoadedReport["slug"]> = { report: Of<S>; workspaceId: string; companyName: string };

const accountHref = (workspaceId: string, id: string, from?: string, to?: string) => {
  const q = from && to ? `?from=${from}&to=${to}` : "";
  return `/w/${workspaceId}/accounts/${id}${q}`;
};

function meta(title: string, companyName: string, period: string): CsvRows {
  return [[title, companyName], ["Period", period], ["Generated from posted journal entries only"], []];
}

// ───────────────────────────── Profit & Loss ─────────────────────────────

export function ProfitAndLossView({ report, workspaceId }: ViewProps<"profit-and-loss">) {
  const { data, currency } = report;
  const net = dec(data.netProfit);
  const href = (id: string) => accountHref(workspaceId, id, data.from, data.to);
  return (
    <StatementTable>
      <tbody>
        <StatementColumnsHeader columns={["Amount"]} />
        <SectionHeading>Income</SectionHeading>
        {data.income.length === 0 && <EmptyRow>No income posted in this period</EmptyRow>}
        {data.income.map((r) => (
          <AccountRow key={r.id} code={r.code} name={r.name} amounts={[r.amount]} currency={currency} href={href(r.id)} />
        ))}
        <SubtotalRow label="Total income" amounts={[data.totalIncome]} currency={currency} />
        <SectionHeading>Expenses</SectionHeading>
        {data.expenses.length === 0 && <EmptyRow>No expenses posted in this period</EmptyRow>}
        {data.expenses.map((r) => (
          <AccountRow key={r.id} code={r.code} name={r.name} amounts={[r.amount]} currency={currency} href={href(r.id)} />
        ))}
        <SubtotalRow label="Total expenses" amounts={[data.totalExpenses]} currency={currency} />
        <tr aria-hidden>
          <td colSpan={2} className="h-3" />
        </tr>
        <GrandTotalRow label={net.isNegative() ? "Net loss" : "Net profit"} amounts={[data.netProfit]} currency={currency} tone={net.gt(0) ? "income" : net.lt(0) ? "expense" : null} />
      </tbody>
    </StatementTable>
  );
}

export function profitAndLossCsv(report: Of<"profit-and-loss">, companyName: string): CsvRows {
  const { data } = report;
  return [
    ...meta("Profit and Loss", companyName, `${data.from} to ${data.to}`),
    ["Section", "Code", "Account", "Amount"],
    ...data.income.map((r) => ["Income", r.code, r.name, r.amount]),
    ["Income", "", "Total income", data.totalIncome],
    ...data.expenses.map((r) => ["Expenses", r.code, r.name, r.amount]),
    ["Expenses", "", "Total expenses", data.totalExpenses],
    ["", "", dec(data.netProfit).isNegative() ? "Net loss" : "Net profit", data.netProfit],
  ];
}

// ───────────────────────────── Balance sheet ─────────────────────────────

export function balanceSheetDifference(report: Of<"balance-sheet">) {
  return money2(dec(report.data.totalAssets).minus(dec(report.data.totalLiabilitiesAndEquity)));
}

export function BalanceSheetView({ report, workspaceId }: ViewProps<"balance-sheet">) {
  const { data, currency } = report;
  const href = (id: string) => accountHref(workspaceId, id);
  return (
    <StatementTable>
      <tbody>
        <StatementColumnsHeader columns={["Amount"]} />
        <SectionHeading>Assets</SectionHeading>
        {data.assets.length === 0 && <EmptyRow>No asset balances</EmptyRow>}
        {data.assets.map((r) => (
          <AccountRow
            key={r.id}
            code={r.code}
            name={
              <>
                {r.name}
                {r.subtype && <span className="ml-2 text-xs text-muted-foreground">{subtypeLabel(r.subtype)}</span>}
              </>
            }
            amounts={[r.amount]}
            currency={currency}
            href={href(r.id)}
          />
        ))}
        <GrandTotalRow label="Total assets" amounts={[data.totalAssets]} currency={currency} />

        <SectionHeading>Liabilities</SectionHeading>
        {data.liabilities.length === 0 && <EmptyRow>No liability balances</EmptyRow>}
        {data.liabilities.map((r) => (
          <AccountRow key={r.id} code={r.code} name={r.name} amounts={[r.amount]} currency={currency} href={href(r.id)} />
        ))}
        <SubtotalRow label="Total liabilities" amounts={[data.totalLiabilities]} currency={currency} />

        <SectionHeading>Equity</SectionHeading>
        {data.equity.map((r) => (
          <AccountRow key={r.id} code={r.code} name={r.name} amounts={[r.amount]} currency={currency} href={href(r.id)} />
        ))}
        <AccountRow
          name={
            <>
              Current earnings <span className="text-xs text-muted-foreground">(cumulative profit &amp; loss, not yet closed)</span>
            </>
          }
          amounts={[data.currentEarnings]}
          currency={currency}
        />
        {data.equity.length === 0 && dec(data.currentEarnings).isZero() && <EmptyRow>No equity balances</EmptyRow>}
        <SubtotalRow label="Total equity" amounts={[data.totalEquity]} currency={currency} />
        <tr aria-hidden>
          <td colSpan={2} className="h-3" />
        </tr>
        <GrandTotalRow label="Total liabilities & equity" amounts={[data.totalLiabilitiesAndEquity]} currency={currency} />
      </tbody>
    </StatementTable>
  );
}

export function balanceSheetCsv(report: Of<"balance-sheet">, companyName: string): CsvRows {
  const { data } = report;
  return [
    ...meta("Balance Sheet", companyName, `As of ${data.asOf}`),
    ["Section", "Code", "Account", "Amount"],
    ...data.assets.map((r) => ["Assets", r.code, r.name, r.amount]),
    ["Assets", "", "Total assets", data.totalAssets],
    ...data.liabilities.map((r) => ["Liabilities", r.code, r.name, r.amount]),
    ["Liabilities", "", "Total liabilities", data.totalLiabilities],
    ...data.equity.map((r) => ["Equity", r.code, r.name, r.amount]),
    ["Equity", "", "Current earnings", data.currentEarnings],
    ["Equity", "", "Total equity", data.totalEquity],
    ["", "", "Total liabilities & equity", data.totalLiabilitiesAndEquity],
    ["", "", "Balanced", data.balanced ? "Yes" : `No (difference ${balanceSheetDifference(report)})`],
  ];
}

// ───────────────────────────── Trial balance ─────────────────────────────

const TYPE_HEADINGS: Record<string, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

export function TrialBalanceView({ report, workspaceId }: ViewProps<"trial-balance">) {
  const { data, currency } = report;
  const groups = Object.keys(TYPE_HEADINGS)
    .map((type) => ({ type, lines: data.lines.filter((l) => l.type === type) }))
    .filter((g) => g.lines.length);
  const zero = (v: string) => dec(v).isZero();
  return (
    <StatementTable columns={["Debit", "Credit"]}>
      <tbody>
        <StatementColumnsHeader columns={["Debit", "Credit"]} />
        {groups.length === 0 && (
          <tr>
            <td colSpan={3} className="px-5 py-10 text-center text-sm text-muted-foreground">
              No posted balances as of {formatDate(data.asOf)}.
            </td>
          </tr>
        )}
        {groups.map((g) => (
          <TrialGroup key={g.type} heading={TYPE_HEADINGS[g.type]!}>
            {g.lines.map((l) => (
              <AccountRow
                key={l.id}
                code={l.code}
                name={l.name}
                amounts={[zero(l.debit) ? null : l.debit, zero(l.credit) ? null : l.credit]}
                currency={currency}
                href={accountHref(workspaceId, l.id)}
              />
            ))}
          </TrialGroup>
        ))}
        <tr aria-hidden>
          <td colSpan={3} className="h-3" />
        </tr>
        <GrandTotalRow label="Total" amounts={[data.totalDebit, data.totalCredit]} currency={currency} />
      </tbody>
    </StatementTable>
  );
}

function TrialGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <>
      <SectionHeading cols={2}>{heading}</SectionHeading>
      {children}
    </>
  );
}

export function trialBalanceCsv(report: Of<"trial-balance">, companyName: string): CsvRows {
  const { data } = report;
  return [
    ...meta("Trial Balance", companyName, `As of ${data.asOf}`),
    ["Type", "Code", "Account", "Debit", "Credit"],
    ...data.lines.map((l) => [titleCaseEnum(l.type), l.code, l.name, l.debit, l.credit]),
    ["", "", "Total", data.totalDebit, data.totalCredit],
    ["", "", "Balanced", data.balanced ? "Yes" : "No"],
  ];
}

// ───────────────────────────── Cash flow ─────────────────────────────

const ACTIVITIES = [
  { key: "operating", heading: "Operating activities", total: "Net cash from operating activities" },
  { key: "investing", heading: "Investing activities", total: "Net cash from investing activities" },
  { key: "financing", heading: "Financing activities", total: "Net cash from financing activities" },
] as const;

export function CashFlowView({ report, workspaceId }: ViewProps<"cash-flow">) {
  const { data, currency } = report;
  const change = dec(data.netChange);
  return (
    <StatementTable>
      <tbody>
        <StatementColumnsHeader columns={["Amount"]} />
        <AccountRow name={<span className="font-medium">Opening cash balance</span>} amounts={[data.openingCash]} currency={currency} indent={0} />
        {ACTIVITIES.map((a) => {
          const section = data[a.key];
          return (
            <Activity key={a.key} heading={a.heading}>
              {section.items.length === 0 && <EmptyRow>No cash movements</EmptyRow>}
              {section.items.map((i) => (
                <AccountRow
                  key={i.id}
                  code={i.code}
                  name={
                    <>
                      {i.name}
                      <span className="ml-2 text-xs text-muted-foreground">{dec(i.amount).isNegative() ? "paid" : "received"}</span>
                    </>
                  }
                  amounts={[i.amount]}
                  currency={currency}
                  href={accountHref(workspaceId, i.id, data.from, data.to)}
                />
              ))}
              <SubtotalRow label={a.total} amounts={[section.total]} currency={currency} />
            </Activity>
          );
        })}
        <tr aria-hidden>
          <td colSpan={2} className="h-3" />
        </tr>
        <SubtotalRow
          label={change.isNegative() ? "Net decrease in cash" : "Net increase in cash"}
          amounts={[data.netChange]}
          currency={currency}
          className={cn(change.gt(0) && "text-income", change.lt(0) && "text-expense")}
        />
        <GrandTotalRow label="Closing cash balance" amounts={[data.closingCash]} currency={currency} />
      </tbody>
    </StatementTable>
  );
}

function Activity({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <>
      <SectionHeading>{heading}</SectionHeading>
      {children}
    </>
  );
}

export function CashCheckBadge({ report }: { report: Of<"cash-flow"> }) {
  return report.reconciles ? (
    <Badge variant="success">Agrees with bank, cash &amp; wallet balances ✓</Badge>
  ) : (
    <Badge variant="warning">Ledger cash balance is {amt(report.ledgerCash, report.currency)}</Badge>
  );
}

export function cashFlowCsv(report: Of<"cash-flow">, companyName: string): CsvRows {
  const { data } = report;
  const rows: CsvRows = [...meta("Cash Flow Statement", companyName, `${data.from} to ${data.to}`), ["Section", "Code", "Account", "Amount"]];
  rows.push(["", "", "Opening cash balance", data.openingCash]);
  for (const a of ACTIVITIES) {
    for (const i of data[a.key].items) rows.push([a.heading, i.code, i.name, i.amount]);
    rows.push([a.heading, "", a.total, data[a.key].total]);
  }
  rows.push(["", "", "Net change in cash", data.netChange], ["", "", "Closing cash balance", data.closingCash]);
  return rows;
}

// ───────────────────────────── General ledger ─────────────────────────────

export function GeneralLedgerView({ report, workspaceId }: ViewProps<"general-ledger">) {
  const { data, currency } = report;
  if (!data) {
    return (
      <EmptyState
        icon={BookOpen}
        title={report.accountId === null && report.accounts.length ? "Choose an account" : "No accounts"}
        description="Pick an account above to see every posting with its running balance."
        className="py-14"
      />
    );
  }
  return <LedgerTable workspaceId={workspaceId} data={data} currency={currency} />;
}

export function AccountPicker({
  basePath,
  workspaceId,
  report,
}: {
  basePath: string;
  workspaceId: string;
  report: Of<"general-ledger">;
}) {
  const { period } = report;
  const groups = Object.keys(TYPE_HEADINGS).map((type) => ({ type, accounts: report.accounts.filter((a) => a.type === type) }));
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2 print:hidden">
      {period.preset === "custom" ? (
        <>
          <input type="hidden" name="period" value="custom" />
          <input type="hidden" name="from" value={period.from} />
          <input type="hidden" name="to" value={period.to} />
        </>
      ) : (
        <input type="hidden" name="period" value={period.preset} />
      )}
      <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-muted-foreground sm:max-w-md">
        Account
        <NativeSelect name="accountId" defaultValue={report.accountId ?? ""} required className="text-foreground">
          <option value="" disabled>
            Select an account…
          </option>
          {groups.map((g) =>
            g.accounts.length ? (
              <optgroup key={g.type} label={TYPE_HEADINGS[g.type]}>
                {g.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                    {a.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </optgroup>
            ) : null,
          )}
        </NativeSelect>
      </label>
      <Button type="submit" size="sm">
        View ledger
      </Button>
      {report.data && (
        <Button asChild size="sm" variant="ghost">
          <Link href={accountHref(workspaceId, report.data.account.id, period.from, period.to)}>Open account page</Link>
        </Button>
      )}
    </form>
  );
}

// ───────────────────────────── Journal register ─────────────────────────────

export function JournalView({ report, workspaceId }: ViewProps<"journal">) {
  const { data, currency } = report;
  if (data.length === 0) {
    return <EmptyState icon={BookOpen} title="No journal entries in this period" className="py-14" />;
  }
  const totalDebit = data.reduce((s, e) => s.plus(dec(e.totalDebit)), new Decimal(0));
  const totalCredit = data.reduce((s, e) => s.plus(dec(e.totalCredit)), new Decimal(0));
  const zero = (v: string) => dec(v).isZero();
  return (
    <div className="relative overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="h-10 w-[120px] px-3 pl-5">Date</th>
            <th scope="col" className="px-3">Entry / account</th>
            <th scope="col" className="w-[150px] px-3 text-right">Debit</th>
            <th scope="col" className="w-[150px] px-3 pr-5 text-right">Credit</th>
          </tr>
        </thead>
        {data.map((e) => (
          <tbody key={e.id} id={`je-${e.number}`} className="print-avoid-break border-b">
            <tr className="bg-muted/25">
              <td className="whitespace-nowrap px-3 py-2 pl-5 align-top text-muted-foreground">{formatDate(e.date)}</td>
              <td className="px-3 py-2" colSpan={3}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs font-semibold">{journalRef(e.number)}</span>
                  {e.type !== "STANDARD" && <EntryTypeBadge type={e.type} />}
                  <span className="font-medium">{e.description}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Posted by {e.postedByName}
                  {e.transaction && (
                    <>
                      {" · "}
                      <Link href={`/w/${workspaceId}/transactions/${e.transaction.id}`} className="font-medium text-primary hover:underline">
                        {txnRef(e.transaction.number)}
                      </Link>
                      {" · entered by "}
                      {e.transaction.createdByName}
                    </>
                  )}
                </div>
              </td>
            </tr>
            {e.lines.map((l, i) => (
              <tr key={i}>
                <td />
                <td className={cn("px-3 py-1", zero(l.debit) ? "pl-10" : "pl-5")}>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{l.code}</span>
                  {l.name}
                  {l.description && l.description !== e.description && <span className="ml-2 text-xs text-muted-foreground">— {l.description}</span>}
                </td>
                <td className="tabular whitespace-nowrap px-3 py-1 text-right">{zero(l.debit) ? "" : amt(l.debit, currency)}</td>
                <td className="tabular whitespace-nowrap px-3 py-1 pr-5 text-right">{zero(l.credit) ? "" : amt(l.credit, currency)}</td>
              </tr>
            ))}
            <tr className="text-xs text-muted-foreground">
              <td />
              <td className="px-3 pb-2 pt-1 text-right">Entry total</td>
              <td className="tabular whitespace-nowrap border-t px-3 pb-2 pt-1 text-right">{amt(e.totalDebit, currency)}</td>
              <td className="tabular whitespace-nowrap border-t px-3 pb-2 pt-1 pr-5 text-right">{amt(e.totalCredit, currency)}</td>
            </tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="bg-muted/50 font-semibold">
            <td className="border-t border-b-[3px] border-double px-3 py-3 pl-5" colSpan={2}>
              Total · {data.length} {data.length === 1 ? "entry" : "entries"}
            </td>
            <td className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 text-right">{amt(money2(totalDebit), currency)}</td>
            <td className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 pr-5 text-right">{amt(money2(totalCredit), currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function journalTotalsBalanced(report: Of<"journal">) {
  const d = report.data.reduce((s, e) => s.plus(dec(e.totalDebit)), new Decimal(0));
  const c = report.data.reduce((s, e) => s.plus(dec(e.totalCredit)), new Decimal(0));
  return d.eq(c);
}

export function journalCsv(report: Of<"journal">, companyName: string): CsvRows {
  const { period } = report;
  const rows: CsvRows = [
    ...meta("Journal Register", companyName, `${period.from} to ${period.to}`),
    ["Date", "JE", "Entry type", "Entry description", "Posted by", "Transaction", "Entered by", "Account code", "Account", "Line description", "Debit", "Credit"],
  ];
  for (const e of report.data) {
    for (const l of e.lines) {
      rows.push([
        e.date,
        journalRef(e.number),
        e.type,
        e.description,
        e.postedByName,
        e.transaction ? txnRef(e.transaction.number) : "",
        e.transaction?.createdByName ?? "",
        l.code,
        l.name,
        l.description ?? "",
        l.debit,
        l.credit,
      ]);
    }
  }
  return rows;
}

export { ledgerCsv };

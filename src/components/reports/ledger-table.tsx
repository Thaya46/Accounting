import Link from "next/link";
import { Check } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { journalRef, txnRef } from "@/lib/ids";
import { dec } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EntryTypeBadge } from "./entry-type-badge";
import { amt } from "./statement";

export type LedgerData = {
  account: { id: string; code: string; name: string; type: string; subtype: string | null };
  from: string;
  to: string;
  opening: string;
  closing: string;
  totalDebit: string;
  totalCredit: string;
  entries: {
    lineId: string;
    date: string;
    journalEntryId: string;
    journalNumber: number;
    journalType: string;
    description: string;
    transactionId: string | null;
    transactionNumber: number | null;
    enteredBy: string;
    debit: string;
    credit: string;
    balance: string;
    reconciled: boolean;
  }[];
};

function Bal({ value, currency }: { value: string; currency: string }) {
  return <span className={cn(dec(value).isNegative() && "text-expense")}>{amt(value, currency)}</span>;
}

/** General ledger for one account: opening row, postings with running balance, closing row. */
export function LedgerTable({ workspaceId, data, currency }: { workspaceId: string; data: LedgerData; currency: string }) {
  const zero = (v: string) => dec(v).isZero();
  return (
    <div className="relative overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">
          General ledger for {data.account.code} {data.account.name}, {formatDate(data.from)} to {formatDate(data.to)}
        </caption>
        <thead className="border-b bg-muted/50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="h-10 whitespace-nowrap px-3 pl-5">Date</th>
            <th scope="col" className="px-3">JE</th>
            <th scope="col" className="px-3">Description</th>
            <th scope="col" className="px-3">Transaction</th>
            <th scope="col" className="px-3">Entered by</th>
            <th scope="col" className="px-3 text-right">Debit</th>
            <th scope="col" className="px-3 text-right">Credit</th>
            <th scope="col" className="whitespace-nowrap px-3 text-right">Running balance</th>
            <th scope="col" className="px-3 pr-5 text-center">
              <span className="sr-only">Reconciled</span>
              <Check className="mx-auto h-3.5 w-3.5" aria-hidden />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b bg-muted/20 font-medium">
            <td className="whitespace-nowrap px-3 py-2 pl-5 text-muted-foreground">{formatDate(data.from)}</td>
            <td className="px-3 py-2" colSpan={6}>
              Opening balance
            </td>
            <td className="tabular whitespace-nowrap px-3 py-2 text-right">
              <Bal value={data.opening} currency={currency} />
            </td>
            <td className="pr-5" />
          </tr>
          {data.entries.length === 0 && (
            <tr className="border-b">
              <td colSpan={9} className="px-5 py-8 text-center text-sm text-muted-foreground">
                No postings to this account in the selected period.
              </td>
            </tr>
          )}
          {data.entries.map((e) => (
            <tr key={e.lineId} className="border-b transition-colors hover:bg-muted/30">
              <td className="whitespace-nowrap px-3 py-2 pl-5 text-muted-foreground">{formatDate(e.date)}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="font-mono text-xs">{journalRef(e.journalNumber)}</span>
                {e.journalType !== "STANDARD" && <EntryTypeBadge type={e.journalType} className="ml-1.5" />}
              </td>
              <td className="max-w-[320px] px-3 py-2">
                <span className="line-clamp-2" title={e.description}>
                  {e.description}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {e.transactionId && e.transactionNumber !== null ? (
                  <Link href={`/w/${workspaceId}/transactions/${e.transactionId}`} className="font-medium text-primary hover:underline">
                    {txnRef(e.transactionNumber)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{e.enteredBy}</td>
              <td className="tabular whitespace-nowrap px-3 py-2 text-right">{zero(e.debit) ? "" : amt(e.debit, currency)}</td>
              <td className="tabular whitespace-nowrap px-3 py-2 text-right">{zero(e.credit) ? "" : amt(e.credit, currency)}</td>
              <td className="tabular whitespace-nowrap px-3 py-2 text-right font-medium">
                <Bal value={e.balance} currency={currency} />
              </td>
              <td className="px-3 py-2 pr-5 text-center">
                {e.reconciled ? (
                  <span title="Reconciled" className="inline-flex text-income">
                    <Check className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Reconciled</span>
                  </span>
                ) : (
                  <span className="sr-only">Not reconciled</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/50 font-semibold">
            <td className="whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 pl-5 text-muted-foreground">{formatDate(data.to)}</td>
            <td className="border-t border-b-[3px] border-double px-3 py-3" colSpan={4}>
              Closing balance
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {data.entries.length} {data.entries.length === 1 ? "posting" : "postings"}
              </span>
            </td>
            <td className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 text-right">{amt(data.totalDebit, currency)}</td>
            <td className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 text-right">{amt(data.totalCredit, currency)}</td>
            <td className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-3 py-3 text-right">
              <Bal value={data.closing} currency={currency} />
            </td>
            <td className="border-t border-b-[3px] border-double pr-5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ledgerCsv(data: LedgerData, companyName: string): (string | number)[][] {
  return [
    ["General Ledger", companyName],
    ["Account", `${data.account.code} ${data.account.name}`],
    ["Period", data.from, data.to],
    ["Generated from posted journal entries only"],
    [],
    ["Date", "JE", "Entry type", "Description", "Transaction", "Entered by", "Debit", "Credit", "Running balance", "Reconciled"],
    [data.from, "", "", "Opening balance", "", "", "", "", data.opening, ""],
    ...data.entries.map((e) => [
      e.date,
      journalRef(e.journalNumber),
      e.journalType,
      e.description,
      e.transactionNumber !== null ? txnRef(e.transactionNumber) : "",
      e.enteredBy,
      e.debit,
      e.credit,
      e.balance,
      e.reconciled ? "Yes" : "No",
    ]),
    [data.to, "", "", "Closing balance", "", "", data.totalDebit, data.totalCredit, data.closing, ""],
  ];
}

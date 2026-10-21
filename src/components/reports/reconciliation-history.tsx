import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { dec } from "@/lib/money";
import type { ReconciliationSummary } from "@/lib/accounting/reconciliation";
import { cn } from "@/lib/utils";
import { amt } from "./statement";

export function ReconciliationHistory({ items, currency, timeZone }: { items: ReconciliationSummary[]; currency: string; timeZone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconciliation history</CardTitle>
        <CardDescription>Completed reconciliations for this account, latest statement first.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {items.length === 0 ? (
          <EmptyState icon={History} title="Not reconciled yet" description="Completed reconciliations will be listed here." className="py-8" />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH className="pl-5">Statement date</TH>
                <TH className="text-right">Statement balance</TH>
                <TH className="text-right">Cleared balance</TH>
                <TH className="text-right">Difference</TH>
                <TH className="text-right">Items</TH>
                <TH>Completed by</TH>
                <TH className="pr-5">Completed at</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((r) => {
                const diff = dec(r.difference);
                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap pl-5 font-medium">{formatDate(r.statementDate)}</TD>
                    <TD className="tabular whitespace-nowrap text-right">{amt(r.statementBalance, currency)}</TD>
                    <TD className="tabular whitespace-nowrap text-right">{amt(r.bookBalance, currency)}</TD>
                    <TD className={cn("tabular whitespace-nowrap text-right", diff.isZero() ? "text-muted-foreground" : "font-medium text-warning")}>
                      {diff.isZero() ? "—" : amt(r.difference, currency)}
                    </TD>
                    <TD className="tabular text-right">{r.lineCount}</TD>
                    <TD className="whitespace-nowrap">{r.completedByName}</TD>
                    <TD className="whitespace-nowrap pr-5 text-muted-foreground">{formatDateTime(r.createdAt, timeZone)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

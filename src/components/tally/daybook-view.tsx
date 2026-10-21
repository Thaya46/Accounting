"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Calendar, ChevronDown, ChevronRight, Eye, Filter } from "lucide-react";
import type { DayBookEntry } from "@/lib/accounting/daybook";

const VOUCHER_COLORS: Record<string, string> = {
  SALES: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  PURCHASE: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  PAYMENT: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  RECEIPT: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  CONTRA: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  JOURNAL: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  CREDIT_NOTE: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  DEBIT_NOTE: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

export function DayBookView({
  workspaceId,
  currency,
  date,
  totalDebit,
  totalCredit,
  count,
  entries,
}: {
  workspaceId: string;
  currency: string;
  date: string;
  totalDebit: string;
  totalCredit: string;
  count: number;
  entries: DayBookEntry[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detailed, setDetailed] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState(searchParams.get("type") || "ALL");
  const [selectedDate, setSelectedDate] = React.useState(date);

  // Keyboard shortcut for Alt+F1 (Detailed/Condensed)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "F1" || e.code === "F1")) {
        e.preventDefault();
        setDetailed((d) => !d);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", newDate);
    if (selectedType !== "ALL") params.set("type", selectedType);
    router.push(`/w/${workspaceId}/daybook?${params.toString()}`);
  };

  const handleTypeChange = (newType: string) => {
    setSelectedType(newType);
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", selectedDate);
    if (newType !== "ALL") params.set("type", newType);
    else params.delete("type");
    router.push(`/w/${workspaceId}/daybook?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="ALL">All Vouchers</option>
              <option value="SALES">Sales (F8)</option>
              <option value="PURCHASE">Purchase (F9)</option>
              <option value="PAYMENT">Payment (F5)</option>
              <option value="RECEIPT">Receipt (F6)</option>
              <option value="CONTRA">Contra (F4)</option>
              <option value="JOURNAL">Journal (F7)</option>
              <option value="CREDIT_NOTE">Credit Note</option>
              <option value="DEBIT_NOTE">Debit Note</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetailed(!detailed)}
            className="text-xs font-semibold"
          >
            {detailed ? "Condensed View" : "Detailed View (Alt+F1)"}
          </Button>
          <Badge variant="outline" className="text-xs font-medium">
            {count} {count === 1 ? "Voucher" : "Vouchers"}
          </Badge>
        </div>
      </div>

      {/* Main Tally Day Book Table */}
      <Card className="overflow-hidden border shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-3 pl-4 pr-3">Date</th>
                <th className="py-3 px-3">Particulars</th>
                <th className="py-3 px-3">Vch Type</th>
                <th className="py-3 px-3 text-right">Vch No.</th>
                <th className="py-3 px-3 text-right">Debit Amount</th>
                <th className="py-3 pr-4 pl-3 text-right">Credit Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No vouchers recorded for {selectedDate}.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <React.Fragment key={entry.id}>
                    <tr className="transition-colors hover:bg-muted/30">
                      <td className="py-3 pl-4 pr-3 align-top font-medium text-xs tabular text-muted-foreground">
                        {entry.date}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <Link
                          href={`/w/${workspaceId}/transactions/${entry.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {entry.partyName || entry.debitAccountName || entry.creditAccountName || entry.description}
                        </Link>
                        {entry.description && (
                          <span className="block text-xs text-muted-foreground">
                            {entry.description}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
                            VOUCHER_COLORS[entry.voucherType] || "bg-muted text-muted-foreground"
                          }`}
                        >
                          {entry.voucherType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right align-top font-mono text-xs text-muted-foreground">
                        #{entry.number}
                      </td>
                      <td className="py-3 px-3 text-right align-top font-mono font-medium">
                        {entry.voucherType === "PAYMENT" || entry.voucherType === "PURCHASE" || entry.voucherType === "JOURNAL"
                          ? formatMoney(entry.amount, currency)
                          : "—"}
                      </td>
                      <td className="py-3 pr-4 pl-3 text-right align-top font-mono font-medium">
                        {entry.voucherType === "RECEIPT" || entry.voucherType === "SALES" || entry.voucherType === "CONTRA"
                          ? formatMoney(entry.amount, currency)
                          : "—"}
                      </td>
                    </tr>

                    {/* Detailed ledger split view (Alt+F1) */}
                    {detailed && (
                      <tr className="bg-muted/20 text-xs">
                        <td colSpan={2} className="py-2 pl-8 pr-3">
                          <div className="space-y-1 font-mono text-muted-foreground">
                            {entry.lines.map((l, idx) => (
                              <div key={idx} className="flex justify-between">
                                <span>{l.accountName}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td colSpan={2} className="py-2 px-3 text-muted-foreground italic">
                          Created by: {entry.createdByName}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                          {entry.lines.map((l, idx) => (
                            <div key={idx}>
                              {Number(l.debit) > 0 ? formatMoney(l.debit, currency) : "—"}
                            </div>
                          ))}
                        </td>
                        <td className="py-2 pr-4 pl-3 text-right font-mono text-muted-foreground">
                          {entry.lines.map((l, idx) => (
                            <div key={idx}>
                              {Number(l.credit) > 0 ? formatMoney(l.credit, currency) : "—"}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
            {entries.length > 0 && (
              <tfoot className="border-t-2 border-primary/20 bg-muted/50 font-semibold">
                <tr>
                  <td colSpan={4} className="py-3 pl-4 pr-3 text-right font-medium">
                    Total:
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-base font-bold text-primary">
                    {formatMoney(totalDebit, currency)}
                  </td>
                  <td className="py-3 pr-4 pl-3 text-right font-mono text-base font-bold text-primary">
                    {formatMoney(totalCredit, currency)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

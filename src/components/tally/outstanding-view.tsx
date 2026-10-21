"use client";

import * as React from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownLeft, ArrowUpRight, Clock, FileText } from "lucide-react";

type PartyRow = {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pendingAmount: string;
  days0To30: string;
  days31To60: string;
  days61To90: string;
  daysAbove90: string;
  bills: {
    id: string;
    refNo: string;
    type: string;
    amount: string;
    pending: string;
    dueDate: string | null;
  }[];
};

export function OutstandingView({
  workspaceId,
  currency,
  asOf,
  partyType,
  totalPending,
  total0To30,
  total31To60,
  total61To90,
  totalAbove90,
  parties,
}: {
  workspaceId: string;
  currency: string;
  asOf: string;
  partyType: "DEBTOR" | "CREDITOR";
  totalPending: string;
  total0To30: string;
  total31To60: string;
  total61To90: string;
  totalAbove90: string;
  parties: PartyRow[];
}) {
  const isReceivable = partyType === "DEBTOR";

  return (
    <div className="space-y-6">
      {/* ── Aging Summary Slabs ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4 border-l-4 border-l-primary">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Outstanding
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-primary">
              {formatMoney(totalPending, currency)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">As of {asOf}</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            0 - 30 Days (Current)
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(total0To30, currency)}
            </span>
          </div>
          <span className="text-xs text-emerald-600 font-medium">Within credit period</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-amber-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            31 - 60 Days
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(total31To60, currency)}
            </span>
          </div>
          <span className="text-xs text-amber-600 font-medium">Mild overdue</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-orange-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            61 - 90 Days
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(total61To90, currency)}
            </span>
          </div>
          <span className="text-xs text-orange-600 font-medium">Follow-up needed</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            90+ Days (Critical)
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-rose-600">
              {formatMoney(totalAbove90, currency)}
            </span>
          </div>
          <span className="text-xs text-rose-600 font-medium">Critical overdue</span>
        </Card>
      </div>

      {/* ── Party-Wise Outstanding Table ── */}
      <Card className="overflow-hidden border shadow-xs">
        <div className="border-b bg-muted/40 px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">
            {isReceivable ? "Sundry Debtors (Customers)" : "Sundry Creditors (Vendors)"} Ledger Wise Breakdown
          </span>
          <Badge variant="outline" className="text-xs">
            {parties.length} {parties.length === 1 ? "Party" : "Parties"} with pending balance
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-3 pl-4 pr-3">Party Name</th>
                <th className="py-3 px-3">GSTIN</th>
                <th className="py-3 px-3 text-right">0-30 Days</th>
                <th className="py-3 px-3 text-right">31-60 Days</th>
                <th className="py-3 px-3 text-right">61-90 Days</th>
                <th className="py-3 px-3 text-right">90+ Days</th>
                <th className="py-3 pr-4 pl-3 text-right">Total Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parties.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Clock className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No outstanding {isReceivable ? "receivables" : "payables"} as of {asOf}.
                  </td>
                </tr>
              ) : (
                parties.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-muted/30">
                    <td className="py-3 pl-4 pr-3 font-medium">
                      <Link
                        href={`/w/${workspaceId}/accounts/${p.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground font-mono">{p.code}</span>
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                      {p.gstin || "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-xs">
                      {Number(p.days0To30) > 0 ? formatMoney(p.days0To30, currency) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-xs">
                      {Number(p.days31To60) > 0 ? formatMoney(p.days31To60, currency) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-xs">
                      {Number(p.days61To90) > 0 ? formatMoney(p.days61To90, currency) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-rose-600">
                      {Number(p.daysAbove90) > 0 ? formatMoney(p.daysAbove90, currency) : "—"}
                    </td>
                    <td className="py-3 pr-4 pl-3 text-right font-mono font-bold text-primary">
                      {formatMoney(p.pendingAmount, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {parties.length > 0 && (
              <tfoot className="border-t-2 border-primary/20 bg-muted/50 font-semibold">
                <tr>
                  <td colSpan={2} className="py-3 pl-4 pr-3 font-medium">
                    Grand Total:
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs font-bold">
                    {formatMoney(total0To30, currency)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs font-bold">
                    {formatMoney(total31To60, currency)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs font-bold">
                    {formatMoney(total61To90, currency)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs font-bold text-rose-600">
                    {formatMoney(totalAbove90, currency)}
                  </td>
                  <td className="py-3 pr-4 pl-3 text-right font-mono text-base font-bold text-primary">
                    {formatMoney(totalPending, currency)}
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

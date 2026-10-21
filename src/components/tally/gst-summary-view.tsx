"use client";

import * as React from "react";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { FileText, ShieldCheck } from "lucide-react";

type GstItem = {
  id: string;
  number: number;
  date: string;
  partyName: string;
  gstin: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  totalTax: string;
  totalAmount: string;
};

export function GstSummaryView({
  currency,
  period,
  totalTaxable,
  totalCgst,
  totalSgst,
  totalIgst,
  totalTax,
  outwardCount,
  inwardCount,
  outwardSupplies,
  inwardSupplies,
}: {
  currency: string;
  period: { from: string; to: string };
  totalTaxable: string;
  totalCgst: string;
  totalSgst: string;
  totalIgst: string;
  totalTax: string;
  outwardCount: number;
  inwardCount: number;
  outwardSupplies: GstItem[];
  inwardSupplies: GstItem[];
}) {
  return (
    <div className="space-y-6">
      {/* ── Tax Breakdown Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 border-l-4 border-l-primary">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Taxable Turnover
          </span>
          <div className="mt-1">
            <span className="text-2xl font-bold tracking-tight text-primary">
              {formatMoney(totalTaxable, currency)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{period.from} to {period.to}</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-blue-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total CGST (Central Tax)
          </span>
          <div className="mt-1">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(totalCgst, currency)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Intra-State Central</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total SGST (State Tax)
          </span>
          <div className="mt-1">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(totalSgst, currency)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Intra-State State</span>
        </Card>

        <Card className="p-4 border-l-4 border-l-purple-500">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total IGST (Integrated Tax)
          </span>
          <div className="mt-1">
            <span className="text-xl font-bold tracking-tight">
              {formatMoney(totalIgst, currency)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Inter-State Integrated</span>
        </Card>
      </div>

      {/* ── Tabs: Outward Supplies (GSTR-1) vs Inward Supplies (ITC / GSTR-3B) ── */}
      <Card className="border shadow-xs">
        <Tabs defaultValue="outward" className="w-full">
          <div className="border-b bg-muted/40 px-4 py-2.5 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="outward" className="gap-2">
                <span>Outward Supplies (Sales)</span>
                <Badge variant="outline" className="text-xs">{outwardCount}</Badge>
              </TabsTrigger>
              <TabsTrigger value="inward" className="gap-2">
                <span>Inward Supplies (ITC)</span>
                <Badge variant="outline" className="text-xs">{inwardCount}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="outward" className="m-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-3 pl-4 pr-3">Date</th>
                    <th className="py-3 px-3">Party Name</th>
                    <th className="py-3 px-3">Party GSTIN</th>
                    <th className="py-3 px-3 text-right">Taxable Val</th>
                    <th className="py-3 px-3 text-right">CGST</th>
                    <th className="py-3 px-3 text-right">SGST</th>
                    <th className="py-3 px-3 text-right">IGST</th>
                    <th className="py-3 pr-4 pl-3 text-right">Total Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {outwardSupplies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground">
                        <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                        No outward supplies recorded for this period.
                      </td>
                    </tr>
                  ) : (
                    outwardSupplies.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30">
                        <td className="py-3 pl-4 pr-3 text-xs tabular font-mono text-muted-foreground">{item.date}</td>
                        <td className="py-3 px-3 font-medium">{item.partyName}</td>
                        <td className="py-3 px-3 text-xs font-mono text-muted-foreground">{item.gstin}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.taxableAmount, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.cgst, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.sgst, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.igst, currency)}</td>
                        <td className="py-3 pr-4 pl-3 text-right font-mono font-bold text-primary">{formatMoney(item.totalAmount, currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="inward" className="m-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-3 pl-4 pr-3">Date</th>
                    <th className="py-3 px-3">Supplier Name</th>
                    <th className="py-3 px-3">Supplier GSTIN</th>
                    <th className="py-3 px-3 text-right">Taxable Val</th>
                    <th className="py-3 px-3 text-right">Input CGST</th>
                    <th className="py-3 px-3 text-right">Input SGST</th>
                    <th className="py-3 px-3 text-right">Input IGST</th>
                    <th className="py-3 pr-4 pl-3 text-right">Total Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {inwardSupplies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground">
                        <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
                        No inward tax supplies recorded for this period.
                      </td>
                    </tr>
                  ) : (
                    inwardSupplies.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30">
                        <td className="py-3 pl-4 pr-3 text-xs tabular font-mono text-muted-foreground">{item.date}</td>
                        <td className="py-3 px-3 font-medium">{item.partyName}</td>
                        <td className="py-3 px-3 text-xs font-mono text-muted-foreground">{item.gstin}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.taxableAmount, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.cgst, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.sgst, currency)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs">{formatMoney(item.igst, currency)}</td>
                        <td className="py-3 pr-4 pl-3 text-right font-mono font-bold">{formatMoney(item.totalAmount, currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

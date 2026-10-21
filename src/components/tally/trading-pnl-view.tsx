"use client";

import * as React from "react";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AccountItem = { code: string; name: string; amount: string };

type TradingData = {
  sales: AccountItem[];
  totalSales: string;
  directIncomes: AccountItem[];
  totalDirectIncomes: string;
  purchases: AccountItem[];
  totalPurchases: string;
  directExpenses: AccountItem[];
  totalDirectExpenses: string;
  grossProfit: string;
  isGrossProfit: boolean;
};

type PlData = {
  indirectIncomes: AccountItem[];
  totalIndirectIncomes: string;
  indirectExpenses: AccountItem[];
  totalIndirectExpenses: string;
  netProfit: string;
  isNetProfit: boolean;
};

export function TradingPnlView({
  currency,
  period,
  trading,
  pl,
}: {
  currency: string;
  period: { from: string; to: string };
  trading: TradingData;
  pl: PlData;
}) {
  return (
    <div className="space-y-6">
      {/* ── Trading Account Card ── */}
      <Card className="border shadow-xs">
        <CardHeader className="border-b bg-muted/40 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Trading Account (Gross Profit Computation)
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {period.from} to {period.to}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            {/* Debit Side: Purchases & Direct Expenses */}
            <div className="p-4 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Particulars (Debit / Outflows)
              </span>
              <div className="space-y-2">
                <div className="flex justify-between font-semibold text-sm">
                  <span>To Purchase Accounts</span>
                  <span className="font-mono">{formatMoney(trading.totalPurchases, currency)}</span>
                </div>
                {trading.purchases.map((p) => (
                  <div key={p.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                    <span>{p.name} ({p.code})</span>
                    <span className="font-mono">{formatMoney(p.amount, currency)}</span>
                  </div>
                ))}

                {Number(trading.totalDirectExpenses) > 0 && (
                  <>
                    <div className="flex justify-between font-semibold text-sm pt-2">
                      <span>To Direct Expenses</span>
                      <span className="font-mono">{formatMoney(trading.totalDirectExpenses, currency)}</span>
                    </div>
                    {trading.directExpenses.map((e) => (
                      <div key={e.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                        <span>{e.name}</span>
                        <span className="font-mono">{formatMoney(e.amount, currency)}</span>
                      </div>
                    ))}
                  </>
                )}

                {trading.isGrossProfit && (
                  <div className="flex justify-between border-t pt-2 font-bold text-sm text-emerald-600">
                    <span>To Gross Profit c/d</span>
                    <span className="font-mono">{formatMoney(trading.grossProfit, currency)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Credit Side: Sales & Direct Incomes */}
            <div className="p-4 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Particulars (Credit / Inflows)
              </span>
              <div className="space-y-2">
                <div className="flex justify-between font-semibold text-sm">
                  <span>By Sales Accounts</span>
                  <span className="font-mono">{formatMoney(trading.totalSales, currency)}</span>
                </div>
                {trading.sales.map((s) => (
                  <div key={s.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                    <span>{s.name} ({s.code})</span>
                    <span className="font-mono">{formatMoney(s.amount, currency)}</span>
                  </div>
                ))}

                {Number(trading.totalDirectIncomes) > 0 && (
                  <>
                    <div className="flex justify-between font-semibold text-sm pt-2">
                      <span>By Direct Incomes</span>
                      <span className="font-mono">{formatMoney(trading.totalDirectIncomes, currency)}</span>
                    </div>
                    {trading.directIncomes.map((d) => (
                      <div key={d.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                        <span>{d.name}</span>
                        <span className="font-mono">{formatMoney(d.amount, currency)}</span>
                      </div>
                    ))}
                  </>
                )}

                {!trading.isGrossProfit && Number(trading.grossProfit) > 0 && (
                  <div className="flex justify-between border-t pt-2 font-bold text-sm text-rose-600">
                    <span>By Gross Loss c/d</span>
                    <span className="font-mono">{formatMoney(trading.grossProfit, currency)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Profit & Loss Account Card ── */}
      <Card className="border shadow-xs">
        <CardHeader className="border-b bg-muted/40 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Profit &amp; Loss Account (Net Profit Computation)
            </CardTitle>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                pl.isNetProfit ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
              }`}
            >
              {pl.isNetProfit ? "Net Profit" : "Net Loss"}: {formatMoney(pl.netProfit, currency)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            {/* Debit Side: Indirect Expenses */}
            <div className="p-4 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Debit (Expenses &amp; Losses)
              </span>
              <div className="space-y-2">
                {!trading.isGrossProfit && Number(trading.grossProfit) > 0 && (
                  <div className="flex justify-between font-bold text-sm text-rose-600 pb-2 border-b">
                    <span>To Gross Loss b/d</span>
                    <span className="font-mono">{formatMoney(trading.grossProfit, currency)}</span>
                  </div>
                )}

                <div className="flex justify-between font-semibold text-sm">
                  <span>To Indirect Expenses</span>
                  <span className="font-mono">{formatMoney(pl.totalIndirectExpenses, currency)}</span>
                </div>
                {pl.indirectExpenses.map((e) => (
                  <div key={e.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                    <span>{e.name}</span>
                    <span className="font-mono">{formatMoney(e.amount, currency)}</span>
                  </div>
                ))}

                {pl.isNetProfit && (
                  <div className="flex justify-between border-t pt-3 font-bold text-sm text-emerald-600">
                    <span>To Net Profit (Transfer to Capital A/c)</span>
                    <span className="font-mono">{formatMoney(pl.netProfit, currency)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Credit Side: Indirect Incomes */}
            <div className="p-4 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Credit (Incomes &amp; Gains)
              </span>
              <div className="space-y-2">
                {trading.isGrossProfit && (
                  <div className="flex justify-between font-bold text-sm text-emerald-600 pb-2 border-b">
                    <span>By Gross Profit b/d</span>
                    <span className="font-mono">{formatMoney(trading.grossProfit, currency)}</span>
                  </div>
                )}

                <div className="flex justify-between font-semibold text-sm">
                  <span>By Indirect Incomes</span>
                  <span className="font-mono">{formatMoney(pl.totalIndirectIncomes, currency)}</span>
                </div>
                {pl.indirectIncomes.map((i) => (
                  <div key={i.code} className="flex justify-between pl-4 text-xs text-muted-foreground">
                    <span>{i.name}</span>
                    <span className="font-mono">{formatMoney(i.amount, currency)}</span>
                  </div>
                ))}

                {!pl.isNetProfit && Number(pl.netProfit) > 0 && (
                  <div className="flex justify-between border-t pt-3 font-bold text-sm text-rose-600">
                    <span>By Net Loss (Transfer to Capital A/c)</span>
                    <span className="font-mono">{formatMoney(pl.netProfit, currency)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

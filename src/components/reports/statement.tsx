import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PrintStyles } from "./print-styles";

export const GENERATED_NOTE = "Generated from posted journal entries only.";

/** Amount cell text: always 2 decimals, minus sign for negatives. */
export function amt(value: string | number, currency: string) {
  return formatMoney(value, currency, { decimals: true });
}

/** Page frame shared by every report: back link, title, actions, filters, statement card, footnote. */
export function ReportFrame({
  workspaceId,
  title,
  description,
  actions,
  controls,
  companyName,
  periodLabel,
  status,
  timeZone,
  children,
  backHref,
  backLabel = "Reports",
}: {
  workspaceId: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  controls?: React.ReactNode;
  companyName: string;
  periodLabel: string;
  status?: React.ReactNode;
  timeZone: string;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="vl-report">
      <PrintStyles />
      <div className="mb-6 print:hidden">
        <Link
          href={backHref ?? `/w/${workspaceId}/reports`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> {backLabel}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      </div>
      {controls && <div className="mb-4">{controls}</div>}
      <Card className="overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        <div className="flex flex-col items-center gap-1 border-b px-5 py-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{companyName}</p>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{periodLabel}</p>
          {status && <div className="mt-1">{status}</div>}
        </div>
        {children}
        <div className="flex flex-col gap-1 border-t px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{GENERATED_NOTE}</span>
          <span>Generated {formatDateTime(new Date(), timeZone)}</span>
        </div>
      </Card>
    </div>
  );
}

export function BalancedBadge({ balanced, difference, currency }: { balanced: boolean; difference?: string; currency: string }) {
  return balanced ? (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Balanced ✓
    </Badge>
  ) : (
    <Badge variant="warning" className="gap-1">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Out of balance{difference ? ` by ${amt(dec(difference).abs().toString(), currency)}` : ""}
    </Badge>
  );
}

// ───────────────────────────── Statement table primitives ─────────────────────────────

export function StatementTable({ children, columns = ["Amount"], className }: { children: React.ReactNode; columns?: string[]; className?: string }) {
  return (
    <div className="relative overflow-x-auto scrollbar-thin">
      <table className={cn("w-full min-w-[420px] text-sm", className)}>
        <thead className="sr-only">
          <tr>
            <th scope="col">Account</th>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

export function StatementColumnsHeader({ columns }: { columns: string[] }) {
  return (
    <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-hidden>
      <td className="px-5 py-2">Account</td>
      {columns.map((c) => (
        <td key={c} className="w-[150px] px-5 py-2 text-right sm:w-[180px]">
          {c}
        </td>
      ))}
    </tr>
  );
}

export function SectionHeading({ children, cols = 1 }: { children: React.ReactNode; cols?: number }) {
  return (
    <tr>
      <th scope="rowgroup" colSpan={cols + 1} className="px-5 pb-1.5 pt-5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </th>
    </tr>
  );
}

export function AccountRow({
  code,
  name,
  amounts,
  currency,
  href,
  indent = 1,
  muted,
}: {
  code?: string | null;
  name: React.ReactNode;
  amounts: (string | number | null)[];
  currency: string;
  href?: string;
  indent?: 0 | 1 | 2;
  muted?: boolean;
}) {
  const label = (
    <>
      {code && <span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>}
      <span>{name}</span>
    </>
  );
  return (
    <tr className="transition-colors hover:bg-muted/30">
      <td className={cn("py-1.5 pr-3", indent === 0 ? "pl-5" : indent === 1 ? "pl-9" : "pl-14", muted && "text-muted-foreground")}>
        {href ? (
          <Link href={href} className="hover:text-primary hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </td>
      {amounts.map((a, i) => (
        <td key={i} className={cn("tabular whitespace-nowrap px-5 py-1.5 text-right", muted && "text-muted-foreground")}>
          {a === null ? "" : amt(a, currency)}
        </td>
      ))}
    </tr>
  );
}

export function SubtotalRow({ label, amounts, currency, className }: { label: React.ReactNode; amounts: (string | number | null)[]; currency: string; className?: string }) {
  return (
    <tr className={cn("font-medium", className)}>
      <td className="border-t py-2 pl-5 pr-3">{label}</td>
      {amounts.map((a, i) => (
        <td key={i} className="tabular whitespace-nowrap border-t px-5 py-2 text-right">
          {a === null ? "" : amt(a, currency)}
        </td>
      ))}
    </tr>
  );
}

export function GrandTotalRow({
  label,
  amounts,
  currency,
  tone,
}: {
  label: React.ReactNode;
  amounts: (string | number | null)[];
  currency: string;
  tone?: "income" | "expense" | null;
}) {
  return (
    <tr
      className={cn(
        "text-[15px] font-semibold",
        tone === "income" && "bg-income-soft text-income",
        tone === "expense" && "bg-expense-soft text-expense",
        !tone && "bg-muted/50",
      )}
    >
      <td className="border-t border-b-[3px] border-double py-3 pl-5 pr-3">{label}</td>
      {amounts.map((a, i) => (
        <td key={i} className="tabular whitespace-nowrap border-t border-b-[3px] border-double px-5 py-3 text-right">
          {a === null ? "" : amt(a, currency)}
        </td>
      ))}
    </tr>
  );
}

export function EmptyRow({ children, cols = 1 }: { children: React.ReactNode; cols?: number }) {
  return (
    <tr>
      <td colSpan={cols + 1} className="py-1.5 pl-9 pr-5 text-sm italic text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

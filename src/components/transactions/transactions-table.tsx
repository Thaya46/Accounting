"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { filtersToQuery, type TransactionFilters } from "@/lib/transactions/filters";
import type { SortKey, TransactionRow } from "@/lib/transactions/types";
import { SourceBadge, StatusBadge, TypeBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AmountText, ConfidenceMeter, EnteredBy } from "./display";

function SortHeader({ label, column, sort, href, className }: { label: string; column: "date" | "amount"; sort: SortKey; href: string; className?: string }) {
  const active = sort.startsWith(column);
  const dir = active ? (sort.endsWith("asc") ? "ascending" : "descending") : "none";
  const Icon = !active ? ArrowUpDown : dir === "ascending" ? ArrowUp : ArrowDown;
  return (
    <TH aria-sort={dir} className={className}>
      <Link href={href} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {label}
        <Icon className="h-3 w-3" aria-hidden />
      </Link>
    </TH>
  );
}

/**
 * Transaction table. Primary columns: Date | Description | Amount | Type |
 * Entered By | Status. Secondary columns (ref, category, counterparty,
 * source) appear on wider screens.
 */
export function TransactionsTable({ workspaceId, rows, filters }: { workspaceId: string; rows: TransactionRow[]; filters: TransactionFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const sort: SortKey = filters.sort ?? "date_desc";
  const sortHref = (column: "date" | "amount") => {
    const next: SortKey = sort === `${column}_desc` ? `${column}_asc` : `${column}_desc`;
    return `${pathname}${filtersToQuery(filters, { sort: next === "date_desc" ? undefined : next, page: undefined })}`;
  };
  const hrefFor = (id: string) => `/w/${workspaceId}/transactions/${id}`;

  return (
    <Table className="min-w-[640px]">
      <THead>
        <TR className="hover:bg-transparent">
          <SortHeader label="Date" column="date" sort={sort} href={sortHref("date")} />
          <TH className="hidden lg:table-cell">Ref</TH>
          <TH>Description</TH>
          <TH className="hidden xl:table-cell">Category</TH>
          <TH className="hidden 2xl:table-cell">Counterparty</TH>
          <SortHeader label="Amount" column="amount" sort={sort} href={sortHref("amount")} className="text-right [&>a]:justify-end" />
          <TH>Type</TH>
          <TH className="hidden lg:table-cell">Source</TH>
          <TH>Entered By</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR
            key={r.id}
            className="cursor-pointer"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a,button")) return;
              router.push(hrefFor(r.id));
            }}
          >
            <TD className="tabular whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</TD>
            <TD className="tabular hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">{r.ref}</TD>
            <TD className="max-w-[340px]">
              <Link href={hrefFor(r.id)} className="block truncate font-medium hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none">
                {r.description}
              </Link>
              <div className="truncate text-xs text-muted-foreground">
                <span className="lg:hidden">{r.ref}</span>
                {r.categoryName && (
                  <span className="xl:hidden">
                    <span className="lg:hidden"> · </span>
                    {r.categoryName}
                  </span>
                )}
                {r.counterparty && <span className="2xl:hidden"> · {r.counterparty}</span>}
                {r.aiConfidence != null && (
                  <span className="ml-2 hidden align-middle sm:inline-block">
                    <ConfidenceMeter value={r.aiConfidence} compact />
                  </span>
                )}
              </div>
            </TD>
            <TD className="hidden max-w-[180px] truncate text-muted-foreground xl:table-cell">{r.categoryName ?? "—"}</TD>
            <TD className="hidden max-w-[180px] truncate text-muted-foreground 2xl:table-cell">{r.counterparty ?? "—"}</TD>
            <TD className="text-right">
              <AmountText amount={r.amount} currency={r.currency} type={r.type} />
            </TD>
            <TD>
              <TypeBadge type={r.type} />
            </TD>
            <TD className="hidden lg:table-cell">
              <SourceBadge source={r.source} />
            </TD>
            <TD className="max-w-[200px]">
              <EnteredBy name={r.enteredBy} disabled={r.enteredByDisabled} />
            </TD>
            <TD>
              <StatusBadge status={r.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

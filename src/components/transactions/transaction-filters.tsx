"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { activeFilterCount, filtersToQuery, type TransactionFilters } from "@/lib/transactions/filters";
import { SOURCE_LABELS, STATUS_LABELS, TYPE_LABELS, type MemberOption } from "@/lib/transactions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

type CategoryFilterOption = { id: string; name: string; kind: "INCOME" | "EXPENSE"; isActive: boolean };

function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Filter bar for transaction tables. All state lives in the URL so filtered
 * views are shareable and survive reloads; the server applies the filters.
 */
export function TransactionFilterBar({
  filters,
  members,
  categories,
  showEnteredBy,
  resolvedRange,
}: {
  filters: TransactionFilters;
  members: MemberOption[];
  categories: CategoryFilterOption[];
  showEnteredBy: boolean;
  resolvedRange: { from?: string; to?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(filters.q ?? "");
  const [min, setMin] = React.useState(filters.min ?? "");
  const [max, setMax] = React.useState(filters.max ?? "");
  const advancedCount = activeFilterCount({ ...filters, q: undefined });
  const [open, setOpen] = React.useState(advancedCount > 0);
  const total = activeFilterCount(filters);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const minRef = React.useRef<HTMLInputElement>(null);
  const maxRef = React.useRef<HTMLInputElement>(null);
  // Keep local inputs in sync when the URL changes elsewhere (back/forward, clear) — never while the user is typing in them.
  const focused = (r: React.RefObject<HTMLInputElement | null>) => typeof document !== "undefined" && document.activeElement === r.current;
  React.useEffect(() => {
    if (!focused(searchRef)) setQ(filters.q ?? "");
  }, [filters.q]);
  React.useEffect(() => {
    if (!focused(minRef)) setMin(filters.min ?? "");
  }, [filters.min]);
  React.useEffect(() => {
    if (!focused(maxRef)) setMax(filters.max ?? "");
  }, [filters.max]);

  const apply = React.useCallback(
    (patch: Partial<Record<keyof TransactionFilters, string | undefined>>) => {
      const next = { ...filters, ...patch, page: undefined } as TransactionFilters;
      for (const k of Object.keys(next) as (keyof TransactionFilters)[]) if (next[k] === "" || next[k] === undefined) delete next[k];
      startTransition(() => router.replace(`${pathname}${filtersToQuery(next)}`, { scroll: false }));
    },
    [filters, pathname, router],
  );

  // Debounced free-text search.
  React.useEffect(() => {
    const value = q.trim();
    if (value === (filters.q ?? "")) return;
    const t = setTimeout(() => apply({ q: value || undefined }), 400);
    return () => clearTimeout(t);
  }, [q, filters.q, apply]);

  const applyAmounts = () => {
    const clean = (v: string) => v.replace(/,/g, "").trim();
    const a = clean(min);
    const b = clean(max);
    if (a === (filters.min ?? "") && b === (filters.max ?? "")) return;
    apply({ min: a || undefined, max: b || undefined });
  };

  const range = filters.range ?? (filters.from || filters.to ? "custom" : "");
  const income = categories.filter((c) => c.kind === "INCOME");
  const expense = categories.filter((c) => c.kind === "EXPENSE");

  return (
    <div className="mb-4 rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply({ q: q.trim() || undefined });
            }}
            placeholder="Search description, reference, notes, contact or TXN number"
            className="pl-9 pr-9"
            aria-label="Search transactions"
            maxLength={120}
          />
          {pending && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Loading" />}
        </div>
        <Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="txn-filters" className="shrink-0 md:hidden">
          <SlidersHorizontal />
          <span className="hidden sm:inline">Filters</span>
          {advancedCount > 0 && <Badge className="px-1.5">{advancedCount}</Badge>}
        </Button>
        {total > 0 && (
          <Button variant="ghost" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))} className="shrink-0 px-2 sm:px-3">
            <X /> <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      <div id="txn-filters" className={cn("mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4", !open && "hidden md:grid")}>
        {showEnteredBy && (
          <Field label="Entered by" htmlFor="f-by">
            <NativeSelect id="f-by" value={filters.by ?? ""} onChange={(e) => apply({ by: e.target.value || undefined })}>
              <option value="">Everyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.disabled ? " (deactivated)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}

        <Field label="Date" htmlFor="f-range">
          <NativeSelect
            id="f-range"
            value={range}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") apply({ range: "custom", from: resolvedRange.from, to: resolvedRange.to });
              else apply({ range: v || undefined, from: undefined, to: undefined });
            }}
          >
            <option value="">All dates</option>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="this-fy">This financial year</option>
            <option value="custom">Custom range…</option>
          </NativeSelect>
          {range && range !== "custom" && resolvedRange.from && resolvedRange.to && (
            <p className="text-[11px] text-muted-foreground">
              {formatDate(resolvedRange.from)} – {formatDate(resolvedRange.to)}
            </p>
          )}
        </Field>

        {range === "custom" && (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
            <Field label="From" htmlFor="f-from">
              <Input id="f-from" type="date" value={filters.from ?? ""} max={filters.to} onChange={(e) => apply({ range: "custom", from: e.target.value || undefined })} />
            </Field>
            <Field label="To" htmlFor="f-to">
              <Input id="f-to" type="date" value={filters.to ?? ""} min={filters.from} onChange={(e) => apply({ range: "custom", to: e.target.value || undefined })} />
            </Field>
          </div>
        )}

        <Field label="Category" htmlFor="f-category">
          <NativeSelect id="f-category" value={filters.category ?? ""} onChange={(e) => apply({ category: e.target.value || undefined })}>
            <option value="">All categories</option>
            {expense.length > 0 && (
              <optgroup label="Expense">
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </optgroup>
            )}
            {income.length > 0 && (
              <optgroup label="Income">
                {income.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
        </Field>

        <Field label="Type" htmlFor="f-type">
          <NativeSelect id="f-type" value={filters.type ?? ""} onChange={(e) => apply({ type: e.target.value || undefined })}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Entry source" htmlFor="f-source">
          <NativeSelect id="f-source" value={filters.source ?? ""} onChange={(e) => apply({ source: e.target.value || undefined })}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Status" htmlFor="f-status">
          <NativeSelect id="f-status" value={filters.status ?? ""} onChange={(e) => apply({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Amount" htmlFor="f-min">
          <div className="flex items-center gap-1.5">
            <Input
              ref={minRef}
              id="f-min"
              inputMode="decimal"
              placeholder="Min"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              onBlur={applyAmounts}
              onKeyDown={(e) => e.key === "Enter" && applyAmounts()}
              className="tabular"
              aria-label="Minimum amount"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              ref={maxRef}
              inputMode="decimal"
              placeholder="Max"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              onBlur={applyAmounts}
              onKeyDown={(e) => e.key === "Enter" && applyAmounts()}
              className="tabular"
              aria-label="Maximum amount"
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

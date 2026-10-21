"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/overlay";

type Counts = { ALL: number; ACTIVE: number; SUSPENDED: number; ARCHIVED: number };

const TABS: { value: keyof Counts; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Search box + status tabs; state lives in the URL (?q=&status=) so the server renders the results. */
export function WorkspacesToolbar({ counts, query, status: currentStatus }: { counts: Counts; query: string; status: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState(query);
  const [pending, startTransition] = React.useTransition();
  const status = TABS.some((t) => t.value === currentStatus) ? currentStatus : "ALL";

  React.useEffect(() => setQ(query), [query]);

  const push = (next: { q?: string | null; status?: string | null }) => {
    const merged = { q: query || null, status: status === "ALL" ? null : status, ...next };
    const sp = new URLSearchParams();
    if (merged.q) sp.set("q", merged.q);
    if (merged.status) sp.set("status", merged.status);
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `/admin/workspaces?${qs}` : "/admin/workspaces", { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
        <Tabs value={status} onValueChange={(v) => push({ status: v === "ALL" ? null : v })}>
          <TabsList aria-label="Filter by status">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular text-muted-foreground">{counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <form
        role="search"
        className="relative w-full lg:max-w-xs"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: q.trim() || null });
        }}
      >
        {pending ? (
          <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, code, company, email…"
          aria-label="Search workspaces"
          className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
          maxLength={100}
        />
        {(q || query) && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              push({ q: null });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}

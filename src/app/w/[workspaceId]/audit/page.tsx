import Link from "next/link";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { auditFilterOptions, parseAuditFiltersLenient, queryAuditEvents, type AuditFilters as Filters } from "@/lib/workspace-admin/audit-log";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { AuditFilters } from "@/components/workspace-admin/audit/audit-filters";
import { AuditTable } from "@/components/workspace-admin/audit/audit-table";

export const metadata = { title: "Audit Log" };

function pageHref(base: string, filters: Filters, page: number) {
  const qs = new URLSearchParams();
  for (const key of ["actor", "action", "entity", "q", "from", "to"] as const) {
    const v = filters[key];
    if (v) qs.set(key, v);
  }
  if (page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "AUDIT_VIEW");
  const filters = parseAuditFiltersLenient(await searchParams);
  const [result, options] = await Promise.all([
    queryAuditEvents({ id: ctx.workspace.id, timeZone: ctx.workspace.timeZone }, filters),
    auditFilterOptions(ctx.workspace.id),
  ]);
  const base = `/w/${ctx.workspace.id}/audit`;
  const { page, pageCount, total, pageSize } = result;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const filtered = Boolean(filters.actor || filters.action || filters.entity || filters.q || filters.from || filters.to);

  return (
    <>
      <PageHeader title="Audit Log" description={`Every change in ${ctx.workspace.name}, who made it and when. Times are shown in ${ctx.workspace.timeZone}.`} />
      <div className="space-y-4">
        <Alert variant="info" title="Audit history is append-only and cannot be edited or deleted.">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Events are protected by the database; even administrators cannot change them. Attribution stays visible after a user is disabled.
          </span>
        </Alert>
        <AuditFilters
          values={{ actor: filters.actor, action: filters.action, entity: filters.entity, q: filters.q, from: filters.from, to: filters.to }}
          options={options}
        />
        <AuditTable workspaceId={ctx.workspace.id} rows={result.rows} filtered={filtered} />
        {total > 0 && (
          <nav className="flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Audit log pages">
            <p className="text-sm text-muted-foreground tabular">
              Showing {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} of {total.toLocaleString("en-US")} events
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={pageHref(base, filters, page - 1)}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}
              >
                <ChevronLeft /> Previous
              </Link>
              <span className="text-sm text-muted-foreground tabular">
                Page {page} of {pageCount}
              </span>
              <Link
                href={pageHref(base, filters, page + 1)}
                aria-disabled={page >= pageCount}
                tabIndex={page >= pageCount ? -1 : undefined}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pageCount && "pointer-events-none opacity-50")}
              >
                Next <ChevronRight />
              </Link>
            </div>
          </nav>
        )}
      </div>
    </>
  );
}

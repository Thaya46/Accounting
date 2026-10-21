import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, Plus, SearchX } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { listWorkspaces, parseWorkspaceStatus } from "@/lib/admin/queries";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { WorkspacesToolbar } from "@/components/admin/workspaces-toolbar";
import { Pagination, pageHref } from "@/components/admin/pagination";

export const metadata = { title: "Workspaces" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WorkspacesPage({ searchParams }: { searchParams: SP }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 100);
  const status = parseWorkspaceStatus(one(sp.status));
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const data = await listWorkspaces({ q, status, page });
  const filtered = Boolean(q || status);
  const filterParams = { q: q || undefined, status: status ?? undefined };
  if (data.items.length === 0 && data.total > 0) redirect(pageHref("/admin/workspaces", filterParams, Math.ceil(data.total / data.pageSize)));

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Every company workspace on the platform, its status, members and administrators."
        actions={
          <Button asChild>
            <Link href="/admin/workspaces/new">
              <Plus /> New workspace
            </Link>
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <WorkspacesToolbar counts={data.counts} query={q} status={status ?? "ALL"} />
        {data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No workspaces match"
              description={q ? `Nothing matches “${q}”${status ? ` among ${status.toLowerCase()} workspaces` : ""}.` : `There are no ${status?.toLowerCase()} workspaces.`}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/workspaces">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Building2}
              title="No workspaces yet"
              description="Create the first workspace and invite its administrator."
              action={
                <Button asChild size="sm">
                  <Link href="/admin/workspaces/new">
                    <Plus /> New workspace
                  </Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table className="min-w-[960px]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Workspace</TH>
                  <TH>Company</TH>
                  <TH>Country / Currency</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Members</TH>
                  <TH>Admins</TH>
                  <TH>Created</TH>
                  <TH className="w-px">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((w) => (
                  <TR key={w.id}>
                    <TD>
                      <Link href={`/admin/workspaces/${w.id}`} className="font-medium hover:text-primary hover:underline">
                        {w.name}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <span>{w.ref}</span>
                        <span aria-hidden>·</span>
                        <span>{w.code}</span>
                      </p>
                    </TD>
                    <TD className="max-w-[220px]">
                      <p className="truncate">{w.companyName}</p>
                      <p className="truncate text-xs text-muted-foreground">{w.companyEmail}</p>
                    </TD>
                    <TD>
                      <p>{w.country}</p>
                      <p className="font-mono text-xs text-muted-foreground">{w.currency}</p>
                    </TD>
                    <TD>
                      <StatusBadge status={w.status} />
                    </TD>
                    <TD className="text-right tabular">
                      <p className="font-medium">{w.members.active}</p>
                      {w.members.invited > 0 && <p className="text-xs text-muted-foreground">+{w.members.invited} invited</p>}
                    </TD>
                    <TD className="max-w-[220px]">
                      {w.admins.length === 0 ? (
                        <span className="text-xs text-warning">No admin</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {w.admins.slice(0, 2).map((a) => (
                            <li key={a.email} className="flex items-center gap-1.5 text-xs">
                              <span className="truncate" title={a.email}>
                                {a.name}
                              </span>
                              {a.status === "INVITED" && <span className="shrink-0 text-muted-foreground">(invited)</span>}
                            </li>
                          ))}
                          {w.admins.length > 2 && <li className="text-xs text-muted-foreground">+{w.admins.length - 2} more</li>}
                        </ul>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground tabular">{formatDate(w.createdAt)}</TD>
                    <TD>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/workspaces/${w.id}`} aria-label={`Manage ${w.name}`}>
                          Manage <ChevronRight />
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              basePath="/admin/workspaces"
              params={filterParams}
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
            />
          </>
        )}
      </Card>
    </>
  );
}

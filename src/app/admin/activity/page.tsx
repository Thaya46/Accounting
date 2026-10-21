import { redirect } from "next/navigation";
import { ScrollText, SearchX } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { activityFilterOptions, listActivity, platformTimeZone } from "@/lib/admin/queries";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { ActivityFilters, type ActivityFilterValues } from "@/components/admin/activity-filters";
import { ActivityTable } from "@/components/admin/activity-table";
import { Pagination, pageHref } from "@/components/admin/pagination";

export const metadata = { title: "Activity Log" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 100);
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function ActivityPage({ searchParams }: { searchParams: SP }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const values: ActivityFilterValues = {
    q: one(sp.q),
    actor: one(sp.actor),
    workspace: one(sp.workspace).slice(0, 64),
    entity: one(sp.entity).slice(0, 64),
    from: day(one(sp.from)),
    to: day(one(sp.to)),
  };
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  const timeZone = await platformTimeZone();
  const [data, options] = await Promise.all([listActivity({ ...values, page }, timeZone), activityFilterOptions()]);
  const filtered = Object.values(values).some(Boolean);
  const filterParams = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || undefined]));
  if (data.items.length === 0 && data.total > 0) redirect(pageHref("/admin/activity", filterParams, Math.ceil(data.total / data.pageSize)));

  return (
    <>
      <PageHeader
        title="Activity Log"
        description={`System-wide, append-only audit trail of every recorded action. Times shown in ${timeZone.replace(/_/g, " ")}.`}
      />
      <Card className="overflow-hidden">
        <ActivityFilters values={values} workspaces={options.workspaces} entityTypes={options.entityTypes} />
        {data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No events match these filters" description="Try widening the date range or clearing a filter." />
          ) : (
            <EmptyState icon={ScrollText} title="No activity recorded yet" description="Sign-ins, workspace changes and other audited actions will appear here." />
          )
        ) : (
          <>
            <ActivityTable items={data.items} timeZone={timeZone} />
            <Pagination
              basePath="/admin/activity"
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

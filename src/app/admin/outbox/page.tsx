import { redirect } from "next/navigation";
import { Inbox, SearchX } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { listOutbox, platformTimeZone } from "@/lib/admin/queries";
import { emailStatus } from "@/lib/email/send";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader } from "@/components/ui/feedback";
import { OutboxFilters, OutboxTable, SendTestEmailButton } from "@/components/admin/outbox";
import { Pagination, pageHref } from "@/components/admin/pagination";

export const metadata = { title: "Email Outbox" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 64);

export default async function OutboxPage({ searchParams }: { searchParams: SP }) {
  const { user } = await requireSuperAdmin();
  const sp = await searchParams;
  const status = one(sp.status).toUpperCase();
  const template = one(sp.template);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  const [data, timeZone] = await Promise.all([listOutbox({ status, template, page }), platformTimeZone()]);
  const email = emailStatus();
  const filtered = Boolean((status && status !== "ALL") || template);
  const filterParams = { status: status && status !== "ALL" ? status : undefined, template: template || undefined };
  if (data.items.length === 0 && data.total > 0) redirect(pageHref("/admin/outbox", filterParams, Math.ceil(data.total / data.pageSize)));

  return (
    <>
      <PageHeader
        title="Email Outbox"
        description="Every transactional email the platform attempted to send, newest first."
        actions={<SendTestEmailButton defaultTo={user.email} />}
      />
      {email.transport === "none" && (
        <Alert variant="warning" title="Email delivery is not configured" className="mb-6">
          {email.note}{" "}
          {email.devOutbox
            ? "Messages are recorded here as “Outbox (not sent)”. Use “View message” to retrieve invitation and reset links during development."
            : "The development outbox is disabled, so undelivered message bodies are not kept."}
        </Alert>
      )}
      <Card className="overflow-hidden">
        <OutboxFilters status={status} template={template} templates={data.templates} counts={data.counts} />
        {data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No emails match these filters" />
          ) : (
            <EmptyState icon={Inbox} title="No emails yet" description="Invitations, password resets and security notifications will be listed here." />
          )
        ) : (
          <>
            <OutboxTable items={data.items} timeZone={timeZone} />
            <Pagination
              basePath="/admin/outbox"
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

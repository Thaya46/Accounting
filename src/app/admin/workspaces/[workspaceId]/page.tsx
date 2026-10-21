import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getWorkspaceDetail, platformTimeZone } from "@/lib/admin/queries";
import { fyMonthLabel } from "@/lib/admin/constants";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { WorkspaceEditCard } from "@/components/admin/workspace-edit-card";
import { WorkspaceStatusCard } from "@/components/admin/workspace-status-card";
import { WorkspaceAdminsCard } from "@/components/admin/workspace-admins-card";
import { WorkspaceUsageCard } from "@/components/admin/workspace-usage-card";

type Params = Promise<{ workspaceId: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }) {
  await requireSuperAdmin();
  const { workspaceId } = await params;
  const ws = workspaceId.length <= 64 ? await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }) : null;
  return { title: ws ? ws.name : "Workspace not found" };
}

export default async function WorkspaceDetailPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  await requireSuperAdmin();
  const { workspaceId } = await params;
  const sp = await searchParams;
  const [detail, timeZone] = await Promise.all([getWorkspaceDetail(workspaceId), platformTimeZone()]);
  if (!detail) notFound();

  const { workspace: ws } = detail;
  const justCreated = sp.created === "1";
  const latestInvite = detail.invitations[0];
  const undelivered = latestInvite?.delivery && latestInvite.delivery.status !== "SENT" ? latestInvite : null;

  return (
    <>
      <PageHeader
        title={ws.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{ws.ref}</span>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs">{ws.code}</span>
            <StatusBadge status={ws.status} />
            <span className="text-xs">
              {ws.defaultCurrency} · FY {fyMonthLabel(ws.fyStartMonth)} · {ws.timeZone.replace(/_/g, " ")}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/workspaces">
                <ArrowLeft /> All workspaces
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/activity?workspace=${ws.id}`}>
                <Activity /> Activity log
              </Link>
            </Button>
          </>
        }
      />

      {(justCreated || undelivered) && (
        <div className="mb-6 space-y-3">
          {justCreated && (
            <Alert variant="success" title="Workspace created">
              {ws.ref} is provisioned with its chart of accounts, roles and settings
              {latestInvite ? `, and ${latestInvite.name} has a pending Workspace Admin invitation.` : "."}
            </Alert>
          )}
          {undelivered && (
            <Alert variant="warning" title={`The invitation email to ${undelivered.email} was not delivered`}>
              {undelivered.delivery?.error ? <span className="block">{undelivered.delivery.error}</span> : null}
              <span className="block">
                {undelivered.delivery?.status === "DEV_LOGGED" ? (
                  <>
                    Email delivery (Brevo) is not configured, so the message was kept in the{" "}
                    <Link href="/admin/outbox?status=DEV_LOGGED" className="font-medium underline underline-offset-2">
                      Email Outbox
                    </Link>{" "}
                    where the invitation link can be copied in development. Configure Brevo and use Resend to deliver it.
                  </>
                ) : (
                  <>
                    Check the{" "}
                    <Link href="/admin/outbox?status=FAILED" className="font-medium underline underline-offset-2">
                      Email Outbox
                    </Link>{" "}
                    for details, fix the email configuration, then use Resend below.
                  </>
                )}
              </span>
            </Alert>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <WorkspaceEditCard
            workspaceId={ws.id}
            readOnly={ws.status === "ARCHIVED"}
            currencyLocked={detail.currencyLocked}
            initial={{
              name: ws.name,
              companyName: ws.companyName,
              companyEmail: ws.companyEmail,
              country: ws.country,
              defaultCurrency: ws.defaultCurrency,
              fyStartMonth: ws.fyStartMonth,
              timeZone: ws.timeZone,
            }}
          />
          <WorkspaceAdminsCard
            workspaceId={ws.id}
            workspaceStatus={ws.status}
            admins={detail.admins}
            invitations={detail.invitations}
            timeZone={timeZone}
          />
        </div>
        <div className="space-y-6">
          <WorkspaceStatusCard
            workspaceId={ws.id}
            workspaceName={ws.name}
            status={ws.status}
            suspendedAt={ws.suspendedAt}
            archivedAt={ws.archivedAt}
            createdAt={ws.createdAt}
            history={detail.statusHistory}
            timeZone={timeZone}
          />
          <WorkspaceUsageCard usage={detail.usage} timeZone={timeZone} />
          {ws.createdBy && (
            <p className="px-1 text-xs text-muted-foreground">
              Created by {ws.createdBy.name} ({ws.createdBy.email})
            </p>
          )}
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CheckCheck,
  CircleCheck,
  CircleX,
  CreditCard,
  FileOutput,
  FilePen,
  Inbox,
  Landmark,
  ListChecks,
  Send,
  Undo2,
  Upload,
  Wallet,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, TypeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { txnRef } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { actionVerb, relativeTime, subtypeLabel } from "@/lib/dashboard/format";
import type { ActivityItem, RecentTxn, UserActivityRow, WorkspaceDashboardData } from "@/lib/dashboard/queries";

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn("min-w-0 flex-1", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

// ───────────────────────────── Bank & cash ─────────────────────────────

const SUBTYPE_ICON: Record<string, LucideIcon> = { BANK: Landmark, CASH: Banknote, WALLET: Wallet, CREDIT_CARD: CreditCard };

export function BalancesCard({ workspaceId, data, currency, asOf }: { workspaceId: string; data: WorkspaceDashboardData["balances"]; currency: string; asOf: string }) {
  const net = Number(data.cashTotal) - Number(data.cardTotal);
  return (
    <SectionCard title="Bank and cash balances" description={`As of ${formatDate(asOf)}`}>
      {data.accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="No bank or cash accounts" description="Add a bank, cash or wallet account in the chart of accounts." className="py-8" />
      ) : (
        <div className="flex h-full flex-col">
          <ul className="-mx-2 flex-1 divide-y">
            {data.accounts.map((a) => {
              const Icon = SUBTYPE_ICON[a.subtype ?? ""] ?? Landmark;
              const isCard = a.subtype === "CREDIT_CARD";
              const negative = Number(a.balance) < 0;
              return (
                <li key={a.id}>
                  <Link
                    href={`/w/${workspaceId}/accounts/${a.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {a.code} · {subtypeLabel(a.subtype)}
                        {!a.isActive && " · inactive"}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn("tabular block text-sm font-semibold", negative && "text-expense")}>{formatMoney(a.balance, currency)}</span>
                      {isCard && <span className="block text-[11px] text-muted-foreground">owed</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="font-medium">Cash &amp; bank total</dt>
              <dd className={cn("tabular font-semibold", Number(data.cashTotal) < 0 && "text-expense")}>{formatMoney(data.cashTotal, currency)}</dd>
            </div>
            {data.hasCards && (
              <>
                <div className="flex items-center justify-between gap-3 text-muted-foreground">
                  <dt>Credit card dues</dt>
                  <dd className="tabular">{formatMoney(data.cardTotal, currency)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-medium">Net liquid funds</dt>
                  <dd className={cn("tabular font-semibold", net < 0 && "text-expense")}>{formatMoney(net, currency)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
    </SectionCard>
  );
}

// ───────────────────────────── Transactions ─────────────────────────────

export function TransactionsTable({ workspaceId, items, showEnteredBy = true }: { workspaceId: string; items: RecentTxn[]; showEnteredBy?: boolean }) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="pl-5">Date</TH>
          <TH>Description</TH>
          <TH className="text-right">Amount</TH>
          <TH>Type</TH>
          {showEnteredBy && <TH>Entered by</TH>}
          <TH className="pr-5">Status</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((t) => (
          <TR key={t.id}>
            <TD className="whitespace-nowrap pl-5 text-muted-foreground">{formatDate(t.date)}</TD>
            <TD className="max-w-[280px]">
              <Link href={`/w/${workspaceId}/transactions/${t.id}`} className="block truncate font-medium hover:text-primary hover:underline" title={t.description}>
                {t.description}
              </Link>
              <span className="text-xs text-muted-foreground">{txnRef(t.number)}</span>
            </TD>
            <TD
              className={cn(
                "tabular whitespace-nowrap text-right font-medium",
                t.type === "INCOME" && "text-income",
                t.type === "EXPENSE" && "text-expense",
              )}
            >
              {formatMoney(t.amount, t.currency)}
            </TD>
            <TD>
              <TypeBadge type={t.type} />
            </TD>
            {showEnteredBy && <TD className="whitespace-nowrap">{t.createdByName}</TD>}
            <TD className="pr-5">
              <StatusBadge status={t.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function RecentTransactionsCard({
  workspaceId,
  items,
  scope,
  canCreate,
  title,
  showEnteredBy = true,
  className,
}: {
  workspaceId: string;
  items: RecentTxn[];
  scope: "workspace" | "mine";
  canCreate: boolean;
  title?: string;
  showEnteredBy?: boolean;
  className?: string;
}) {
  const listHref = scope === "workspace" ? `/w/${workspaceId}/transactions` : `/w/${workspaceId}/transactions/mine`;
  return (
    <SectionCard
      title={title ?? (scope === "workspace" ? "Recent transactions" : "My recent transactions")}
      description={scope === "workspace" ? "Latest entries across the workspace" : "Latest entries you recorded"}
      action={items.length > 0 ? <CardLink href={listHref}>View all</CardLink> : undefined}
      contentClassName="px-0 pb-2"
      className={className}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No transactions yet"
          description={canCreate ? "Record your first income or expense with voice, text or the manual form." : "Transactions will appear here once they are recorded."}
          action={
            canCreate ? (
              <Link href={`/w/${workspaceId}/entry`} className="text-sm font-medium text-primary hover:underline">
                Record a transaction
              </Link>
            ) : undefined
          }
          className="py-8"
        />
      ) : (
        <TransactionsTable workspaceId={workspaceId} items={items} showEnteredBy={showEnteredBy} />
      )}
    </SectionCard>
  );
}

// ───────────────────────────── Transactions by user ─────────────────────────────

export function UserActivityTable({ rows, currency }: { rows: UserActivityRow[]; currency: string }) {
  return (
    <Table className="text-[13px]">
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="pl-5">User</TH>
          <TH className="text-right">Entries</TH>
          <TH className="text-right">Income</TH>
          <TH className="pr-5 text-right">Expenses</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.userId}>
            <TD className="max-w-[160px] truncate pl-5 font-medium" title={r.name}>
              {r.name}
            </TD>
            <TD className="tabular text-right">
              {r.count}
              {r.posted !== r.count && <span className="ml-1 text-xs text-muted-foreground">({r.posted} posted)</span>}
            </TD>
            <TD className="tabular whitespace-nowrap text-right">{formatMoney(r.income, currency)}</TD>
            <TD className="tabular whitespace-nowrap pr-5 text-right">{formatMoney(r.expenses, currency)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// ───────────────────────────── Approvals ─────────────────────────────

export function PendingApprovalsCard({ workspaceId, data }: { workspaceId: string; data: WorkspaceDashboardData["pending"] }) {
  const href = `/w/${workspaceId}/approvals`;
  return (
    <SectionCard
      title="Pending approvals"
      description={data.count === 1 ? "1 transaction awaiting review" : `${data.count} transactions awaiting review`}
      action={data.canApprove && data.count > 0 ? <CardLink href={href}>Review</CardLink> : undefined}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight">{data.count}</span>
        <span className="text-sm text-muted-foreground">pending</span>
      </div>
      {data.canApprove && data.items.length > 0 && (
        <ul className="-mx-2 mt-3 divide-y">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link href={href} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.description}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {txnRef(t.number)} · {t.createdByName} · {formatDate(t.date)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(t.amount, t.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.count === 0 && <p className="mt-2 text-sm text-muted-foreground">Nothing is waiting for approval.</p>}
      {!data.canApprove && data.count > 0 && <p className="mt-2 text-sm text-muted-foreground">An approver will review these entries before they are posted.</p>}
    </SectionCard>
  );
}

// ───────────────────────────── Export history ─────────────────────────────

export function ExportHistoryCard({ workspaceId, items, timeZone }: { workspaceId: string; items: NonNullable<WorkspaceDashboardData["exports"]>; timeZone: string }) {
  return (
    <SectionCard title="Export history" description="Latest accounting exports" action={<CardLink href={`/w/${workspaceId}/export`}>Export center</CardLink>}>
      {items.length === 0 ? (
        <EmptyState icon={FileOutput} title="No exports yet" description="Exports to Tally, Zoho Books, QuickBooks and others will be listed here." className="py-6" />
      ) : (
        <ul className="-mx-2 divide-y">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-2 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileOutput className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={e.fileName}>
                  {e.adapterName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.recordCount} {e.recordCount === 1 ? "record" : "records"} · {e.createdByName}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {e.status !== "COMPLETED" && <StatusBadge status={e.status} className="mb-0.5" />}
                <span className="block text-xs text-muted-foreground" title={formatDateTime(e.createdAt, timeZone)}>
                  {relativeTime(e.createdAt) ?? formatDate(e.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ───────────────────────────── Activity ─────────────────────────────

const ACTION_ICON: Record<string, LucideIcon> = {
  CREATED: FilePen,
  UPDATED: FilePen,
  SUBMITTED: Send,
  APPROVED: CircleCheck,
  REJECTED: CircleX,
  POSTED: CheckCheck,
  REVERSED: Undo2,
  EXPORTED: FileOutput,
  IMPORTED: Upload,
};

const ACTION_TONE: Record<string, string> = {
  APPROVED: "text-income",
  POSTED: "text-income",
  REJECTED: "text-expense",
  REVERSED: "text-warning",
};

export function ActivityFeed({ workspaceId, items, timeZone }: { workspaceId: string; items: ActivityItem[]; timeZone: string }) {
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title="No activity yet" description="Actions on your transactions will show up here." className="py-8" />;
  }
  return (
    <ol className="relative space-y-4">
      {items.map((a) => {
        const Icon = ACTION_ICON[a.action] ?? ActivityIcon;
        return (
          <li key={a.id} className="flex gap-3">
            <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", ACTION_TONE[a.action])}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="leading-snug">
                <span className="font-medium">{a.isMe ? "You" : a.actorName}</span> {actionVerb(a.action)}{" "}
                {a.transaction ? (
                  <Link href={`/w/${workspaceId}/transactions/${a.transaction.id}`} className="font-medium text-primary hover:underline">
                    {txnRef(a.transaction.number)}
                  </Link>
                ) : (
                  a.entityType !== "TRANSACTION" && <span className="text-muted-foreground">({a.entityType.toLowerCase().replace(/_/g, " ")})</span>
                )}
              </p>
              {a.transaction?.description && <p className="truncate text-xs text-muted-foreground">{a.transaction.description}</p>}
              {a.reason && <p className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">“{a.reason}”</p>}
              <p className="mt-0.5 text-xs text-muted-foreground" title={formatDateTime(a.createdAt, timeZone)}>
                {relativeTime(a.createdAt) ?? formatDateTime(a.createdAt, timeZone)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

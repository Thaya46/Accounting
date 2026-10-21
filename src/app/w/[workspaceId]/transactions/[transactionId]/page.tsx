import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, FileUp, History, Info, Quote, ScrollText, ShieldCheck, UserX } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/guards";
import { formatDate, formatDateTime, todayInTimeZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { loadTransactionDetail } from "@/lib/transactions/detail";
import { SOURCE_LABELS, STATUS_LABELS, TYPE_LABELS, type PersonStamp } from "@/lib/transactions/types";
import { Badge, SourceBadge, StatusBadge, TypeBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/misc";
import { AmountText, ConfidenceMeter, MetaItem } from "@/components/transactions/display";
import { AuditTimeline, JournalTable } from "@/components/transactions/detail-parts";
import { TransactionActions } from "@/components/transactions/transaction-actions";

export const metadata = { title: "Transaction" };

function Stamp({ stamp, empty = "—" }: { stamp: PersonStamp; empty?: string }) {
  if (!stamp.name && !stamp.at) return <span className="text-muted-foreground">{empty}</span>;
  return <>{stamp.name ?? "—"}</>;
}

function StampAt({ stamp, tz }: { stamp: PersonStamp; tz: string }) {
  return stamp.at ? <>{formatDateTime(stamp.at, tz)}</> : <span className="text-muted-foreground">—</span>;
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string; transactionId: string }> }) {
  const { workspaceId, transactionId } = await params;
  const ctx = await requireWorkspace(workspaceId);
  const detail = await loadTransactionDetail(ctx, transactionId);
  if (!detail) notFound();
  const { view: t, abilities } = detail;
  const tz = t.workspace.timeZone;
  const base = t.workspace.currency;
  const foreign = t.currency !== base;
  const canViewAll = ctx.permissions.has("TRANSACTION_VIEW");
  const backHref = canViewAll ? `/w/${workspaceId}/transactions` : `/w/${workspaceId}/transactions/mine`;
  const lastDecision = t.approvals[t.approvals.length - 1];
  const counterparty = t.customer ? { label: "Customer", name: t.customer } : t.vendor ? { label: "Vendor", name: t.vendor } : null;

  const refs: Record<string, string> = {};
  if (t.reversal?.id) refs[t.reversal.id] = `${t.reversal.ref} · ${t.reversal.id}`;

  const accountLabel = (a: { code: string; name: string } | null) =>
    a ? (
      <>
        {a.name} <span className="text-xs text-muted-foreground">({a.code})</span>
      </>
    ) : t.type === "JOURNAL" ? (
      <span className="text-muted-foreground">Multiple — see journal lines</span>
    ) : (
      <span className="text-muted-foreground">Not set</span>
    );

  return (
    <>
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {canViewAll ? "All transactions" : "My transactions"}
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tabular text-xl font-semibold tracking-tight sm:text-2xl">{t.ref}</h1>
            <TypeBadge type={t.type} />
            <StatusBadge status={t.status} />
            <SourceBadge source={t.source} />
            {t.isAdjustment && <Badge variant="info">Adjustment</Badge>}
          </div>
          <p className="break-words text-base sm:text-lg">{t.description}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(t.date)} · Entered by <span className="font-medium text-foreground">{t.createdBy.nameSnapshot}</span>
            {t.createdBy.disabled && " (deactivated)"} · {formatDateTime(t.createdAt, tz)}
          </p>
        </div>
        <div className="shrink-0 lg:text-right">
          <AmountText amount={t.amount} currency={t.currency} type={t.type} className="text-3xl font-semibold tracking-tight" />
          {foreign && (
            <p className="tabular text-sm text-muted-foreground">
              = {formatMoney(t.baseAmount, base, { decimals: true })} at {t.exchangeRate}
            </p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <TransactionActions
          workspaceId={workspaceId}
          transactionId={t.id}
          refLabel={t.ref}
          abilities={abilities}
          journalDate={t.journal && !t.journal.proposed ? t.journal.date : null}
          today={todayInTimeZone(tz)}
        />
      </div>

      <div className="mb-6 space-y-3 empty:hidden">
        {t.status === "REJECTED" && lastDecision?.decision === "REJECTED" && (
          <Alert variant="danger" title={`Rejected by ${lastDecision.decidedByName}`}>
            {lastDecision.comment ?? "No comment given."}
          </Alert>
        )}
        {t.status === "REVERSED" && (
          <Alert variant="warning" title={`Reversed by ${t.reversed.name ?? "—"}${t.reversed.at ? ` on ${formatDateTime(t.reversed.at, tz)}` : ""}`}>
            Reason: {t.reversed.reason ?? "—"}
          </Alert>
        )}
        {t.missingForPosting.length > 0 && (t.status === "DRAFT" || t.status === "REJECTED") && (
          <Alert variant="info" title="Incomplete draft">
            Before this can be submitted or posted, add: {t.missingForPosting.join(", ")}.
          </Alert>
        )}
        {t.status === "PENDING_APPROVAL" && <Alert variant="warning" title="Waiting for approval">An approver needs to review this transaction before it can be posted.</Alert>}
        {t.status === "APPROVED" && <Alert variant="info" title={`Approved by ${t.approved.name ?? "—"}`}>Ready to be posted to the general ledger.</Alert>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" /> Transaction metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetaItem label="Transaction ID">
                  <span className="tabular font-medium">{t.ref}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{t.id}</span>
                </MetaItem>
                <MetaItem label="Workspace">
                  <span className="tabular font-medium">{t.workspace.ref}</span> · {t.workspace.name}
                  <span className="block font-mono text-[11px] text-muted-foreground">{t.workspace.id}</span>
                </MetaItem>
                <MetaItem label="Transaction date">{formatDate(t.date)}</MetaItem>
                <MetaItem label="Transaction type">{TYPE_LABELS[t.type]}</MetaItem>
                <MetaItem label="Amount">
                  <AmountText amount={t.amount} currency={t.currency} type={t.type} />
                </MetaItem>
                <MetaItem label="Currency">
                  {t.currency}
                  {foreign && (
                    <span className="block text-xs text-muted-foreground">
                      Rate {t.exchangeRate} → {formatMoney(t.baseAmount, base, { decimals: true })}
                    </span>
                  )}
                </MetaItem>
                <MetaItem label="Description" className="sm:col-span-2 xl:col-span-3">
                  {t.description}
                </MetaItem>
                <MetaItem label="Category">{t.category?.name ?? <span className="text-muted-foreground">{t.type === "TRANSFER" || t.type === "JOURNAL" ? "Not applicable" : "Not set"}</span>}</MetaItem>
                <MetaItem label="Debit account">{accountLabel(t.debitAccount)}</MetaItem>
                <MetaItem label="Credit account">{accountLabel(t.creditAccount)}</MetaItem>
                <MetaItem label="Payment method">{t.paymentMethod ?? <span className="text-muted-foreground">Not specified</span>}</MetaItem>
                <MetaItem label="Status">
                  <StatusBadge status={t.status} />
                </MetaItem>
                <MetaItem label="Entry source">{SOURCE_LABELS[t.source]}</MetaItem>
                <MetaItem label="Created by">
                  <span className="font-medium">{t.createdBy.nameSnapshot}</span>
                  <span className="block text-xs text-muted-foreground">
                    User ID {t.createdBy.ref} · <span className="font-mono">{t.createdBy.id}</span>
                  </span>
                </MetaItem>
                <MetaItem label="Created at">{formatDateTime(t.createdAt, tz)}</MetaItem>
                <MetaItem label="Last modified by">
                  <Stamp stamp={t.updated} empty="Not modified since creation" />
                  {t.updated.id && <span className="block font-mono text-[11px] text-muted-foreground">{t.updated.id}</span>}
                </MetaItem>
                <MetaItem label="Last modified at">
                  <StampAt stamp={t.updated} tz={tz} />
                </MetaItem>
                <MetaItem label="Approved by">
                  <Stamp stamp={t.approved} empty="Not applicable" />
                  {t.approved.id && <span className="block font-mono text-[11px] text-muted-foreground">{t.approved.id}</span>}
                </MetaItem>
                <MetaItem label="Approved at">
                  <StampAt stamp={t.approved} tz={tz} />
                </MetaItem>
                <MetaItem label="Posted by">
                  <Stamp stamp={t.posted} empty="Not posted" />
                </MetaItem>
                <MetaItem label="Posted at">
                  <StampAt stamp={t.posted} tz={tz} />
                </MetaItem>
                {(t.reversed.name || t.reversed.at) && (
                  <>
                    <MetaItem label="Reversed by">
                      <Stamp stamp={t.reversed} />
                    </MetaItem>
                    <MetaItem label="Reversed at">
                      <StampAt stamp={t.reversed} tz={tz} />
                    </MetaItem>
                    <MetaItem label="Reversal reason">{t.reversed.reason}</MetaItem>
                  </>
                )}
                {counterparty && <MetaItem label={counterparty.label}>{counterparty.name}</MetaItem>}
                <MetaItem label="Reference">{t.reference ?? <span className="text-muted-foreground">—</span>}</MetaItem>
                {t.aiConfidence != null && (
                  <MetaItem label="AI confidence">
                    <ConfidenceMeter value={t.aiConfidence} />
                  </MetaItem>
                )}
                {t.notes && (
                  <MetaItem label="Notes" className="sm:col-span-2 xl:col-span-3">
                    <span className="whitespace-pre-wrap">{t.notes}</span>
                  </MetaItem>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-primary" /> Journal
              </CardTitle>
              <CardDescription>
                {t.journal?.proposed
                  ? "The balanced entry this transaction will post (amounts in the base currency)."
                  : t.journal
                    ? "The balanced entry posted to the general ledger."
                    : "No journal yet."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {t.journal ? (
                <JournalTable journal={t.journal} currency={base} timeZone={tz} />
              ) : (
                <p className="text-sm text-muted-foreground">Choose the accounts to see the proposed journal entry.</p>
              )}
              {t.journal?.proposed && t.missingForPosting.length > 0 && (
                <p className="text-xs text-warning">Missing before posting: {t.missingForPosting.join(", ")}.</p>
              )}
              {t.reversal && <JournalTable journal={t.reversal} currency={base} timeZone={tz} title="Reversal entry" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Audit history
              </CardTitle>
              <CardDescription>Append-only record of every action on this transaction. It cannot be edited or deleted.</CardDescription>
            </CardHeader>
            <CardContent>
              <AuditTimeline events={t.audit} timeZone={tz} refs={refs} />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Entered by
              </CardTitle>
              <CardDescription>Taken from the signed-in session when the entry was created.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar name={t.createdBy.nameSnapshot} className="h-10 w-10" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.createdBy.nameSnapshot}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.createdBy.ref} · {t.createdBy.email}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.createdBy.disabled ? (
                  <Badge variant="muted" className="gap-1">
                    <UserX className="h-3 w-3" /> Account deactivated
                  </Badge>
                ) : (
                  <Badge variant="success">Active member</Badge>
                )}
                {t.isOwn && <Badge variant="outline">You</Badge>}
              </div>
              {t.createdBy.currentName !== t.createdBy.nameSnapshot && (
                <p className="text-xs text-muted-foreground">Now named “{t.createdBy.currentName}”. The name at the time of entry is kept.</p>
              )}
            </CardContent>
          </Card>

          {(t.rawInput || t.aiConfidence != null) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" /> {t.source === "VOICE" ? "Voice capture" : "Text capture"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {t.rawInput && (
                  <blockquote className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm italic">
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="break-words">{t.rawInput}</span>
                  </blockquote>
                )}
                {t.aiConfidence != null && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Extraction confidence</span>
                    <ConfidenceMeter value={t.aiConfidence} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Approvals</CardTitle>
            </CardHeader>
            <CardContent>
              {t.approvals.length ? (
                <ul className="space-y-3">
                  {t.approvals.map((a) => (
                    <li key={a.id} className="space-y-1 rounded-lg border px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge status={a.decision} />
                        <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt, tz)}</span>
                      </div>
                      <p className="text-sm">
                        by <span className="font-medium">{a.decidedByName}</span>
                      </p>
                      {a.comment && <p className="text-sm text-muted-foreground">“{a.comment}”</p>}
                      <p className="font-mono text-[10px] text-muted-foreground">{a.id}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t.status === "PENDING_APPROVAL" ? "Waiting for an approver." : "No approval decisions on this transaction."}
                </p>
              )}
            </CardContent>
          </Card>

          {t.importInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-primary" /> Import provenance
                </CardTitle>
                <CardDescription>Recorded from the imported file. External identities are not verified.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  <MetaItem label="External creator">
                    {t.importInfo.externalCreatorName || t.importInfo.externalCreatorId ? (
                      <>
                        {t.importInfo.externalCreatorName ?? "Unnamed"}
                        {t.importInfo.externalCreatorId && <span className="text-xs text-muted-foreground"> · ID {t.importInfo.externalCreatorId}</span>}
                        <Badge variant="warning" className="ml-2">
                          Unverified, from import
                        </Badge>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not provided</span>
                    )}
                  </MetaItem>
                  <MetaItem label="External reference">{t.importInfo.externalRef ?? <span className="text-muted-foreground">—</span>}</MetaItem>
                  <MetaItem label="Import job">
                    {t.importInfo.fileName ?? "—"}
                    {t.importInfo.jobId && <span className="block font-mono text-[11px] text-muted-foreground">{t.importInfo.jobId}</span>}
                  </MetaItem>
                  <MetaItem label="Imported by">{t.createdBy.nameSnapshot}</MetaItem>
                </dl>
              </CardContent>
            </Card>
          )}

          <p className="px-1 text-xs text-muted-foreground">
            Status: {STATUS_LABELS[t.status]}. Posted entries are immutable — corrections are made with a reversal or an adjustment journal.
          </p>
        </div>
      </div>
    </>
  );
}

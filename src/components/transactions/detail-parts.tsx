import * as React from "react";
import { ArrowRight, CheckCircle2, FilePlus2, FileUp, Pencil, Send, ThumbsDown, ThumbsUp, Undo2, Upload, type LucideIcon } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AuditEventView, JournalView } from "@/lib/transactions/types";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

const JOURNAL_TYPE: Record<string, { label: string; variant: "secondary" | "info" | "warning" | "muted" }> = {
  STANDARD: { label: "Standard", variant: "secondary" },
  ADJUSTMENT: { label: "Adjustment", variant: "info" },
  REVERSAL: { label: "Reversal", variant: "warning" },
  OPENING: { label: "Opening", variant: "muted" },
};

/** Journal entry lines with debit/credit totals. */
export function JournalTable({ journal, currency, timeZone, title }: { journal: JournalView; currency: string; timeZone: string; title?: string }) {
  const t = JOURNAL_TYPE[journal.type] ?? { label: journal.type, variant: "secondary" as const };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {title && <span className="font-medium">{title}</span>}
        {journal.ref ? <span className="tabular font-semibold">{journal.ref}</span> : <Badge variant="muted">Proposed — not posted yet</Badge>}
        <Badge variant={t.variant}>{t.label}</Badge>
        <span className="text-muted-foreground">{formatDate(journal.date)}</span>
        {journal.postedByName && journal.postedAt && (
          <span className="text-xs text-muted-foreground">
            Posted by {journal.postedByName} · {formatDateTime(journal.postedAt, timeZone)}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-[520px]">
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-10">#</TH>
              <TH>Account</TH>
              <TH className="hidden sm:table-cell">Line description</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </TR>
          </THead>
          <TBody>
            {journal.lines.map((l) => (
              <TR key={`${l.lineNo}-${l.accountId}`} className="hover:bg-transparent">
                <TD className="tabular text-muted-foreground">{l.lineNo}</TD>
                <TD>
                  <span className="font-medium">{l.accountName}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{l.accountCode}</span>
                </TD>
                <TD className="hidden max-w-[260px] truncate text-muted-foreground sm:table-cell">{l.description ?? "—"}</TD>
                <TD className="tabular text-right">{Number(l.debit) > 0 ? formatMoney(l.debit, currency, { decimals: true }) : ""}</TD>
                <TD className="tabular text-right">{Number(l.credit) > 0 ? formatMoney(l.credit, currency, { decimals: true }) : ""}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="hover:bg-transparent">
              <TD colSpan={2} className="text-xs uppercase tracking-wide text-muted-foreground sm:hidden">
                Totals
              </TD>
              <TD colSpan={3} className="hidden text-xs uppercase tracking-wide text-muted-foreground sm:table-cell">
                Totals
              </TD>
              <TD className="tabular text-right font-semibold">{formatMoney(journal.totalDebit, currency, { decimals: true })}</TD>
              <TD className="tabular text-right font-semibold">{formatMoney(journal.totalCredit, currency, { decimals: true })}</TD>
            </TR>
          </TFoot>
        </Table>
      </div>
      {journal.totalDebit === journal.totalCredit ? (
        <p className="flex items-center gap-1 text-xs text-income">
          <CheckCircle2 className="h-3.5 w-3.5" /> Balanced: debits equal credits
        </p>
      ) : (
        <p className="text-xs text-expense">Not balanced yet — debits and credits differ.</p>
      )}
    </div>
  );
}

const ACTIONS: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  CREATED: { label: "Created", icon: FilePlus2, tone: "bg-accent text-accent-foreground" },
  UPDATED: { label: "Updated", icon: Pencil, tone: "bg-info-soft text-info" },
  SUBMITTED: { label: "Submitted for approval", icon: Send, tone: "bg-warning-soft text-warning" },
  APPROVED: { label: "Approved", icon: ThumbsUp, tone: "bg-income-soft text-income" },
  REJECTED: { label: "Rejected", icon: ThumbsDown, tone: "bg-expense-soft text-expense" },
  POSTED: { label: "Posted", icon: CheckCircle2, tone: "bg-income-soft text-income" },
  REVERSED: { label: "Reversed", icon: Undo2, tone: "bg-expense-soft text-expense" },
  EXPORTED: { label: "Exported", icon: Upload, tone: "bg-muted text-muted-foreground" },
  IMPORTED: { label: "Imported", icon: FileUp, tone: "bg-muted text-muted-foreground" },
};

/** Append-only audit history, oldest first. */
export function AuditTimeline({
  events,
  timeZone,
  refs,
}: {
  events: AuditEventView[];
  timeZone: string;
  /** Maps approval / reversal ids to human labels. */
  refs: Record<string, string>;
}) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No audit events recorded.</p>;
  return (
    <ol className="relative space-y-5">
      <span className="absolute bottom-2 left-[15px] top-2 w-px bg-border" aria-hidden />
      {events.map((e) => {
        const a = ACTIONS[e.action] ?? { label: e.action, icon: Pencil, tone: "bg-muted text-muted-foreground" };
        const Icon = a.icon;
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", a.tone)}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold">{a.label}</span>
                <span className="text-sm">by {e.actorName}</span>
                <time dateTime={e.createdAt} className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt, timeZone)}
                </time>
              </div>
              {e.summary && <p className="text-xs text-muted-foreground">{e.summary}</p>}
              {e.reason && (
                <p className="mt-1.5 rounded-md border-l-2 border-primary/40 bg-muted/50 px-2.5 py-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Reason: </span>
                  {e.reason}
                </p>
              )}
              {e.changes.length > 0 && (
                <dl className="mt-2 space-y-1 text-xs">
                  {e.changes.map((c) => (
                    <div key={c.field} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2">
                      <dt className="truncate text-muted-foreground">{c.label}</dt>
                      <dd className="flex min-w-0 flex-wrap items-center gap-1 break-words">
                        {e.action !== "CREATED" && (
                          <>
                            <span className="text-muted-foreground line-through decoration-muted-foreground/50">{c.before ?? "—"}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="changed to" />
                          </>
                        )}
                        <span className="font-medium">{c.after ?? "—"}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {(e.approvalId || e.reversalId) && (
                <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {e.approvalId && (
                    <span>
                      Approval ID: <span className="font-mono">{refs[e.approvalId] ?? e.approvalId}</span>
                    </span>
                  )}
                  {e.reversalId && (
                    <span>
                      Reversal entry: <span className="font-mono">{refs[e.reversalId] ?? e.reversalId}</span>
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

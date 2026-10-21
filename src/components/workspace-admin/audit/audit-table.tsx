"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import type { AuditRow } from "@/lib/workspace-admin/audit-log";
import { cn, titleCaseEnum } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Variant = "info" | "success" | "warning" | "danger" | "secondary" | "outline" | "muted" | "default";

function actionVariant(action: string): Variant {
  if (["APPROVED", "POSTED", "INVITATION_ACCEPTED", "MEMBER_REACTIVATED", "ACCOUNT_REACTIVATED"].includes(action)) return "success";
  if (["REJECTED", "REVERSED"].includes(action) || /(DISABLED|REVOKED|DELETED|DEACTIVATED|FAILED)$/.test(action)) return "danger";
  if (action === "SUBMITTED" || /LOCKED|SUSPICIOUS/.test(action)) return "warning";
  if (action === "CREATED" || /(_CREATED|INVITED|RESENT)$/.test(action)) return "info";
  if (["EXPORTED", "IMPORTED"].includes(action)) return "outline";
  if (action === "UPDATED" || /(UPDATED|CHANGED|_SET)$/.test(action)) return "secondary";
  return "muted";
}

function humanizeKey(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="break-words">{String(value)}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    return value.length ? <span className="break-words">{value.map((v) => String(v)).join(", ")}</span> : <span className="text-muted-foreground">None</span>;
  }
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

/** Side-by-side before/after view; changed keys are highlighted. */
function DiffView({ before, after }: { before: unknown; after: unknown }) {
  if (before == null && after == null) return <p className="text-xs text-muted-foreground">No field values were recorded for this event.</p>;
  if ((before != null && !isRecord(before)) || (after != null && !isRecord(after))) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Before</p>
          <Value value={before} />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">After</p>
          <Value value={after} />
        </div>
      </div>
    );
  }
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const showBefore = before != null;
  const showAfter = after != null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-40 px-3 py-2 font-semibold">Field</th>
            {showBefore && <th className="px-3 py-2 font-semibold">Before</th>}
            {showAfter && <th className="px-3 py-2 font-semibold">After</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const changed = showBefore && showAfter && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null);
            return (
              <tr key={k} className="border-t align-top">
                <td className={cn("px-3 py-2 font-medium", !changed && showBefore && showAfter && "text-muted-foreground")}>{humanizeKey(k)}</td>
                {showBefore && (
                  <td className={cn("px-3 py-2", changed && "bg-expense-soft/60")}>
                    <Value value={b[k]} />
                  </td>
                )}
                {showAfter && (
                  <td className={cn("px-3 py-2", changed && "bg-income-soft/60")}>
                    <Value value={a[k]} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AuditTable({ workspaceId, rows, filtered }: { workspaceId: string; rows: AuditRow[]; filtered: boolean }) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ScrollText}
          title={filtered ? "No events match these filters" : "No audit events yet"}
          description={filtered ? "Try widening the date range or clearing a filter." : "Every change in this workspace will be recorded here."}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH className="w-8">
              <span className="sr-only">Expand</span>
            </TH>
            <TH>When</TH>
            <TH>Actor</TH>
            <TH>Action</TH>
            <TH>Entity</TH>
            <TH>Transaction</TH>
            <TH>Reason</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const isOpen = open.has(r.id);
            return (
              <React.Fragment key={r.id}>
                <TR className={cn("cursor-pointer", isOpen && "bg-muted/40")} onClick={() => toggle(r.id)}>
                  <TD className="pr-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(r.id);
                      }}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? "Hide details" : "Show details"}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </TD>
                  <TD className="whitespace-nowrap text-xs tabular">{r.createdLabel}</TD>
                  <TD className="min-w-[160px]">
                    <p className="font-medium">{r.actorName}</p>
                    {r.actorEmail && <p className="text-xs text-muted-foreground">{r.actorEmail}</p>}
                  </TD>
                  <TD>
                    <Badge variant={actionVariant(r.action)}>{titleCaseEnum(r.action)}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <p className="text-xs font-medium">{titleCaseEnum(r.entityType)}</p>
                    {r.entityId && <p className="font-mono text-[11px] text-muted-foreground">{r.entityId.slice(0, 12)}…</p>}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {r.transactionId ? (
                      <Link
                        href={`/w/${workspaceId}/transactions/${r.transactionId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                      >
                        {r.transactionRef ?? `${r.transactionId.slice(0, 10)}…`}
                      </Link>
                    ) : (
                      !r.approvalId && !r.reversalId && <span className="text-muted-foreground">—</span>
                    )}
                    {r.approvalId && <p className="font-mono text-[11px] text-muted-foreground">Approval {r.approvalId.slice(0, 10)}…</p>}
                    {r.reversalId && <p className="font-mono text-[11px] text-muted-foreground">Reversal {r.reversalId.slice(0, 10)}…</p>}
                  </TD>
                  <TD className="max-w-[260px]">
                    {r.reason ? <p className="line-clamp-2 text-xs">{r.reason}</p> : <span className="text-muted-foreground">—</span>}
                  </TD>
                </TR>
                {isOpen && (
                  <tr className="border-b bg-muted/20">
                    <td colSpan={7} className="px-3 py-4 sm:px-6">
                      <div className="space-y-3">
                        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                          <Meta label="Event ID" value={r.id} />
                          <Meta label="Timestamp (UTC)" value={r.createdAt} />
                          {r.actorUserId && <Meta label="Actor user ID" value={r.actorUserId} />}
                          {r.entityId && <Meta label="Entity ID" value={r.entityId} />}
                          {r.transactionId && <Meta label="Transaction ID" value={r.transactionId} />}
                          {r.approvalId && <Meta label="Approval ID" value={r.approvalId} />}
                          {r.reversalId && <Meta label="Reversal ID" value={r.reversalId} />}
                          {r.ip && <Meta label="IP" value={r.ip} />}
                        </dl>
                        {r.reason && (
                          <p className="text-sm">
                            <span className="font-medium">Reason: </span>
                            {r.reason}
                          </p>
                        )}
                        <DiffView before={r.before} after={r.after} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="break-all font-mono">{value}</dd>
    </div>
  );
}

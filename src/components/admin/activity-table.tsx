"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionBadge } from "./action-badge";

export type ActivityRow = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  workspace: { id: string; name: string; code: string } | null;
  ip: string | null;
  userAgent: string | null;
  redacted: boolean;
  reason: string | null;
  before: unknown;
  after: unknown;
};

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const empty = value === null || value === undefined || (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {empty ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">—</p>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md border bg-card p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}

export function ActivityTable({ items, timeZone }: { items: ActivityRow[]; timeZone: string }) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Table className="min-w-[980px]">
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="w-8">
            <span className="sr-only">Details</span>
          </TH>
          <TH>Time</TH>
          <TH>Actor</TH>
          <TH>Action</TH>
          <TH>Entity</TH>
          <TH>Workspace</TH>
          <TH>IP</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((e) => {
          const expanded = open.has(e.id);
          return (
            <React.Fragment key={e.id}>
              <TR className="cursor-pointer" onClick={() => toggle(e.id)} data-state={expanded ? "selected" : undefined}>
                <TD className="pr-0">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-expanded={expanded}
                    aria-controls={`activity-${e.id}`}
                    aria-label={expanded ? "Hide details" : "Show details"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggle(e.id);
                    }}
                  >
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </TD>
                <TD className="whitespace-nowrap text-xs tabular">
                  <time dateTime={e.createdAt}>{formatDateTime(e.createdAt, timeZone)}</time>
                </TD>
                <TD className="max-w-[220px]">
                  <p className="truncate text-sm font-medium">{e.actorName}</p>
                  {e.actorEmail && <p className="truncate text-xs text-muted-foreground">{e.actorEmail}</p>}
                </TD>
                <TD className="max-w-[260px]">
                  <ActionBadge action={e.action} />
                </TD>
                <TD className="text-xs">
                  <p className="font-medium">{e.entityType}</p>
                  {e.entityId && <p className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground" title={e.entityId}>{e.entityId}</p>}
                </TD>
                <TD className="max-w-[200px] text-xs">
                  {e.workspace ? (
                    <Link href={`/admin/workspaces/${e.workspace.id}`} onClick={(ev) => ev.stopPropagation()} className="block truncate hover:text-primary hover:underline">
                      {e.workspace.name}
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">{e.workspace.code}</span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Platform</span>
                  )}
                </TD>
                <TD className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{e.ip ?? "—"}</TD>
              </TR>
              {expanded && (
                <tr id={`activity-${e.id}`} className="border-b bg-muted/30">
                  <td colSpan={7} className="px-4 py-4">
                    {e.redacted ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <EyeOff className="h-4 w-4" /> Details of workspace financial records are hidden from the Super Admin console. Only the event itself is shown.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {e.reason && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reason</p>
                            <p className="text-sm">{e.reason}</p>
                          </div>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                          <JsonBlock label="Before" value={e.before} />
                          <JsonBlock label="After" value={e.after} />
                        </div>
                      </div>
                    )}
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="flex gap-2">
                        <dt>Event ID</dt>
                        <dd className="font-mono">{e.id}</dd>
                      </div>
                      {e.actorUserId && (
                        <div className="flex gap-2">
                          <dt>Actor ID</dt>
                          <dd className="font-mono">{e.actorUserId}</dd>
                        </div>
                      )}
                      {e.userAgent && (
                        <div className="flex gap-2 sm:col-span-2">
                          <dt className="shrink-0">User agent</dt>
                          <dd className="break-all">{e.userAgent}</dd>
                        </div>
                      )}
                    </dl>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}

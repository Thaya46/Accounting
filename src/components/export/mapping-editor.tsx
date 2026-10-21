"use client";

import * as React from "react";
import { Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn, titleCaseEnum } from "@/lib/utils";
import type { AdapterSpecDTO } from "@/lib/export/types";

export type MappingRow = { accountId: string; code: string; name: string; type: string; subtype?: string | null; isActive?: boolean; externalCode: string; externalName: string };
export type MappingChange = { accountId: string; externalCode: string; externalName: string | null };

/**
 * Account mapping editor: VLedger account → target account identifier. Only
 * changed rows are submitted. Validation messages mirror the server rules.
 */
export function MappingEditor({
  adapter,
  rows,
  onSave,
  saving,
  readOnly,
  searchable = false,
  emptyText = "No accounts to map.",
}: {
  adapter: Pick<AdapterSpecDTO, "name" | "mapping">;
  rows: MappingRow[];
  onSave: (changes: MappingChange[]) => Promise<void> | void;
  saving?: boolean;
  readOnly?: boolean;
  searchable?: boolean;
  emptyText?: string;
}) {
  const [draft, setDraft] = React.useState<Record<string, { code: string; name: string }>>({});
  const [query, setQuery] = React.useState("");
  React.useEffect(() => setDraft({}), [rows]);

  const meta = adapter.mapping ?? { codeLabel: "External code", codeHint: "" };
  const pattern = meta.codePattern ? new RegExp(meta.codePattern) : null;
  const value = (r: MappingRow) => draft[r.accountId] ?? { code: r.externalCode, name: r.externalName };
  const errorFor = (code: string) => {
    const c = code.trim();
    if (!c) return null;
    if (meta.codeMaxLength && c.length > meta.codeMaxLength) return `Max ${meta.codeMaxLength} characters`;
    if (pattern && !pattern.test(c)) return meta.codePatternMessage ?? "Invalid format";
    return null;
  };
  const changed = rows.filter((r) => {
    const v = draft[r.accountId];
    return v && (v.code.trim() !== r.externalCode || v.name.trim() !== (r.externalName ?? ""));
  });
  const invalid = rows.some((r) => errorFor(value(r).code));
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => `${r.code} ${r.name} ${value(r).code} ${value(r).name}`.toLowerCase().includes(q)) : rows;
  const mappedCount = rows.filter((r) => value(r).code.trim()).length;

  if (!rows.length) return <EmptyState title={emptyText} className="py-8" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular">{mappedCount}</span> of <span className="tabular">{rows.length}</span> accounts mapped
          {meta.codeHint ? <span className="hidden md:inline"> · {meta.codeHint}</span> : null}
        </p>
        {searchable && (
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts" className="pl-8" aria-label="Search accounts" />
          </div>
        )}
      </div>
      <div className="rounded-lg border">
        <Table>
          <THead>
            <TR>
              <TH>VLedger account</TH>
              <TH className="min-w-[200px]">{meta.codeLabel}</TH>
              {meta.nameLabel && <TH className="min-w-[180px]">{meta.nameLabel}</TH>}
            </TR>
          </THead>
          <TBody>
            {visible.map((r) => {
              const v = value(r);
              const err = errorFor(v.code);
              return (
                <TR key={r.accountId}>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs">{r.code}</span>
                      {!v.code.trim() && <Badge variant="warning">Unmapped</Badge>}
                      {r.isActive === false && <Badge variant="muted">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.name} · {titleCaseEnum(r.type)}
                    </div>
                  </TD>
                  <TD>
                    <Input
                      value={v.code}
                      disabled={readOnly}
                      aria-label={`${meta.codeLabel} for ${r.code}`}
                      aria-invalid={Boolean(err)}
                      maxLength={meta.codeMaxLength ?? 200}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.accountId]: { code: e.target.value, name: v.name } }))}
                      className={cn("h-8", !v.code.trim() && "border-warning/50")}
                    />
                    {err && <p className="mt-1 text-xs text-expense">{err}</p>}
                  </TD>
                  {meta.nameLabel && (
                    <TD>
                      <Input
                        value={v.name}
                        disabled={readOnly}
                        aria-label={`${meta.nameLabel} for ${r.code}`}
                        maxLength={200}
                        onChange={(e) => setDraft((d) => ({ ...d, [r.accountId]: { code: v.code, name: e.target.value } }))}
                        className="h-8"
                      />
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {changed.length > 0 && <span className="text-xs text-muted-foreground">{changed.length} unsaved change{changed.length === 1 ? "" : "s"}</span>}
          <Button variant="ghost" size="sm" disabled={!changed.length || saving} onClick={() => setDraft({})}>
            Discard
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!changed.length || invalid}
            onClick={() => onSave(changed.map((r) => ({ accountId: r.accountId, externalCode: value(r).code.trim(), externalName: value(r).name.trim() || null })))}
          >
            <Save /> Save mappings
          </Button>
        </div>
      )}
    </div>
  );
}

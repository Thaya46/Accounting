"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AdapterCategoryBadge } from "./shared";

export type PlatformAdapter = {
  key: string;
  name: string;
  vendor: string;
  product: string;
  category: "native" | "generic" | "planned";
  implemented: boolean;
  enabled: boolean;
  updatedAt: string | null;
  importMechanism: string;
  fileType: string;
  provenance: string;
  fullAuditTransfer: boolean;
  specReferences: { label: string; url: string }[];
  exports30d: number;
  workspaces30d: number;
};

const PROVENANCE: Record<string, string> = {
  native: "Dedicated fields",
  narration: "Narration",
  memo: "Memo / notes",
  "custom-field": "Configurable columns",
  none: "—",
};

/** Super Admin: platform availability of each adapter plus 30-day usage counts. */
export function AdminIntegrations({ items: initial }: { items: PlatformAdapter[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => setItems(initial), [initial]);

  async function toggle(a: PlatformAdapter, enabled: boolean) {
    setBusy(a.key);
    setItems((list) => list.map((x) => (x.key === a.key ? { ...x, enabled } : x)));
    try {
      await apiFetch("/api/admin/integrations", { method: "PATCH", body: { key: a.key, enabled } });
      toast.success(`${a.name} ${enabled ? "enabled" : "disabled"} for all workspaces`);
      router.refresh();
    } catch (e) {
      setItems((list) => list.map((x) => (x.key === a.key ? { ...x, enabled: !enabled } : x)));
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  const implemented = items.filter((a) => a.implemented).length;
  const exports30 = items.reduce((n, a) => n + a.exports30d, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Adapters" value={`${items.length}`} hint={`${implemented} implemented · ${items.length - implemented} not implemented`} />
        <Summary label="Enabled on the platform" value={`${items.filter((a) => a.enabled).length}`} hint="Disabled adapters show “Disabled by Super Admin” in every workspace." />
        <Summary label="Exports (30 days)" value={`${exports30}`} hint="Counts only — workspace data is not visible here." />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Export integrations</CardTitle>
          <CardDescription>Turning an adapter off hides generation in every workspace; existing exports and their files are kept.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Adapter</TH>
                <TH>Implementation</TH>
                <TH>Mechanism</TH>
                <TH>Created By transfer</TH>
                <TH className="text-right">Exports · 30d</TH>
                <TH className="text-right">Workspaces · 30d</TH>
                <TH>Specification</TH>
                <TH className="text-right">Enabled</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((a) => (
                <TR key={a.key}>
                  <TD className="min-w-[200px]">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.vendor} · <span className="font-mono">{a.key}</span>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      {a.implemented ? <Badge variant="success">Implemented</Badge> : <Badge variant="muted">Not Implemented</Badge>}
                      <AdapterCategoryBadge category={a.category} />
                    </div>
                  </TD>
                  <TD className="min-w-[260px] max-w-[360px] text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">{a.fileType}</div>
                    <div className="line-clamp-3">{a.importMechanism}</div>
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {PROVENANCE[a.provenance] ?? a.provenance}
                    {a.implemented && !a.fullAuditTransfer && <div className="text-xs text-muted-foreground">+ audit metadata file</div>}
                  </TD>
                  <TD className="text-right tabular">{a.exports30d}</TD>
                  <TD className="text-right tabular">{a.workspaces30d}</TD>
                  <TD className="min-w-[180px]">
                    <ul className="space-y-0.5 text-xs">
                      {a.specReferences.slice(0, 2).map((r) => (
                        <li key={r.url}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="line-clamp-1">{r.label}</span>
                          </a>
                        </li>
                      ))}
                      {a.specReferences.length > 2 && <li className="text-muted-foreground">+{a.specReferences.length - 2} more</li>}
                    </ul>
                  </TD>
                  <TD className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <Switch checked={a.enabled} disabled={busy === a.key} onCheckedChange={(v) => toggle(a, v)} aria-label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`} />
                      {a.updatedAt && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(a.updatedAt)}</span>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

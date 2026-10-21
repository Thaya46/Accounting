"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Info, Loader2, Scale, Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { EXPORT_TYPE_LABEL } from "@/lib/export/canonical-schema";
import type { AdapterSummary } from "@/lib/export/integrations";
import type { AdapterConfig, AdapterSpecDTO } from "@/lib/export/types";
import type { AdapterStatus } from "@/lib/export/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { AdapterCategoryBadge, AdapterStatusBadge, ProvenanceNote, SpecLinks, SpecRow } from "./shared";
import { AdapterConfigForm } from "./config-form";
import { MappingEditor, type MappingChange, type MappingRow } from "./mapping-editor";

type Detail = {
  adapter: AdapterSpecDTO;
  status: AdapterStatus;
  platformEnabled: boolean;
  config: AdapterConfig;
  customFields: { field: string; label: string }[];
  mappings: MappingRow[];
};

/** Integrations page: specification, configuration and account mapping per adapter. */
export function IntegrationsPanel({ workspaceId, adapters }: { workspaceId: string; adapters: AdapterSummary[] }) {
  const [items, setItems] = React.useState(adapters);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && adapters.some((a) => a.spec.key === hash)) {
      setOpen(hash);
      setTimeout(() => document.getElementById(`adapter-${hash}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [adapters]);

  const groups: { title: string; filter: (a: AdapterSummary) => boolean }[] = [
    { title: "Accounting software (native import formats)", filter: (a) => a.spec.category === "native" },
    { title: "Open formats", filter: (a) => a.spec.category === "generic" },
    { title: "Planned integrations", filter: (a) => a.spec.category === "planned" },
  ];

  return (
    <div className="space-y-8">
      <Alert variant="info" title="How exports stay honest">
        Native files are generated from each vendor&apos;s documented import format and must be test-imported before you rely on them. When a target cannot store complete user attribution, the Export Center says so and provides the full audit metadata as a separate file.
      </Alert>
      {groups.map((g) => {
        const list = items.filter(g.filter);
        if (!list.length) return null;
        return (
          <section key={g.title} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h2>
            {list.map((a) => (
              <AdapterCard
                key={a.spec.key}
                workspaceId={workspaceId}
                summary={a}
                open={open === a.spec.key}
                onToggle={() => setOpen((o) => (o === a.spec.key ? null : a.spec.key))}
                onStatus={(status) => setItems((list) => list.map((x) => (x.spec.key === a.spec.key ? { ...x, status } : x)))}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function AdapterCard({ workspaceId, summary, open, onToggle, onStatus }: { workspaceId: string; summary: AdapterSummary; open: boolean; onToggle: () => void; onStatus: (s: AdapterStatus) => void }) {
  const a = summary.spec;
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<"config" | "mappings" | null>(null);
  const url = `/api/w/${workspaceId}/integrations/${a.key}`;

  React.useEffect(() => {
    if (!open || detail || !a.implemented) return;
    let cancelled = false;
    apiFetch<Detail>(url)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Could not load settings"));
    return () => {
      cancelled = true;
    };
  }, [open, detail, a.implemented, url]);

  async function save(kind: "config" | "mappings", body: { config?: AdapterConfig; mappings?: MappingChange[] }) {
    setSaving(kind);
    try {
      const d = await apiFetch<Detail & { saved?: number; removed?: number; configChanged?: boolean }>(url, { method: "PUT", body });
      setDetail(d);
      onStatus(d.status);
      toast.success(kind === "config" ? `${a.name} settings saved` : `Saved ${(d.saved ?? 0) + (d.removed ?? 0)} mapping change${(d.saved ?? 0) + (d.removed ?? 0) === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card id={`adapter-${a.key}`} className="scroll-mt-20 overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-col gap-2 p-4 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.name}</span>
            <AdapterCategoryBadge category={a.category} />
            {!summary.platformEnabled && <Badge variant="secondary">Disabled by Super Admin</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {a.vendor} · {a.fileType}
          </p>
          <ProvenanceNote provenance={a.provenance} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {a.requiresAccountMapping && a.implemented && (
            <span className="text-xs text-muted-foreground tabular">
              {summary.mappedAccounts}/{summary.accountsInUse} in-use accounts mapped
            </span>
          )}
          <AdapterStatusBadge status={summary.status} />
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <CardContent className="space-y-6 border-t pt-5">
          {summary.status.reasons.length > 0 && <Alert variant={summary.status.status === "configuration_required" ? "warning" : "info"}>{summary.status.reasons.join(" ")}</Alert>}

          <dl className="space-y-3">
            <SpecRow label="Product">{a.product}</SpecRow>
            <SpecRow label="Supported versions">{a.supportedVersions.join(" · ")}</SpecRow>
            <SpecRow label="Import mechanism">{a.importMechanism}</SpecRow>
            <SpecRow label="File type">{a.fileType}</SpecRow>
            {a.supportedExportTypes.length > 0 && <SpecRow label="Export types">{a.supportedExportTypes.map((t) => EXPORT_TYPE_LABEL[t]).join(", ")}</SpecRow>}
            <SpecRow label="API transfer">{a.apiTransfer.status === "not_implemented" ? <span>Not Implemented — {a.apiTransfer.note}</span> : "Not applicable (file download)"}</SpecRow>
            <SpecRow label="Required fields">
              <ul className="list-disc space-y-0.5 pl-4">
                {a.requiredFields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </SpecRow>
            <SpecRow label="Account mapping">{a.accountMappingRules}</SpecRow>
            <SpecRow label="Tax mapping">{a.taxMappingRules}</SpecRow>
            <SpecRow label="Currency">{a.currencyMapping}</SpecRow>
            <SpecRow label="Customers / vendors">{a.contactMapping}</SpecRow>
            <SpecRow label="References">{a.referenceRules}</SpecRow>
            <SpecRow label="Provenance">
              {a.provenance.description}{" "}
              {a.provenance.fullAuditTransfer ? <Badge variant="success">Full audit metadata in file</Badge> : <Badge variant="warning">Full audit metadata in separate file</Badge>}
            </SpecRow>
            <SpecRow label="Limitations">
              <ul className="list-disc space-y-0.5 pl-4">
                {a.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </SpecRow>
            <SpecRow label="Specification">
              <SpecLinks links={a.specReferences} />
            </SpecRow>
          </dl>
          <Alert variant={a.implemented ? "info" : "warning"} title={a.implemented ? "Verification" : "Not Implemented"}>
            {a.verificationNote}
          </Alert>

          {a.implemented && (
            <>
              {loadError && <Alert variant="danger">{loadError}</Alert>}
              {!detail && !loadError && (
                <div className="space-y-2" aria-busy="true">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading configuration…
                  </p>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              )}
              {detail && a.configFields.length > 0 && (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Settings2 className="h-4 w-4 text-primary" /> Workspace settings
                  </h3>
                  <AdapterConfigForm adapter={a} config={detail.config} customFields={detail.customFields} saving={saving === "config"} onSave={(config) => save("config", { config })} />
                </section>
              )}
              {detail && (a.requiresAccountMapping || a.key === "custom") && (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Scale className="h-4 w-4 text-primary" /> Account mapping {!a.requiresAccountMapping && <span className="font-normal text-muted-foreground">(optional)</span>}
                  </h3>
                  <MappingEditor adapter={a} rows={detail.mappings} searchable saving={saving === "mappings"} onSave={(mappings) => save("mappings", { mappings })} />
                </section>
              )}
              {detail && !a.configFields.length && !a.requiresAccountMapping && a.key !== "custom" && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4" /> No configuration needed.
                </p>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

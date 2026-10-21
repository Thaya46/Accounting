"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, FileText, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { statusVariant, type AdapterStatus } from "@/lib/export/status";
import type { AdapterSpecDTO, ProvenanceMode } from "@/lib/export/types";

export function AdapterStatusBadge({ status, className }: { status: Pick<AdapterStatus, "status" | "label">; className?: string }) {
  return (
    <Badge variant={statusVariant(status.status)} className={className}>
      {status.label}
    </Badge>
  );
}

const CATEGORY_LABEL: Record<AdapterSpecDTO["category"], string> = { native: "Native import format", generic: "Open format", planned: "Planned" };

export function AdapterCategoryBadge({ category }: { category: AdapterSpecDTO["category"] }) {
  return <Badge variant={category === "native" ? "info" : category === "generic" ? "secondary" : "muted"}>{CATEGORY_LABEL[category]}</Badge>;
}

const PROVENANCE_LABEL: Record<ProvenanceMode, string> = {
  native: "Created By as dedicated fields",
  narration: "Created By in narration",
  memo: "Created By in memo / notes",
  "custom-field": "Created By in configurable columns",
  none: "No provenance transfer",
};

/** One-line statement of how attribution reaches the target. */
export function ProvenanceNote({ provenance, className }: { provenance: AdapterSpecDTO["provenance"]; className?: string }) {
  const Icon = provenance.fullAuditTransfer ? ShieldCheck : provenance.createdByTransfer === "none" ? ShieldOff : ShieldAlert;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", provenance.fullAuditTransfer ? "text-income" : provenance.createdByTransfer === "none" ? "text-muted-foreground" : "text-warning")} />
      <span>
        {provenance.fullAuditTransfer ? "Full audit trail travels in the file" : PROVENANCE_LABEL[provenance.createdByTransfer]}
        {!provenance.fullAuditTransfer && provenance.createdByTransfer !== "none" && " · full audit metadata in a separate file"}
      </span>
    </p>
  );
}

export function SpecLinks({ links, className }: { links: AdapterSpecDTO["specReferences"]; className?: string }) {
  return (
    <ul className={cn("space-y-1 text-sm", className)}>
      {links.map((l) => (
        <li key={l.url}>
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-primary underline-offset-4 hover:underline">
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{l.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip content={copied ? "Copied" : label}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Could not copy to the clipboard");
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </Tooltip>
  );
}

/** Compact definition list used in adapter detail views. */
export function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function FileBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

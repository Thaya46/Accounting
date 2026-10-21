"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Lock, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { AccountOption, DuplicateWarning } from "@/lib/transactions/types";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { Avatar, Checkbox, Tooltip } from "@/components/ui/misc";
import { NativeSelect } from "@/components/ui/input";
import { Button, type ButtonProps } from "@/components/ui/button";
import { normalizeAmount, isValidAmount } from "./form-utils";

// ───────── Segmented control ─────────

export type SegmentOption<T extends string> = { value: T; label: string; icon?: LucideIcon; activeClass?: string };

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  size = "default",
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? cn("bg-card text-foreground shadow-sm", o.activeClass) : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="hidden h-4 w-4 shrink-0 min-[400px]:inline-block" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────── Account select ─────────

export function AccountSelect({
  id,
  groups,
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  className,
}: {
  id?: string;
  groups: { label: string; items: AccountOption[] }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} disabled={disabled} className={className}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.code})
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

// ───────── Disabled-with-reason button ─────────

/** A button that, when blocked, stays visible with a tooltip explaining why. */
export function GuardedButton({ blockedReason, wrapperClassName, children, ...props }: ButtonProps & { blockedReason?: string | null; wrapperClassName?: string }) {
  if (!blockedReason) return <Button {...props}>{children}</Button>;
  return (
    <Tooltip content={blockedReason}>
      <span tabIndex={0} className={cn("inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", wrapperClassName)} aria-label={blockedReason}>
        <Button {...props} disabled>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

// ───────── Entered-by stamp ─────────

export function EnteredByStamp({ name, userRef, className }: { name: string; userRef: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <Avatar name={name} className="h-7 w-7" />
      <div className="min-w-0 leading-tight">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden /> Entered by
        </p>
        <p className="truncate font-medium">
          {name} <span className="font-normal text-muted-foreground">· {userRef}</span>
        </p>
      </div>
    </div>
  );
}

// ───────── Duplicate detection ─────────

export type DuplicateProbe = { type: string; amount: string; date: string; description: string } | null;

/**
 * Debounced duplicate check against the workspace. `initial` lets the AI parse
 * result seed the list without an extra round trip. The acknowledgement resets
 * whenever the set of matches changes.
 */
export function useDuplicateCheck(workspaceId: string, probe: DuplicateProbe, opts: { excludeId?: string; initial?: DuplicateWarning[] } = {}) {
  const [duplicates, setDuplicates] = React.useState<DuplicateWarning[]>(opts.initial ?? []);
  const [checking, setChecking] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const key = probe ? `${probe.type}|${normalizeAmount(probe.amount)}|${probe.date}|${probe.description.trim().toLowerCase()}` : "";
  const skipKey = React.useRef<string | null>(opts.initial ? key : null);
  const probeRef = React.useRef(probe);
  probeRef.current = probe;
  const excludeId = opts.excludeId;

  React.useEffect(() => {
    const p = probeRef.current;
    if (!key || !p) {
      setDuplicates([]);
      setChecking(false);
      return;
    }
    if (skipKey.current === key) {
      skipKey.current = null;
      return;
    }
    skipKey.current = null;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await apiFetch<{ duplicates: DuplicateWarning[] }>(`/api/w/${workspaceId}/transactions/check-duplicates`, {
          body: { type: p.type, amount: normalizeAmount(p.amount), date: p.date, description: p.description.trim(), excludeId: excludeId ?? null },
          signal: ctrl.signal,
        });
        setDuplicates(r.duplicates);
      } catch {
        // Duplicate checks are advisory; a failed check never blocks entry.
      } finally {
        if (!ctrl.signal.aborted) setChecking(false);
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, workspaceId, excludeId]);

  const signature = duplicates.map((d) => d.ref).join(",");
  React.useEffect(() => setAck(false), [signature]);

  return { duplicates, checking, ack, setAck, needsAck: duplicates.length > 0 && !ack };
}

/** Builds the duplicate probe once the key fields are usable. */
export function duplicateProbe(type: string, amount: string, date: string, description: string): DuplicateProbe {
  if (!type || !date || !description.trim() || !isValidAmount(amount)) return null;
  return { type, amount, date, description };
}

export function DuplicatePanel({
  workspaceId,
  duplicates,
  ack,
  onAck,
  checking,
  currency,
  className,
}: {
  workspaceId: string;
  currency: string;
  duplicates: DuplicateWarning[];
  ack: boolean;
  onAck: (v: boolean) => void;
  checking?: boolean;
  className?: string;
}) {
  if (!duplicates.length) {
    return checking ? (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3 w-3 animate-spin" /> Checking for duplicates…
      </p>
    ) : null;
  }
  return (
    <Alert variant="warning" title={duplicates.length === 1 ? "Possible duplicate" : `${duplicates.length} possible duplicates`} className={className}>
      <p>This looks like an entry that already exists. Check before saving:</p>
      <ul className="mt-2 space-y-1.5">
        {duplicates.map((d) => (
          <li key={d.ref} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {d.visible && d.id ? (
              <Link href={`/w/${workspaceId}/transactions/${d.id}`} target="_blank" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                {d.ref} <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span className="font-medium">{d.ref}</span>
            )}
            <span className="text-muted-foreground">{formatDate(d.date)}</span>
            <span className="tabular">{formatMoney(d.amount, currency, { decimals: true })}</span>
            {d.description ? <span className="truncate">“{d.description}”</span> : <span className="italic text-muted-foreground">recorded by another member</span>}
            {d.enteredBy && <span className="text-muted-foreground">by {d.enteredBy}</span>}
            <StatusBadge status={d.status} />
          </li>
        ))}
      </ul>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground">
        <Checkbox checked={ack} onCheckedChange={(v) => onAck(v === true)} className="mt-0.5" aria-label="This is not a duplicate" />
        This is not a duplicate — save it anyway
      </label>
    </Alert>
  );
}

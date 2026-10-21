"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { PERMISSION_GROUPS } from "@/lib/workspace-admin/constants";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { FormField } from "@/components/ui/feedback";

/**
 * Wraps an API mutation: tracks pending state, shows a toast with the server's
 * message on failure, and refreshes server components on success.
 */
export function useMutation() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <T,>(url: string, init: { method: string; body?: unknown }, opts: { success?: string | ((data: T) => string | null) } = {}): Promise<T | null> => {
      setPending(true);
      try {
        const data = await apiFetch<T>(url, init);
        const msg = typeof opts.success === "function" ? opts.success(data) : opts.success;
        if (msg) toast.success(msg);
        router.refresh();
        return data;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
        return null;
      } finally {
        setPending(false);
      }
    },
    [router],
  );
  return { pending, run };
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
    </div>
  );
}

/** Confirmation dialog with an optional (or required) reason that is stored in the audit log. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  reason,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  reason?: "required" | "optional";
  children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<boolean | void>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setText("");
  }, [open]);
  const tooShort = reason === "required" && text.trim().length < 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) return;
    setBusy(true);
    try {
      const ok = await onConfirm(text.trim());
      if (ok !== false) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} className="space-y-4">
          {children}
          {reason && (
            <FormField
              label={reason === "required" ? "Reason" : "Reason (optional)"}
              htmlFor="confirm-reason"
              required={reason === "required"}
              hint="Recorded in the audit log."
            >
              <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} autoFocus />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} loading={busy} disabled={tooShort}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Grouped permission checkboxes. `included` are granted by the role (shown
 * checked and locked); `value` holds the extra, individually granted keys.
 * `grantable` (when given) limits what the current user may tick.
 */
export function PermissionPicker({
  value,
  onChange,
  included = [],
  grantable,
  disabled,
  idPrefix = "perm",
}: {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  included?: PermissionKey[];
  grantable?: PermissionKey[] | null;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const includedSet = new Set(included);
  const valueSet = new Set(value);
  const grantableSet = grantable ? new Set(grantable) : null;

  function toggle(key: PermissionKey, checked: boolean) {
    const next = new Set(valueSet);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  }

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.keys.map((key) => {
              const fromRole = includedSet.has(key);
              const locked = disabled || fromRole || (grantableSet !== null && !grantableSet.has(key) && !valueSet.has(key));
              const id = `${idPrefix}-${key}`;
              return (
                <label
                  key={key}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors",
                    fromRole ? "border-primary/30 bg-accent/50" : valueSet.has(key) ? "border-primary/50 bg-accent/30" : "hover:bg-muted/50",
                    locked && !fromRole && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={fromRole || valueSet.has(key)}
                    disabled={locked}
                    onCheckedChange={(c) => toggle(key, c === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {PERMISSIONS[key].label}
                      {fromRole && <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase text-primary">Role</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{PERMISSIONS[key].description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function SectionCount({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded-full bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground tabular">{children}</span>;
}

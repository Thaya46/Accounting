import * as React from "react";
import { UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

/** Amount coloured by direction: income green, expense red, others neutral. */
export function AmountText({
  amount,
  currency,
  type,
  className,
  decimals = true,
}: {
  amount: string;
  currency: string;
  type?: string;
  className?: string;
  decimals?: boolean;
}) {
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap font-medium",
        type === "INCOME" && "text-income",
        type === "EXPENSE" && "text-expense",
        className,
      )}
    >
      {formatMoney(amount, currency, { decimals })}
    </span>
  );
}

/** "Entered By" with the name snapshot; deactivated creators stay visible with a muted marker. */
export function EnteredBy({ name, disabled, className }: { name: string; disabled?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate">{name}</span>
      {disabled && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          title="This user's account has since been deactivated. Attribution is kept."
        >
          <UserX className="h-3 w-3" aria-hidden />
          deactivated
        </span>
      )}
    </span>
  );
}

export function confidenceTone(value: number) {
  if (value >= 0.85) return { bar: "bg-income", text: "text-income", label: "High" };
  if (value >= 0.6) return { bar: "bg-warning", text: "text-warning", label: "Medium" };
  return { bar: "bg-expense", text: "text-expense", label: "Low" };
}

/** Horizontal confidence meter (0–1). */
export function ConfidenceMeter({ value, className, compact }: { value: number; className?: string; compact?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = confidenceTone(value);
  return (
    <div className={cn("flex items-center gap-2", className)} title={`AI confidence ${pct}%`}>
      <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", compact ? "w-14" : "w-24")} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Confidence">
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone.bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("tabular text-xs font-medium", tone.text)}>
        {pct}%{!compact && <span className="ml-1 font-normal text-muted-foreground">{tone.label.toLowerCase()}</span>}
      </span>
    </div>
  );
}

/** Small per-field confidence dot. */
export function ConfidenceDot({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const tone = value <= 0 ? { bar: "bg-muted-foreground/40" } : confidenceTone(value);
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", tone.bar, className)}
      title={value <= 0 ? "Not detected" : `Confidence ${pct}%`}
      aria-label={value <= 0 ? "Not detected" : `Confidence ${pct}%`}
    />
  );
}

/** Key/value row used in metadata grids. */
export function MetaItem({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

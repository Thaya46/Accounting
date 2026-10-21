import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AsOf, Period } from "@/lib/dashboard/periods";

type Keep = Record<string, string | null | undefined>;

function href(basePath: string, params: Keep) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const q = sp.toString();
  return q ? `${basePath}?${q}` : basePath;
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

function HiddenKeep({ keep }: { keep: Keep }) {
  return (
    <>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
    </>
  );
}

/**
 * Period filter row driven entirely by URL params (works without JavaScript):
 * preset chips plus a custom from/to form.
 */
export function PeriodControls({
  basePath,
  current,
  presets,
  keep = {},
  className,
}: {
  basePath: string;
  current: Period;
  presets: Record<string, Period>;
  keep?: Keep;
  className?: string;
}) {
  const order = ["fy", "prev-fy", "this-month", "last-month"];
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between print:hidden", className)}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period presets">
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
        {order.map((key) => {
          const p = presets[key];
          if (!p) return null;
          return (
            <Chip key={key} to={href(basePath, { ...keep, period: key })} active={current.preset === key}>
              {p.label}
            </Chip>
          );
        })}
      </div>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <HiddenKeep keep={keep} />
        <input type="hidden" name="period" value="custom" />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input type="date" name="from" defaultValue={current.from} required className="h-8 w-[150px] text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input type="date" name="to" defaultValue={current.to} required className="h-8 w-[150px] text-foreground" />
        </label>
        <Button type="submit" size="sm" variant={current.preset === "custom" ? "default" : "outline"}>
          Apply
        </Button>
      </form>
    </div>
  );
}

/** As-of date selector for point-in-time statements. */
export function AsOfControls({
  basePath,
  current,
  presets,
  keep = {},
  className,
}: {
  basePath: string;
  current: AsOf;
  presets: Record<string, AsOf>;
  keep?: Keep;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between print:hidden", className)}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="As-of presets">
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
        {Object.entries(presets).map(([key, p]) => (
          <Chip key={key} to={href(basePath, { ...keep, asOf: p.asOf })} active={current.preset === key}>
            {p.label}
          </Chip>
        ))}
      </div>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <HiddenKeep keep={keep} />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          As of
          <Input type="date" name="asOf" defaultValue={current.asOf} required className="h-8 w-[160px] text-foreground" />
        </label>
        <Button type="submit" size="sm" variant={current.preset === "custom" ? "default" : "outline"}>
          Apply
        </Button>
      </form>
    </div>
  );
}

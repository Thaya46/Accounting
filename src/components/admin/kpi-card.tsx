import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-accent text-primary ring-primary/15",
  success: "bg-income-soft text-income ring-income/20",
  warning: "bg-warning-soft text-warning ring-warning/20",
  info: "bg-info-soft text-info ring-info/20",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  href,
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const body = (
    <Card className={cn("group relative h-full overflow-hidden p-5 transition-all duration-200", href && "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover")}>
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-500/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular sm:text-3xl">
            {typeof value === "number" ? value.toLocaleString("en-US") : value}
          </p>
        </div>
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TONES[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {hint && <div className="relative mt-3 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

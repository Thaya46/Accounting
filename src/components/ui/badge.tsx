import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-current/15", {
  variants: {
    variant: {
      default: "bg-accent text-accent-foreground",
      secondary: "bg-secondary text-secondary-foreground",
      outline: "text-foreground ring-border",
      success: "bg-income-soft text-income",
      danger: "bg-expense-soft text-expense",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
      muted: "bg-muted text-muted-foreground ring-border",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const STATUS: Record<string, { label: string; variant: VariantProps<typeof badgeVariants>["variant"] }> = {
  DRAFT: { label: "Draft", variant: "muted" },
  PENDING_APPROVAL: { label: "Pending approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "info" },
  POSTED: { label: "Posted", variant: "success" },
  REVERSED: { label: "Reversed", variant: "secondary" },
  REJECTED: { label: "Rejected", variant: "danger" },
  ACTIVE: { label: "Active", variant: "success" },
  SUSPENDED: { label: "Suspended", variant: "warning" },
  ARCHIVED: { label: "Archived", variant: "muted" },
  INVITED: { label: "Invited", variant: "info" },
  PENDING: { label: "Pending", variant: "warning" },
  DISABLED: { label: "Disabled", variant: "danger" },
  ACCEPTED: { label: "Accepted", variant: "success" },
  REVOKED: { label: "Revoked", variant: "muted" },
  EXPIRED: { label: "Expired", variant: "muted" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "danger" },
  PREVIEW: { label: "Preview", variant: "info" },
  SENT: { label: "Sent", variant: "success" },
  DEV_LOGGED: { label: "Outbox (not sent)", variant: "warning" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, variant: "secondary" as const };
  return (
    <Badge variant={s.variant} className={className}>
      {s.label}
    </Badge>
  );
}

const TYPE: Record<string, { label: string; variant: VariantProps<typeof badgeVariants>["variant"] }> = {
  INCOME: { label: "Income", variant: "success" },
  EXPENSE: { label: "Expense", variant: "danger" },
  TRANSFER: { label: "Transfer", variant: "info" },
  JOURNAL: { label: "Journal", variant: "secondary" },
};

export function TypeBadge({ type, className }: { type: string; className?: string }) {
  const t = TYPE[type] ?? { label: type, variant: "secondary" as const };
  return (
    <Badge variant={t.variant} className={className}>
      {t.label}
    </Badge>
  );
}

const SOURCE: Record<string, string> = { VOICE: "Voice", TEXT: "Text", MANUAL: "Manual", IMPORT: "Import" };
export function SourceBadge({ source }: { source: string }) {
  return <Badge variant="outline">{SOURCE[source] ?? source}</Badge>;
}

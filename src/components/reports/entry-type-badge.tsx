import { Badge } from "@/components/ui/badge";

const ENTRY_TYPE = {
  STANDARD: { label: "Standard", variant: "muted" },
  OPENING: { label: "Opening", variant: "info" },
  ADJUSTMENT: { label: "Adjustment", variant: "warning" },
  REVERSAL: { label: "Reversal", variant: "danger" },
} as const;

export function EntryTypeBadge({ type, className }: { type: string; className?: string }) {
  const t = ENTRY_TYPE[type as keyof typeof ENTRY_TYPE] ?? { label: type, variant: "secondary" as const };
  return (
    <Badge variant={t.variant} className={className}>
      {t.label}
    </Badge>
  );
}

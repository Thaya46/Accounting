import { Badge } from "@/components/ui/badge";

/** Monospace badge for audit action codes, tinted by the kind of event. */
export function ActionBadge({ action }: { action: string }) {
  const variant = /FAILED|REVOKED|DISABLED|SUSPEND|ARCHIV|REJECT|LOCK/.test(action)
    ? "warning"
    : /CREATED|ACCEPTED|ENABLED|POSTED|ACTIVATED/.test(action)
      ? "success"
      : /LOGIN|MFA|SESSION|PASSWORD/.test(action)
        ? "info"
        : "secondary";
  return (
    <Badge variant={variant} className="max-w-full truncate rounded-md font-mono text-[11px]">
      {action}
    </Badge>
  );
}

import { CalendarRange } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { greetingFor } from "@/lib/dashboard/format";

export function DashboardGreeting({
  name,
  workspaceName,
  roleName,
  fyLabel,
  fyRange,
  timeZone,
  scopeLabel,
}: {
  name: string;
  workspaceName: string;
  roleName: string;
  fyLabel: string;
  fyRange: string;
  timeZone: string;
  scopeLabel: string;
}) {
  const first = name.trim().split(/\s+/)[0] || name;
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {greetingFor(timeZone)}, {first}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {workspaceName} · {roleName} · {scopeLabel}
        </p>
      </div>
      <Badge variant="outline" className="h-8 gap-1.5 self-start rounded-md px-2.5 text-sm font-medium sm:self-auto" title={fyRange}>
        <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
        {fyLabel}
        <span className="hidden font-normal text-muted-foreground md:inline">· {fyRange}</span>
      </Badge>
    </div>
  );
}

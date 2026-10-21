import { Card } from "@/components/ui/card";
import { Skeleton, TableSkeleton } from "@/components/ui/feedback";

/** Loading state for workspace administration pages (header + toolbar + table). */
export function AdminPageSkeleton({ tabs = false, cols = 5 }: { tabs?: boolean; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {tabs && <Skeleton className="mb-4 h-9 w-full max-w-sm" />}
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:justify-between">
          <Skeleton className="h-9 w-full sm:w-72" />
          <Skeleton className="h-9 w-40" />
        </div>
        <TableSkeleton rows={8} cols={cols} />
      </Card>
    </div>
  );
}

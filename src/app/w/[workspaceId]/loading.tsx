import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, TableSkeleton } from "@/components/ui/feedback";

/** Generic skeleton for workspace pages while their server data loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-6 w-32" />
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="p-0">
          <TableSkeleton rows={8} cols={5} />
        </CardContent>
      </Card>
    </div>
  );
}

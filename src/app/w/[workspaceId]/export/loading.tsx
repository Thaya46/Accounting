import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="space-y-2 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
        </Card>
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </Card>
      </div>
    </div>
  );
}

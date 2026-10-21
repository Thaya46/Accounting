import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="space-y-3 p-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </Card>
        <Card className="space-y-4 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}

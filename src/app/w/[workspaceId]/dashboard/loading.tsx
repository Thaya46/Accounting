import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, TableSkeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-start justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="mt-3 h-7 w-36" />
              <Skeleton className="mt-3 h-3 w-40" />
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </CardHeader>
            <CardContent>
              <div className="flex h-[280px] items-end gap-2 sm:gap-3">
                {[40, 62, 48, 75, 55, 68, 82, 58, 70, 64, 88, 72].map((h, i) => (
                  <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-44" />
          </CardHeader>
          <TableSkeleton rows={6} cols={6} />
        </Card>
      </div>
    </div>
  );
}

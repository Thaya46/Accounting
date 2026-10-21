import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, TableSkeleton } from "@/components/ui/feedback";

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>
    </div>
  );
}

export function TransactionListSkeleton() {
  return (
    <>
      <HeaderSkeleton actions={2} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[66px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="mb-4 h-[60px] rounded-xl" />
      <Card>
        <TableSkeleton rows={10} cols={6} />
      </Card>
    </>
  );
}

export function TransactionFormSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-6 w-56" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9" />
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    </>
  );
}

export function TransactionDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="mb-6 flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function AiEntrySkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-5 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-9" />
            <Skeleton className="h-28" />
            <Skeleton className="ml-auto h-9 w-28" />
          </CardContent>
        </Card>
        <Skeleton className="h-80 rounded-xl lg:col-span-3" />
      </div>
    </>
  );
}

export function ApprovalsSkeleton() {
  return (
    <>
      <HeaderSkeleton actions={0} />
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, c) => (
          <Card key={c}>
            <CardHeader>
              <Skeleton className="h-5 w-56" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                  </div>
                  <Skeleton className="h-6 w-28" />
                  <Skeleton className="h-8 w-56" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

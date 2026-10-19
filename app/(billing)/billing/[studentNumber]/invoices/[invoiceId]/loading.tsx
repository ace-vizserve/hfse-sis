import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/components/ui/page-shell';

/** Mirrors the invoice page — back link, hero with its actions, four stat
 *  tiles, the Invoice / PDF view tabs, the invoice with Invoice activity
 *  beside it. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-11 w-80" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-56" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[560px] rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </PageShell>
  );
}

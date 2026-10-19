import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable } from '@/components/ui/skeleton-layouts';

/** Mirrors `[studentNumber]/page.tsx` — back link, hero with its actions and
 *  related-module links, four stat tiles, the tabs, the transaction list. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-11 w-80 max-w-full" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-9 w-72" />
      <SkeletonTable columns={8} rows={8} />
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable } from '@/components/ui/skeleton-layouts';

/** Mirrors `[studentNumber]/page.tsx` — top bar, customer card + Summary,
 *  tabs, the three filters, the transaction list. */
export default function Loading() {
  return (
    <PageShell>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-9 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-9 w-80" />
      <div className="flex gap-3">
        <Skeleton className="h-14 w-44" />
        <Skeleton className="h-14 w-36" />
        <Skeleton className="h-14 w-40" />
      </div>
      <SkeletonTable columns={8} rows={8} />
    </PageShell>
  );
}

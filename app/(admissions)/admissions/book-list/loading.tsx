import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/book-list/page.tsx` — change this file
 * when it changes. Hero with the year switcher, the level picker row, then
 * the level's list as a DataTable.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="micro" className="w-40" />
          <SkeletonText variant="stat" className="w-56 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full md:w-48" />
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full sm:w-[220px]" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-5 w-56 sm:ml-auto" />
      </div>

      <SkeletonTable columns={7} rows={12} pagination />
    </PageShell>
  );
}

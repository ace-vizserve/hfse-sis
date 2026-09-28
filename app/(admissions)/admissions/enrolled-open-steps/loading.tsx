import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/enrolled-open-steps/page.tsx` and
 * `components/admissions/enrolled-open-steps-queue.tsx` — change this file
 * when either changes. Seven columns (student, enrolee #, level, class, steps
 * still open, enrolled, row action) under a six-tab status strip.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <SkeletonText variant="micro" className="w-40" />
          <SkeletonText variant="stat" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full md:w-48" />
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ml-auto h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-10 w-lg max-w-full rounded-md" />
        <SkeletonTable columns={7} rows={10} toolbar={false} />
      </div>
    </PageShell>
  );
}

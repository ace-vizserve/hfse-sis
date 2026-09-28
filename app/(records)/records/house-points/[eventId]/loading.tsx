import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/house-points/[eventId]/page.tsx` — change
 * this file when that page changes.
 *
 * Back link, then the header (eyebrow, event name, one line of description,
 * Edit event + Add students on the right), then the score sheet: four house
 * stat cards, the rubric panel, a row of group tabs, the table, and the trust
 * strip.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-64" />
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </header>

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="@container/main">
            <SkeletonCards
              count={4}
              grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
            />
          </div>
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-80 max-w-full" />
          <SkeletonTable columns={7} rows={10} toolbar={false} />
        </div>
      </div>
      <SkeletonText variant="micro" className="mt-2 w-40" />
    </PageShell>
  );
}

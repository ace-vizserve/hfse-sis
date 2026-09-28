import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/house-points/page.tsx` — change this file
 * when that page changes.
 *
 * Back link, then the header with the year switcher on the right, then the
 * four house stat cards (each with a footer), then `EventsTable`: its search +
 * Type facet toolbar, a seven-column table (event, type, participants, four
 * houses), the year-totals card and the trust strip.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-64" />
          <SkeletonText variant="headline" className="w-72 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        <SkeletonTable columns={7} rows={8} toolbar={false} />
        <Skeleton className="h-20 w-full rounded-xl" />
        <SkeletonText variant="micro" className="mt-2 w-40" />
      </div>
    </PageShell>
  );
}

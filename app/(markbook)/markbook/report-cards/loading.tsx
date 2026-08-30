import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Navigation-time loader for /markbook/report-cards.
 *
 * This covers a DIFFERENT wait from the page's Suspense fallbacks, which is
 * why both exist. This one shows while the page's own gate reads run — the
 * session, the current academic year, its sections and terms — because until
 * those land there is no header to draw. The Suspense fallbacks inside the
 * page then cover the publication reads, with the real header already painted
 * above them.
 *
 * Rebuilt on the shared archetypes (the plan's rule: migrate a `loading.tsx`
 * when you are already working in its route, never in bulk). The hand-drawn
 * version it replaced put a `h-14` bar where a ~168px stat card goes and drew
 * no card chrome at all, so the page jumped twice on every visit.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-[128px]" />
        <SkeletonText variant="headline" className="w-[280px]" />
        <SkeletonText variant="body" className="w-[26rem] max-w-full" />
      </header>

      {/* Section picker + bulk-publish dialog live in the header row. */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="ml-auto h-9 w-40" />
      </div>

      {/* The landing view is the one a navigation lands on: four KPI cards
          over the cross-section publications table. Grid classes mirror
          KPI_GRID_CLASS in page.tsx. */}
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
        />
      </div>

      <SkeletonTable columns={7} rows={10} pagination />
    </PageShell>
  );
}

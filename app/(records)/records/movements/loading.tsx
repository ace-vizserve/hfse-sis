import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/movements/page.tsx` — change this file when
 * that page changes.
 *
 * Corrections against the real page: there is a "Dashboard" back link above
 * the header, and the KPI strip is FOUR full stat cards (transfers,
 * withdrawals, late enrolments, re-enrolments), each with a required
 * `CardFooter` — not the three short `h-20 w-36` tiles the hand-drawn version
 * placed. Grid classes are the page's own container-query ones, passed via
 * `grid` so they replace the archetype defaults instead of stacking with them.
 *
 * The table is `MovementsTable`: nine visible columns (student, year, term,
 * kind, reason, level, change, date, recorded by), a status-tab strip of five
 * kinds, and an "Include prior years" switch leading the toolbar.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-56" />
        <SkeletonText variant="headline" className="w-80 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>

      {/* MovementsTable — the switch + search + facets toolbar, then the
          status tabs, then the table. Drawn by hand in that order because the
          tab strip sits between SkeletonTable's toolbar and its shell. */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="ml-auto h-8 w-28" />
          </div>
          <Skeleton className="h-10 w-96 max-w-full rounded-md" />
          {/* No `pagination`: the bar renders only when the filtered set is
              non-empty, and an academic year with no transfers or withdrawals
              recorded yet is an ordinary state for this page. */}
          <SkeletonTable columns={9} rows={10} toolbar={false} />
        </div>
        <SkeletonText variant="micro" className="mt-2 w-48" />
      </div>
    </PageShell>
  );
}

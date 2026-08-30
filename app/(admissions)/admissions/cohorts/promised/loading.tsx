import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/cohorts/promised/page.tsx` (and the
 * chrome it renders through, `components/sis/cohorts/cohort-page-shell.tsx`)
 * — change this file when either changes.
 *
 * Same shell as the other two cohorts. `CohortTable` with `kind="promised"`
 * has EIGHT visible columns (student, level, app status, to-follow count,
 * promised slots, earliest date, days until, row actions), two facets and a
 * six-tab status strip. Its `selection` block adds no checkbox column — the
 * bulk-reminder action is reached from the row menu — so the column count is
 * the builder's own list.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <SkeletonText variant="micro" className="w-52" />
          <div className="flex items-baseline gap-3">
            {/* `font-serif text-2xl` — a 32px line box, the `stat` voice. */}
            <SkeletonText variant="stat" className="w-64 max-w-full" />
            <Skeleton className="h-6 w-24" />
          </div>
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </header>

      {/* CohortTable — toolbar (h-8 controls), status-tab strip, then the
          table. Drawn in that order because the tabs sit between the two. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-10 w-lg max-w-full rounded-md" />
        {/* No `pagination`: the bar renders only when the filtered set is
            non-empty, and a cohort of applicants still owing a promised
            document can legitimately come back with no rows. */}
        <SkeletonTable columns={8} rows={10} toolbar={false} />
      </div>
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/cohorts/stp/page.tsx` (and the chrome it
 * renders through, `components/sis/cohorts/cohort-page-shell.tsx`) — change
 * this file when either changes.
 *
 * Shape taken from the real page: the cohort shell's header is a `sm:flex-row`
 * split with the eyebrow / serif title + count badge / description on the
 * left and a single "Download CSV" button on the right — NOT the two-badge
 * AY-switcher block the previous hand-drawn loader assumed. Below it, one
 * `CohortTable` — a `DataTable` with search + facets, a status-tab strip, and
 * eight visible columns for this cohort (student, level, STP type, ICA
 * status, residence, STP complete, app status, row actions).
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <SkeletonText variant="micro" className="w-52" />
          <div className="flex items-baseline gap-3">
            {/* The cohort title is `font-serif text-2xl`, whose line box is
                32px — the `stat` voice — not the 38px page headline the other
                Records pages use. */}
            <SkeletonText variant="stat" className="w-64 max-w-full" />
            <Skeleton className="h-6 w-24" />
          </div>
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </header>

      {/* CohortTable. `DataTable`'s own wrapper is `flex flex-col gap-3`, and
          its toolbar controls are h-8, so the toolbar is drawn here rather
          than taken from SkeletonTable — the status-tab strip has to sit
          between the toolbar and the table, and TabsList is p-1 around h-8
          triggers (40px). */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        <Skeleton className="h-10 w-96 max-w-full rounded-md" />
        {/* No `pagination`: the bar renders only when the filtered set is
            non-empty, and this cohort is a narrow slice of the roster that can
            legitimately come back with no rows. */}
        <SkeletonTable columns={8} rows={10} toolbar={false} />
      </div>
    </PageShell>
  );
}

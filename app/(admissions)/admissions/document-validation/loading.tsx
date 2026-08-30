import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/document-validation/page.tsx` and the
 * `ValidationQueue` it renders — change this file when either changes.
 *
 * The old hand-drawn version put the view toggle in a right-aligned row of
 * its own ABOVE the table; it is really `toolbarTrailing`, so it sits inside
 * the DataTable toolbar. It also drew a bordered card wrapper the queue does
 * not have, and no trust strip for the one the page ends with.
 *
 * FOUR visible columns, not the six defined: `initialColumnVisibility` hides
 * `levelApplied` and `applicationStatus` (both render in the group header
 * instead and stay filterable via their facets), leaving document, owner,
 * preview and the Approve/Reject actions. A read-only viewer sees three — the
 * actions column is spread in only when they may validate — but everyone who
 * can reach this page after migration 106 can act, so four is the case worth
 * drawing.
 *
 * No `pagination`: the bar renders only when the filtered set is non-empty,
 * and an empty queue is the good day here — the page says so in its own
 * description.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-2">
        <SkeletonText variant="micro" className="w-56" />
        {/* `font-serif text-3xl md:text-4xl` — a 36–40px line box, so the
            38px `headline` voice is the closest of the seven. */}
        <SkeletonText variant="headline" className="w-80 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      {/* ValidationQueue wraps the table in `space-y-4`; DataTable's own
          wrapper is `flex flex-col gap-3`. Toolbar controls are h-8: search,
          the "Expirable only" toggle, four facet dropdowns, then the
          view-mode toggle and Columns on the right. The four-tab status strip
          (All / Submitted / Ongoing / Processing) sits between the toolbar
          and the table, which is why the toolbar is drawn here instead of
          being taken from SkeletonTable. */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="ml-auto h-8 w-40" />
            <Skeleton className="h-8 w-24" />
          </div>
          <Skeleton className="h-10 w-80 max-w-full rounded-md" />
          {/* Rows are grouped by applicant, so the real body interleaves
              group-header rows with document rows. The archetype draws even
              rows; the row HEIGHT is the primitive's either way, which is
              what stops the shift. */}
          <SkeletonTable columns={4} rows={10} toolbar={false} />
        </div>
      </div>

      {/* Trust strip — AY code · scope · status, above a top border. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-96 max-w-full" />
      </div>
    </PageShell>
  );
}

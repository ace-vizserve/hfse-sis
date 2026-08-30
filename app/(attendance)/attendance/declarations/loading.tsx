import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/declarations/page.tsx` — change this
 * file when that page changes.
 *
 * Shape taken from the real page: the header (eyebrow / serif title / lede,
 * nothing on the right), then `DeclarationsQueueTable` — a `DataTable` whose
 * toolbar is followed by a THREE-tab strip (Yours to decide / Everything
 * waiting / Decided) before the table shell.
 *
 * The toolbar is drawn here rather than by the archetype, and
 * `SkeletonTable toolbar={false}` turns the archetype's own off: `DataTable`
 * renders the status tabs BETWEEN the toolbar and the table, and the archetype
 * has no seam to put them in.
 *
 * Eight visible columns: Child / Class / Reason / Days away / Waiting on /
 * Yours? / Filed / the Read-and-decide button. Nothing is hidden by default —
 * the table declares no `initialColumnVisibility`.
 *
 * No `pagination`, and this one IS data-dependent: `DataTable` draws the bar
 * only when there is at least one row, and an empty queue — every filing
 * decided — is the normal resting state of this page, not an edge case.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[104px]" />
          <SkeletonText variant="headline" className="w-[230px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
      </header>

      {/* Search, the Class and Step facets, then Export CSV + Columns. */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-[260px]" />
        <Skeleton className="h-8 w-[110px]" />
        <Skeleton className="h-8 w-[100px]" />
        <Skeleton className="ml-auto h-8 w-[120px]" />
        <Skeleton className="h-8 w-[104px]" />
      </div>

      {/* The three status tabs. */}
      <Skeleton className="h-9 w-[420px] max-w-full rounded-lg" />

      <SkeletonTable toolbar={false} columns={8} rows={8} />
    </PageShell>
  );
}

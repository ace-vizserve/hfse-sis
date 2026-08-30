import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/unsynced/page.tsx` — change this file when
 * that page changes.
 *
 * Two corrections against the real page. It has no "Resync" action row above
 * the queue, and the queue is NOT wrapped in a bordered card: the page renders
 * `<UnsyncedStudentsQueue>` — a bare `DataTable` — directly under the header,
 * so the old `rounded-xl border border-hairline bg-card p-4` box drew a shell
 * that never arrives. Below the queue sits a trust strip on a top border.
 *
 * Seven visible columns: name, student number, level, year, status, why
 * they're stuck, and the "Assign section" row action.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-2">
        <SkeletonText variant="micro" className="w-48" />
        {/* `font-serif text-3xl md:text-4xl` — the closest voice is the page
            headline; it runs a few px tall on small screens only. */}
        <SkeletonText variant="headline" className="w-80 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      {/* DataTable wrapper is `flex flex-col gap-3`: toolbar, status tabs,
          then the table shell. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        <Skeleton className="h-10 w-72 max-w-full rounded-md" />
        {/* No `pagination`: the happy path for this queue is EMPTY — every
            enrolled student already has a class — and the bar only renders
            when there is at least one row. */}
        <SkeletonTable columns={7} rows={8} toolbar={false} />
      </div>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-72" />
      </div>
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/cohorts/pass-expiry/page.tsx` (and the chrome
 * it renders through, `components/sis/cohorts/cohort-page-shell.tsx`) — change
 * this file when either changes.
 *
 * Same shell as the other two cohorts, but its own column count: eight visible
 * columns (student, level, expiry kind, expiry date, days until, parent
 * expiries, app status, row actions).
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
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        <Skeleton className="h-10 w-96 max-w-full rounded-md" />
        {/* No `pagination`: this cohort opens on the "Within 30 days" tab, so
            the filtered set is frequently empty and the bar would not render. */}
        <SkeletonTable columns={8} rows={10} toolbar={false} />
      </div>
    </PageShell>
  );
}

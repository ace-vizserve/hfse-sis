import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/page.tsx` — change this file when that
 * page changes.
 *
 * Shape taken from the oversight branch of the page, in its order:
 * `DashboardHero` (one AY badge + a "Mark attendance" button on the right),
 * the `PriorityPanel` card, the `ComparisonToolbar` strip, four `MetricCard`s
 * on `xl:grid-cols-4`, the `InsightsPanel` card, the daily-trend chart card,
 * then the deferred drill block and the trust strip.
 *
 * The KPI grid is passed via `grid`, not `className`: the page breaks at `xl:`
 * only, and merging would leave the archetype's `sm:grid-cols-2` /
 * `lg:grid-cols-4` applying as well. `MetricCard` always renders a
 * `CardFooter` (delta chip + sparkline), so `footer` stays at its default.
 *
 * The drill block below deliberately repeats the page's OWN Suspense fallback
 * verbatim, so the handover from this route loader to that fallback is not
 * itself a layout jump.
 *
 * Deliberately omitted, because the loader cannot know the role or the data:
 * the teacher branch (an `AdviserAttendanceDashboard`, a different page), the
 * declarations-waiting panel (renders nothing at zero), the two recommendation
 * callouts and the active-term-fallback notice.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* DashboardHero — eyebrow / serif title / lede, badge + action right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[168px]" />
          <SkeletonText variant="headline" className="w-[340px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-8 w-[150px]" />
        </div>
      </header>

      {/* PriorityPanel — header with the gradient tile, then the actionable
          list. A real Card so the padding comes from the same component. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-[132px]" />
              <SkeletonText variant="title" className="w-[240px] max-w-full" />
            </div>
            <div
              aria-hidden
              className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>

      {/* ComparisonToolbar — one bordered row of h-10 controls. */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* Range-aware KPIs. */}
      <SkeletonCards count={4} grid="grid gap-4 xl:grid-cols-4" />

      {/* InsightsPanel — narrative commentary under the KPIs. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-[110px]" />
              <SkeletonText variant="title" className="w-[200px] max-w-full" />
            </div>
            <div
              aria-hidden
              className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>

      {/* Daily attendance % trend. Conditional on more than one day of data in
          the range, which a live term always has. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-[124px]" />
          <SkeletonText variant="title" className="w-[220px] max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-56 w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Everything the full-scan drill query feeds. Copied from the page's own
          Suspense fallback so the two placeholders are the same shape. */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </section>
      <Skeleton className="h-64 w-full rounded-xl" />
      <section className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </section>
      <Skeleton className="h-64 w-full rounded-xl" />

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-[290px]" />
      </div>
    </PageShell>
  );
}

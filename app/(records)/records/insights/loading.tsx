import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/insights/page.tsx` — change this file when
 * that page changes.
 *
 * Shape taken from the real page: a "Back to Records" link, `DashboardHero`
 * with THREE badges (year, current/historical, growth), a right-aligned
 * compare-year picker, then three named sections — Population & growth,
 * Retention, Attrition — the last two separated by `border-t border-hairline
 * pt-7`, which the hand-drawn version had as three unlabelled blocks.
 *
 * The KPI row is three `MetricCard`s on `sm:grid-cols-2 lg:grid-cols-3`,
 * passed via `grid` so it replaces the archetype's four-up default outright;
 * `MetricCard` always renders a `CardFooter`, so `footer` stays true.
 *
 * Chart panels below the KPIs are `InsightChartCard`s (cap, serif title,
 * scope-note chip, gradient icon tile, then a 260–300px chart). Several are
 * comparison-only and appear when a compare year is picked, so only the rows
 * that always render are drawn.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-36" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-40" />
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>
      </header>

      <div className="flex justify-end">
        <Skeleton className="h-9 w-56" />
      </div>

      {/* ═══ Population & growth ═══ */}
      <div className="space-y-5 pt-2">
        <SkeletonText variant="eyebrow" className="w-44" />
        <SkeletonCards
          count={3}
          grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCardSkeleton />
          <ChartCardSkeleton />
        </div>
        <ChartCardSkeleton />
      </div>

      {/* ═══ Retention ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-24" />
        <ChartCardSkeleton />
      </div>

      {/* ═══ Attrition ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-24" />
        <SkeletonText variant="label" className="-mt-3 w-96 max-w-full" />
        <ChartCardSkeleton />
      </div>
    </PageShell>
  );
}

/** One `InsightChartCard` with its chart taken out. */
function ChartCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText variant="micro" className="w-40" />
            <SkeletonText variant="title" className="w-64 max-w-full" />
            <Skeleton className="h-6 w-52 rounded-full" />
          </div>
          <div
            aria-hidden
            className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-72 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/insights/page.tsx` — change this file
 * when that page changes.
 *
 * Shape taken from the real page, in its order: the back link, `DashboardHero`
 * (three badges right), the right-aligned `CompareAyPicker`, then three banded
 * sections — Attendance health (four `MetricCard`s on `sm:grid-cols-2
 * lg:grid-cols-4`, a `lg:grid-cols-2` chart pair, one full-width chart),
 * Absence watchlist and Leave quotas (each a `border-t border-hairline pt-7`
 * band over a `lg:grid-cols-2` pair) — and the trust strip.
 *
 * The KPI grid is passed via `grid`, not `className`: it happens to match the
 * archetype default, but passing it through `className` would still leave both
 * rulesets applying if either side ever changed. `MetricCard` always renders a
 * `CardFooter`, so `footer` stays at its default.
 *
 * The two lower bands render one card per term with absences, so the count
 * below is the typical case rather than a fixed fact. They are drawn as
 * `InsightChartCard`s — a real `Card` with a header and a chart body.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* Back to Attendance. */}
      <SkeletonText variant="body" className="w-[150px]" />

      {/* DashboardHero — eyebrow / serif title / lede, three badges right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[160px]" />
          <SkeletonText variant="headline" className="w-[300px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[80px]" />
          <Skeleton className="h-7 w-[104px]" />
        </div>
      </header>

      <div className="flex justify-end">
        <Skeleton className="h-9 w-[200px]" />
      </div>

      {/* ═══ Attendance health ═══ */}
      <div className="space-y-5 pt-2">
        <SkeletonText variant="eyebrow" className="w-[140px]" />

        <SkeletonCards
          count={4}
          grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <InsightChartCardSkeleton key={i} />
          ))}
        </div>

        <InsightChartCardSkeleton />
      </div>

      {/* ═══ Absence watchlist ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-[150px]" />
        <SkeletonText variant="label" className="-mt-3 w-[30rem] max-w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <InsightChartCardSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* ═══ Leave quotas ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-[120px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <InsightChartCardSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-[290px]" />
      </div>
    </PageShell>
  );
}

/**
 * One `InsightChartCard` with the chart taken out — a `CardDescription` cap, a
 * serif `text-xl` title, the gradient tile in `CardAction`, then the body.
 */
function InsightChartCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText variant="micro" className="w-[112px]" />
            <SkeletonText variant="title" className="w-[190px] max-w-full" />
          </div>
          <div
            aria-hidden
            className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-56 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Loading state for Admissions · Insights (Enrollment Health).
 *
 * Mirrors `app/(admissions)/admissions/insights/page.tsx` — change it with
 * the page. The page is three named zones, each a band label over rows of
 * `InsightChartCard`s; the second and third zones are separated by a
 * `border-t border-hairline pt-7` rule, which is drawn here because it is
 * unconditional and carries real vertical space.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* "Back to Admissions" link. */}
      <SkeletonText variant="body" className="w-[160px]" />

      {/* DashboardHero — three badges here (AY, Current/Historical, growth). */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[180px]" />
          <SkeletonText variant="headline" className="w-[300px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[90px]" />
          <Skeleton className="h-7 w-[104px]" />
        </div>
      </header>

      {/* CompareAyPicker, right-aligned. */}
      <div className="flex justify-end">
        <Skeleton className="h-9 w-[220px]" />
      </div>

      {/* ─── Demand & conversion ─── */}
      <div className="space-y-5 pt-2">
        <SkeletonText variant="eyebrow" className="w-[168px]" />

        {/* Three MetricCards (the third — avg. days to enrol — is suppressed
            on a zero-sample cohort). MetricCard always renders a CardFooter,
            so the archetype's `footer` default is correct. */}
        <SkeletonCards
          count={3}
          grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard />
          <ChartCard />
        </div>
      </div>

      {/* ─── Who & why we lose ─── */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-[152px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard />
          <ChartCard />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard />
          <ChartCard />
        </div>
      </div>

      {/* ─── Channels & segments ─── */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-[176px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard />
          <ChartCard />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard />
          <ChartCard />
        </div>
      </div>
    </PageShell>
  );
}

/** The page's own `InsightChartCard`: mono cap, serif title, chart below. */
function ChartCard() {
  return (
    <Card>
      <CardHeader>
        <SkeletonText variant="micro" className="w-[130px]" />
        <SkeletonText variant="title" className="w-[200px]" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

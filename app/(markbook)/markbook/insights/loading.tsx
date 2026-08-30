import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/insights/page.tsx` — change them together.
 *
 * Numbers taken from the page: a back link, a DashboardHero carrying THREE
 * badges (AY, Current/Historical, growth), a right-aligned CompareAyPicker,
 * then two labelled bands. "Academic performance" is a stack of full-width
 * `InsightChartCard`s — between one and four render depending on how much
 * grade history exists, and three is drawn here as the middle case. "Grading
 * throughput" opens with three `MetricCard`s in
 * `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` (MetricCard always renders a
 * CardFooter, so `footer` stays default-true) over one more chart card.
 */
function ChartCardSkeleton({ chart }: { chart: string }) {
  return (
    <Card>
      <CardHeader>
        <SkeletonText variant="micro" className="w-[180px] max-w-full" />
        <SkeletonText variant="title" className="w-[340px] max-w-full" />
        <CardAction>
          {/* InsightChartCard's gradient tile — its size and place are known
              before the data is, so it stays solid rather than a grey square. */}
          <div
            aria-hidden
            className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Skeleton className={chart} />
      </CardContent>
    </Card>
  );
}

export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[136px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[160px]" />
          <SkeletonText variant="headline" className="w-[340px] max-w-full" />
          <SkeletonText variant="body" className="w-[30rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[110px]" />
        </div>
      </header>

      <div className="flex justify-end">
        <Skeleton className="h-9 w-[220px]" />
      </div>

      {/* ═══ Academic performance ═══ */}
      <div className="space-y-5 pt-2">
        <SkeletonText variant="eyebrow" className="w-[168px]" />
        <ChartCardSkeleton chart="h-[280px] w-full" />
        <ChartCardSkeleton chart="h-[240px] w-full" />
        <ChartCardSkeleton chart="h-[280px] w-full" />
      </div>

      {/* ═══ Grading throughput ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <SkeletonText variant="eyebrow" className="w-[152px]" />
        <SkeletonCards
          count={3}
          grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        />
        <ChartCardSkeleton chart="h-[220px] w-full" />
      </div>
    </PageShell>
  );
}

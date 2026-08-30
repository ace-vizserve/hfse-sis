import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Loading state for the Admissions dashboard.
 *
 * Mirrors `app/(admissions)/admissions/page.tsx` — change it with the page.
 *
 * Only the page's UNCONDITIONAL spine is drawn: hero, comparison toolbar,
 * the four-KPI grid, and the bento chart rows. The "act now" cluster above
 * the KPIs (early-bird card, new-application triage, chase strip, priority
 * and insight panels) renders for operational roles only, and the focused
 * `?status=` branch drops everything below the toolbar — neither is knowable
 * before the data lands, so drawing them would guarantee a shift for the
 * roles that never see them.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* DashboardHero — eyebrow / serif headline / lede, AY + Current badges
          on the right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[210px]" />
          <SkeletonText variant="headline" className="w-[320px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[90px]" />
        </div>
      </header>

      {/* ComparisonToolbar — one bordered strip: AY select + date-range
          picker on the left, trust-strip sentence on the right. Shell
          classes copied from the component itself. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-[9.5rem]" />
          <Skeleton className="h-10 w-[240px]" />
        </div>
        <SkeletonText variant="eyebrow" className="w-[320px] max-w-full" />
      </div>

      {/* Four MetricCards. MetricCard always renders a CardFooter (the delta
          chip + comparison caption are unconditional markup), so the
          archetype's `footer` default is what matches. Grid copied from the
          page: `grid gap-4 xl:grid-cols-4` — NOT the container-query grid the
          old hand-drawn version used. */}
      <SkeletonCards count={4} grid="grid gap-4 xl:grid-cols-4" />

      {/* Bento row: pipeline (wide) beside time-to-enrol (narrow). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" />
        <ChartCard className="lg:col-span-1" />
      </section>

      {/* Assessment outcomes — full width. */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard className="lg:col-span-3" />
      </section>

      {/* Applications by level + document completion. */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard />
        <ChartCard />
      </section>

      {/* Referral (narrow) + the "Jump to a surface" quick-link hub (wide). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard />
        <ChartCard className="lg:col-span-2" />
      </section>
    </PageShell>
  );
}

/** The page's chart-panel idiom: mono eyebrow + serif title, chart below. */
function ChartCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <SkeletonText variant="micro" className="w-[120px]" />
        <SkeletonText variant="title" className="w-[190px]" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

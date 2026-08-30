import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/page.tsx` — change them together.
 *
 * The page is role-branched: a teacher sees the hero plus a PriorityPanel, a
 * registrar sees the hero, the ComparisonToolbar, three MetricCards and the
 * chart rows. This draws the registrar shape, because it is the one with
 * structure above the fold; the teacher view simply resolves to less.
 *
 * Numbers taken from the page: DashboardHero with two badges, the KPI section
 * is `grid gap-4 md:grid-cols-3` holding three `MetricCard`s (MetricCard
 * renders its `CardFooter` unconditionally, so `footer` stays default-true),
 * then the full-width velocity card, then `grid gap-4 lg:grid-cols-2` for
 * grade distribution + publication coverage.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* DashboardHero — eyebrow / 38-44px serif headline / lede, badges right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[152px]" />
          <SkeletonText variant="headline" className="w-[320px] max-w-full" />
          <SkeletonText variant="body" className="w-[30rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[86px]" />
        </div>
      </header>

      {/* ComparisonToolbar — its own bordered strip of h-10 controls
          (components/dashboard/comparison-toolbar.tsx). The AY switcher is
          turned off on this page, so only the range picker sits on the left. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Skeleton className="h-10 w-[260px]" />
        <Skeleton className="h-10 w-[132px]" />
      </div>

      <SkeletonCards count={3} grid="grid gap-4 md:grid-cols-3" />

      {/* Grade entry velocity — full-width TrendChart card. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-[148px]" />
          <SkeletonText variant="title" className="w-[176px]" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>

      {/* Grade distribution + publication coverage. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[132px]" />
              <SkeletonText variant="title" className="w-[220px] max-w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[220px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

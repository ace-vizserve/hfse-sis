import {
  ChartSkeleton,
  type ChartKind,
} from '@/components/dashboard/charts/chart-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';
import { cn } from '@/lib/utils';

/**
 * Mirrors `app/(records)/records/house-points/houses/[code]/page.tsx` —
 * change this file when that page changes.
 *
 * Back link, the dashboard hero (house tile + name + standing; year badges and
 * switcher on the right), four figure cards, the house-share pie and award
 * donut side by side, the points-by-event and top-students bar charts side by
 * side, then the one tabbed card (three tabs, one table) and the trust strip.
 */

function ChartCardSkeleton({
  kind,
  className,
}: {
  kind: ChartKind;
  className?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader className="space-y-2">
        <SkeletonText variant="micro" className="w-28" />
        <SkeletonText variant="title" className="w-56 max-w-full" />
      </CardHeader>
      <CardContent>
        <ChartSkeleton kind={kind} />
      </CardContent>
    </Card>
  );
}

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-48" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-11 rounded-xl md:size-12" />
            <SkeletonText variant="headline" className="w-72 max-w-full" />
          </div>
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-9 w-40" />
        </div>
      </header>

      <SkeletonCards
        count={4}
        grid="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton kind="donut" />
        <ChartCardSkeleton kind="donut" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton kind="comparison-bar" />
        <ChartCardSkeleton kind="comparison-bar" />
      </div>

      <Card className="min-w-0">
        <CardHeader className="space-y-2">
          <SkeletonText variant="micro" className="w-20" />
          <SkeletonText variant="title" className="w-56 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-80 max-w-full rounded-md" />
          <SkeletonText variant="body" className="w-96 max-w-full" />
          <SkeletonTable columns={4} rows={6} />
        </CardContent>
      </Card>

      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-48" />
      </div>
    </PageShell>
  );
}

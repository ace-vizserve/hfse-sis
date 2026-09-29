import { ChartSkeleton } from '@/components/dashboard/charts/chart-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/house-points/houses/[code]/page.tsx` —
 * change this file when that page changes.
 *
 * Back link, the header (house tile + name + standing, year switcher on the
 * right), six figure cards, four chart cards in a 2×2 grid, then the three
 * drill-down tables (By event, By student + its note, Members) and the trust
 * strip.
 */

function ChartCardSkeleton() {
  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-2">
        <SkeletonText variant="micro" className="w-28" />
        <SkeletonText variant="title" className="w-56" />
        <SkeletonText variant="body" className="w-72 max-w-full" />
      </CardHeader>
      <CardContent>
        <ChartSkeleton kind="comparison-bar" />
      </CardContent>
    </Card>
  );
}

function TableSection({ columns }: { columns: number }) {
  return (
    <div className="space-y-3">
      <SkeletonText variant="title" className="w-32" />
      <SkeletonText variant="body" className="w-80 max-w-full" />
      <SkeletonTable columns={columns} rows={6} />
    </div>
  );
}

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-64" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-11 rounded-xl md:size-12" />
            <SkeletonText variant="headline" className="w-72 max-w-full" />
          </div>
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </header>

      <SkeletonCards
        count={6}
        grid="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>

      <TableSection columns={4} />
      <TableSection columns={5} />
      <TableSection columns={3} />

      <SkeletonText variant="micro" className="w-48" />
    </PageShell>
  );
}

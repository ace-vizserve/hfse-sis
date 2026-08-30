import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Loading state for the P-Files hub.
 *
 * Rebuilt 2026-08-30, for the same two reasons as the SIS hub's loader:
 *
 * 1. Every placeholder was a hand-rolled `animate-pulse rounded bg-muted`
 *    div rather than `<Skeleton>`, so none of them picked up the fill fix —
 *    and `--muted` is `#f8fafc`, near-white, invisible on a white card.
 * 2. The shapes did not match the page. It drew a 4-up strip of short
 *    `px-5 py-4` cards where the page renders full `MetricCard`s with a
 *    sparkline, and an 8-row list of `h-10` bars where the page renders a
 *    real table.
 *
 * Grid classes are copied from `app/(p-files)/p-files/page.tsx`.
 */
export default function PFilesLoading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[150px]" />
          <SkeletonText variant="headline" className="w-[300px] max-w-full" />
          <SkeletonText variant="body" className="w-[32rem] max-w-full" />
        </div>
        <Skeleton className="h-7 w-[86px]" />
      </header>

      {/* Range-aware KPI strip — MetricCards carry a footer and a sparkline. */}
      <SkeletonCards count={4} grid="grid gap-4 xl:grid-cols-4" />

      {/* Summary cards. */}
      <SkeletonCards
        count={4}
        footer={false}
        grid="grid gap-4 xl:grid-cols-4"
      />

      {/* Revision trend, full width. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-[130px]" />
          <SkeletonText variant="title" className="w-[210px]" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[220px] w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Completion by level (2/3) beside slot status mix (1/3). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[120px]" />
              <SkeletonText variant="title" className="w-[190px]" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[200px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[96px]" />
              <SkeletonText variant="title" className="w-[140px]" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[200px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Expiring documents, full width — a real table, not a stack of bars. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-[210px]" />
          <SkeletonText variant="title" className="w-[300px] max-w-full" />
        </CardHeader>
        <CardContent>
          <SkeletonTable columns={5} rows={8} />
        </CardContent>
      </Card>
    </PageShell>
  );
}

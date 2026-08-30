import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(dashboard)/page.tsx` — the signed-in home page — so change this
 * file when that page changes.
 *
 * The version this replaces drew four KPI stat cards over two big blocks. Home
 * has no stat cards at all: it is a greeting header with a quick-actions row,
 * then a `TodoPanel` (`flex-[2]`) beside a `ComingUpPanel` (`flex-1`), then a
 * full-width `RecentActionsPanel`. So every element of the old fallback moved
 * on arrival.
 *
 * NO archetype: none of the three panels is a `DataTable` or a stat-card grid —
 * they are `Card`s with their own bordered header strip over a divided list —
 * so this composes from `Skeleton`/`SkeletonText` instead of forcing one.
 *
 * `UpcomingCoverPanel` is deliberately not drawn: it renders nothing unless the
 * viewer is a teacher with cover booked, which is the exception, and a
 * placeholder for it would leave a hole on almost every load. The margins below
 * are the no-cover ones (`mt-8`), matching that same ordinary case.
 */
function PanelSkeleton({
  className,
  rows,
}: {
  className: string;
  rows: number;
}) {
  return (
    <Card className={`overflow-hidden p-0 ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Skeleton className="size-[30px] shrink-0 rounded-lg" />
        <SkeletonText variant="body" className="w-[140px]" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <SkeletonText variant="body" className="w-[70%]" />
            <SkeletonText variant="micro" className="w-[45%]" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <PageShell>
      {/* Header — greeting tile, eyebrow, serif greeting, one line of copy, and
          the quick-actions row. `border-b pb-7` is the real header's. */}
      <header className="flex flex-col gap-6 border-b border-border pb-7 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-4">
          <div
            aria-hidden
            className="size-11 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
          />
          <div>
            <SkeletonText variant="eyebrow" className="w-[230px]" />
            {/* The greeting h1 is 32px serif, 38px from `md:` — `headline` is
                38px, so it matches the desktop reading exactly. */}
            <SkeletonText
              variant="headline"
              className="mt-2 w-[280px] max-w-full"
            />
            <SkeletonText
              variant="body"
              className="mt-2 w-[22rem] max-w-full"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-[132px]" />
          ))}
        </div>
      </header>

      <div className="mt-8 mb-6 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <PanelSkeleton className="flex-[2]" rows={4} />
        <PanelSkeleton className="flex-1" rows={3} />
      </div>

      <PanelSkeleton className="w-full" rows={5} />
    </PageShell>
  );
}

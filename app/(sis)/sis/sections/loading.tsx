import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/sections/page.tsx` — change this file when that page
 * changes.
 *
 * The version this replaces drew a flat stack of ten `h-12` row bars, which is
 * the shape this page HAD before it became one card per level. It is a card
 * grid now, so a table-shaped fallback re-flowed the entire page on arrival.
 *
 * Counts come from the page, not from taste: three `HubStat`s (each with a
 * `subtext`, so each renders a `CardFooter`) on `sm:grid-cols-3`, then
 * `SectionsOverview` — Primary (6 levels) and Secondary (4) as two labelled
 * groups on `md:grid-cols-2 xl:grid-cols-3`. The level catalogue is a fixed 10
 * since migration 086, so these are exact, not typical.
 */
const LEVEL_GROUPS = [
  { key: 'primary', levels: 6 },
  { key: 'secondary', levels: 4 },
];

export default function Loading() {
  return (
    <PageShell>
      {/* SisPageHeader — back link, header, AY chip, "New section" action. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[168px]" />
            <SkeletonText variant="headline" className="w-[380px] max-w-full" />
            <SkeletonText variant="body" className="w-[34rem] max-w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-[86px]" />
            <Skeleton className="h-8 w-[124px]" />
          </div>
        </header>
      </div>

      {/* Levels covered · Active students · Withdrawn. */}
      <SkeletonCards count={3} grid="grid grid-cols-1 gap-3 sm:grid-cols-3" />

      {/* SectionsOverview: search + level-type segmented tabs + export, then
          the two level groups. */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-9 w-[220px]" />
          <Skeleton className="h-9 w-[190px]" />
          <Skeleton className="ml-auto h-8 w-[120px]" />
        </div>

        {LEVEL_GROUPS.map((group) => (
          <div key={group.key}>
            <div className="mb-2.5 flex items-center gap-2.5">
              <SkeletonText variant="micro" className="w-[72px]" />
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: group.levels }).map((_, i) => (
                <Skeleton key={i} className="h-[168px] w-full rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

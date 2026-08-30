import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/sections/[id]/page.tsx` — change this file when that
 * page changes.
 *
 * Three things the version this replaces got wrong: it drew FOUR pill-shaped
 * tabs where the page has TWO (`Overview` / `Teachers`, a default `TabsList`,
 * not pills); it drew no stat cards at all where three `HubStat`s go; and it
 * drew fifteen `h-12` bars where the roster is a real `DataTable`.
 *
 * The Overview tab is the one a navigation lands on, so it is what is drawn.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* SisPageHeader — back link to /sis/sections, section name as the
          headline, up to four chips (level, schedule, track, AY) and up to six
          actions. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[92px]" />
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[168px]" />
            <SkeletonText variant="headline" className="w-[300px] max-w-full" />
            <SkeletonText variant="body" className="w-[24rem] max-w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`chip-${i}`} className="h-7 w-[86px]" />
            ))}
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={`action-${i}`} className="h-8 w-[124px]" />
            ))}
          </div>
        </header>
      </div>

      {/* Two tabs: Overview, Teachers. */}
      <div>
        <Skeleton className="h-9 w-[220px] rounded-lg" />

        <div className="mt-4 space-y-5">
          {/* Active · Late enrollees · Withdrawn — each passes a `subtext`, so
              each renders a CardFooter. */}
          <SkeletonCards
            count={3}
            grid="grid grid-cols-1 gap-3 sm:grid-cols-3"
          />

          {/* SectionSubjectsPanel — a Card whose header strip carries the icon
              tile, over a body of subject chips. */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <SkeletonText variant="micro" className="w-[160px]" />
                <SkeletonText variant="body" className="w-[240px] max-w-full" />
              </div>
              <Skeleton className="h-8 w-[112px] shrink-0" />
            </div>
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-[104px] rounded-full" />
              ))}
            </div>
          </div>

          {/* SectionRosterTable — seven columns defined, three hidden by
              `initialColumnVisibility` (enrollment_date, withdrawal_date,
              termJoined), so FOUR are visible: index, student, status, row
              actions. `hidePagination` is true, so no pager. */}
          <div className="space-y-3">
            <SkeletonTable columns={4} rows={15} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

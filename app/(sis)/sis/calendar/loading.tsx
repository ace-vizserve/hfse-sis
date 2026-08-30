import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/calendar/page.tsx` — change this file when that page
 * changes.
 *
 * NO archetype here on purpose: the surface is `CalendarAdminClient`, a bespoke
 * editor (a fixed 272px sidebar beside a toolbar and a month grid), not a
 * `DataTable` or a card grid. Forcing one of the four archetypes onto it would
 * be a worse fallback than composing from `Skeleton`/`SkeletonText`, so it is
 * composed.
 *
 * Two corrections to the version this replaces:
 *
 * 1. It used a bare `PageShell` (`max-w-360`, 1440px) where the page passes
 *    `max-w-[1400px]`.
 * 2. It drew a full-width 7-column month grid with no sidebar, so the whole
 *    calendar slid 292px left the moment `CalendarAdminClient` mounted. The
 *    real shell is `flex items-start gap-5` with `CalendarSidebar` at
 *    `w-[272px] shrink-0`.
 */
export default function Loading() {
  return (
    <PageShell className="max-w-[1400px]">
      {/* SisPageHeader — back link, eyebrow, serif title, description, AY chip. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[168px]" />
            <SkeletonText variant="headline" className="w-[340px] max-w-full" />
            <SkeletonText variant="body" className="w-[30rem] max-w-full" />
          </div>
          <Skeleton className="h-7 w-[86px]" />
        </header>
      </div>

      <div className="flex items-start gap-5">
        {/* CalendarSidebar — Add button, filter trigger, then the audience and
            legend cards. */}
        <div className="flex w-[272px] shrink-0 flex-col gap-4">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-[104px] w-full rounded-xl" />
          <Skeleton className="h-[168px] w-full rounded-xl" />
        </div>

        <div className="min-w-0 flex-1 space-y-5">
          {/* CalendarToolbar — term selector left, view switcher right. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-9 w-[200px]" />
            <Skeleton className="h-9 w-[220px]" />
          </div>

          {/* MonthView — a weekday header row over six week rows. */}
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <SkeletonText
                key={`dow-${i}`}
                variant="micro"
                className="w-full"
              />
            ))}
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

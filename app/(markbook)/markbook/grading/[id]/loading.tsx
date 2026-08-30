import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/grading/[id]/page.tsx` — change them
 * together.
 *
 * Numbers taken from the page: a back link, a hero whose headline sits beside
 * a locked/open badge, then three `StatCard`s — Students / Graded / Weights —
 * whose `footerTitle` + `footerDetail` props are REQUIRED, so each renders a
 * CardFooter and `footer` stays default-true. Their grid breaks on the
 * container (`@xl/main:grid-cols-3`), hence `grid` rather than `className`.
 *
 * Below that is `ScoreEntryGrid`, which is NOT a `DataTable`: a full-width
 * ScoringGuide trigger strip, a filter row, then a `<Table>` inside a Card
 * with no pagination bar. Its leaf-column count is
 * `wwSlots + ptSlots + 14` — data-dependent, since the slot counts come from
 * the sheet — so 14 is drawn as the no-slots floor rather than a guess at the
 * configured width, and `toolbar` is off because the real filter row is drawn
 * above instead. The real header spans three stacked rows (group bands, codes,
 * maxima) where the archetype draws one.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[152px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[144px]" />
          <div className="flex flex-wrap items-baseline gap-3">
            <SkeletonText variant="headline" className="w-[260px] max-w-full" />
            <Skeleton className="h-7 w-[124px]" />
          </div>
          <SkeletonText variant="body" className="w-[24rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-[136px]" />
          <Skeleton className="h-9 w-[112px]" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      <div className="space-y-3">
        {/* ScoringGuide trigger strip — fixed height whatever the slot count. */}
        <Skeleton className="h-[42px] w-full rounded-lg" />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-9 w-[280px] max-w-full" />
          <Skeleton className="h-9 w-[150px]" />
        </div>
        <SkeletonTable columns={14} rows={15} toolbar={false} />
      </div>
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/sections/page.tsx` — change this file
 * when that page changes.
 *
 * Shape taken from the real page, in its order: the header (eyebrow / serif
 * title / lede, with the AY and term badges on the right), TWO `SummaryCard`s
 * inside an `@container/main` on `@xl/main:grid-cols-2`, then the
 * `AttendanceSectionsDataTable`.
 *
 * The card grid is passed via `grid`, not `className`: the page breaks on its
 * CONTAINER (`@xl/main:grid-cols-2`), which does not override the archetype's
 * viewport-based `sm:grid-cols-2` / `lg:grid-cols-4` — merging would leave both
 * applying and lay the fallback out in four columns on a wide screen.
 * `SummaryCard` takes `footerTitle` and `footerDetail` as required props, so it
 * always renders a `CardFooter` and `footer` stays at its default.
 *
 * Five columns is the registrar+ view (Section / Level / Adviser / Active /
 * row actions). A teacher sees four — `showAdviser` is `!isTeacherOnly` — but
 * the missing column changes cell widths, not row heights, so the vertical
 * shape this file exists to hold is the same either way.
 *
 * Deliberately omitted, because the loader cannot know the role or the data:
 * the upcoming-cover panel and the declarations-waiting panel (both render
 * nothing when there is nothing to say) and the empty-roster card.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[186px]" />
          <SkeletonText variant="headline" className="w-[280px] max-w-full" />
          <SkeletonText variant="body" className="w-[32rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
          <Skeleton className="h-7 w-[76px]" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={2}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2"
        />
      </div>

      {/* `DataTable` at `pageSize={25}`, and it renders its pagination bar
          INSIDE the bordered shell whenever there is at least one row — which
          this table always has once an AY has sections. */}
      <SkeletonTable columns={5} rows={10} pagination />
    </PageShell>
  );
}

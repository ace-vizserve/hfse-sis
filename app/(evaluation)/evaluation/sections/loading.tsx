import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(evaluation)/evaluation/sections/page.tsx` — change this file
 * when that page changes.
 *
 * The version this replaces drew a six-tile card grid on
 * `sm:grid-cols-2 lg:grid-cols-3`. That is not this page: `EvaluationSectionsList`
 * is a `DataTable`, and the only cards are TWO summary cards on
 * `@xl/main:grid-cols-2`. It also drew no back link.
 *
 * Column count is the oversight reading — Section, Level, T1, T2, T3, Adviser,
 * row actions = 7. A teacher sees 6: `buildColumns` drops the Adviser column
 * for `isTeacher`. The term columns are one per T1–T3 (KD #49), so three, not
 * a guess. Page size is 25 and `hidePagination` is not set, so the pager
 * renders inside the shell.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[104px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[72px]" />
          <SkeletonText variant="headline" className="w-[220px]" />
          <SkeletonText variant="body" className="w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-7 w-[86px]" />
      </header>

      {/* Total sections · Active students — both `SummaryCard`s carry a
          required footer, so `footer` stays at its default. */}
      <div className="@container/main">
        <SkeletonCards
          count={2}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2"
        />
      </div>

      {/* The "N sections" count strip above the table. */}
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden
          className="size-6 shrink-0 rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
        />
        <SkeletonText variant="micro" className="w-[96px]" />
      </div>

      <SkeletonTable columns={7} rows={10} pagination />
    </PageShell>
  );
}

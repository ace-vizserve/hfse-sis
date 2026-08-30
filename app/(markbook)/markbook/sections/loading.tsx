import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/sections/page.tsx` — change them together.
 *
 * Numbers taken from the page: a hero header with one AY badge, three
 * `SummaryCard`s (Total sections / Active students / Withdrawn) whose
 * `footerTitle` + `footerDetail` props are REQUIRED, so every card renders a
 * CardFooter and `footer` stays default-true. Their grid breaks on the
 * container — `@xl/main:grid-cols-3` — which is why it is passed via `grid`
 * and not `className`.
 *
 * The table is `MarkbookSectionsDataTable`: five columns, all visible (no
 * `initialColumnVisibility`), `pageSize={25}` with pagination left on, and a
 * school always has sections — so the footer bar is drawn.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[136px]" />
          <SkeletonText variant="headline" className="w-[280px] max-w-full" />
          <SkeletonText variant="body" className="w-[30rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-[86px]" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      <SkeletonTable columns={5} rows={10} pagination />
    </PageShell>
  );
}

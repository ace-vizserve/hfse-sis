import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/audit-log/page.tsx` — change this file
 * when that page changes.
 *
 * Shape taken from the real page, in its order: the back link, the header
 * (eyebrow / serif title / lede, nothing on the right), THREE `StatCard`s
 * inside an `@container/main` on `@xl/main:grid-cols-3`, then the
 * `AttendanceAuditLogDataTable` and the server-paging bar it renders beneath
 * the table shell.
 *
 * The card grid is passed via `grid`, not `className`: the page breaks on its
 * CONTAINER (`@xl/main:grid-cols-3`), which does not override the archetype's
 * viewport-based `sm:grid-cols-2` / `lg:grid-cols-4` — merging would leave both
 * applying. `StatCard` takes `footerTitle` and `footerDetail` as required
 * props, so it always renders a `CardFooter` and `footer` stays at its default.
 *
 * Five visible columns: When / Who / Action / Details / the row-actions menu.
 * Nothing is hidden by default — the table declares no
 * `initialColumnVisibility`.
 *
 * TWO pagination bars are correct here, and that is not a mistake. `DataTable`
 * draws its own inside the bordered shell whenever `hidePagination` is false
 * and there is at least one row, and this page passes neither flag; the page
 * then renders a SECOND, server-side pager below it, because the 50-per-page
 * window is cut in SQL rather than in the browser.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* Back to Attendance. */}
      <SkeletonText variant="body" className="w-[120px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[178px]" />
          <SkeletonText variant="headline" className="w-[330px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      <SkeletonTable columns={5} rows={12} pagination />

      {/* The server-side pager. A sibling of the table, not part of its shell —
          which is why it carries its own border and `rounded-b-xl`. */}
      <Skeleton className="h-[49px] w-full rounded-b-xl" />
    </PageShell>
  );
}

import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/audit-log/page.tsx` — change this file when that page
 * changes.
 *
 * NO PageShell and NO header here, deliberately. `loading.js` nests INSIDE
 * `layout.js`, and this route's layout already renders the `PageShell`, the
 * `SisPageHeader` and the Log/Overview `PageTabNav`. The version this replaces
 * drew all three again, so the fallback painted a second back-link, eyebrow,
 * headline and description underneath the real ones.
 *
 * Shape, in the page's own order: three `HubStat`s on `sm:grid-cols-3` (each
 * passes `subtext`, so each renders a `CardFooter`), then `AuditLogDataTable`.
 * That table shows TWO pagers — `DataTable`'s own inside the bordered shell,
 * plus the page's server-side strip below it — so both are drawn.
 */
export default function Loading() {
  return (
    <>
      {/* Entries loaded · Unique actors · Config changes. */}
      <SkeletonCards count={3} grid="grid grid-cols-1 gap-3 sm:grid-cols-3" />

      {/* Five visible columns: at, actor, action, details, open.
          The server page size is 50; a viewport's worth is drawn instead of 50
          pulsing rows, since the only thing below the table is the pager. */}
      <SkeletonTable columns={5} rows={12} pagination />

      {/* The page's own server-paginated strip, below the table. Classes copied
          from `_AuditLogTable` in the markbook audit-log data table. */}
      <div className="flex items-center justify-between rounded-b-xl border border-t-0 border-border bg-muted/30 px-4 py-3">
        <SkeletonText variant="body" className="w-[180px]" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-[68px]" />
          <SkeletonText variant="micro" className="w-[34px]" />
          <Skeleton className="h-7 w-[68px]" />
        </div>
      </div>
    </>
  );
}

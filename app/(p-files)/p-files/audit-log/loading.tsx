import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(p-files)/p-files/audit-log/page.tsx` — change this file when
 * that page changes.
 *
 * The version this replaces drew no back link and, more importantly, none of
 * the three `StatCard`s — it went straight from the header to a bare toolbar
 * and fifteen `h-10 min-w-[700px]` bars. Those bars were also the wrong height
 * for a `DataTable` row and forced a horizontal scrollbar the real table does
 * not have at this width.
 *
 * `StatCard` here has a required footer (title + detail), so `footer` stays at
 * its default. The grid really is container-based (`@xl/main:grid-cols-3`
 * inside `@container/main`), so it goes through `grid`, not `className`.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[104px]" />

      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-[150px]" />
        <SkeletonText variant="headline" className="w-[240px]" />
        <SkeletonText variant="body" className="w-[30rem] max-w-full" />
      </header>

      {/* Entries loaded · Unique actors · Officer activity. */}
      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      {/* Five visible columns: at, actor, action, details, open. The server
          page size is 50; a viewport's worth is drawn rather than 50 pulsing
          rows, since the only thing below the table is its pager. */}
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
    </PageShell>
  );
}

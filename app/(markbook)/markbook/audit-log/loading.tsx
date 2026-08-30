import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/audit-log/page.tsx` — change them together.
 *
 * Numbers taken from the page: a back link, a hero header with no controls
 * beside it, then three `StatCard`s — Entries loaded / Unique actors /
 * Post-lock edits — whose `footerTitle` + `footerDetail` props are REQUIRED,
 * so each renders a CardFooter and `footer` stays default-true. Their grid
 * breaks on the container (`@xl/main:grid-cols-3`), hence `grid` rather than
 * `className`.
 *
 * `AuditLogDataTable` has five columns — at, actor, action, details, open —
 * with no `initialColumnVisibility`. This page paginates on the SERVER, so
 * there are TWO bars: `DataTable`'s own footer inside the bordered shell
 * (`hidePagination` is not set and the page always has entries), plus the
 * page-navigation strip the table renders BELOW the shell. Drawing only one of
 * them would shift the footer by ~45px the moment data lands.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[96px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[200px]" />
          <SkeletonText variant="headline" className="w-[240px] max-w-full" />
          <SkeletonText variant="body" className="w-[32rem] max-w-full" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      <SkeletonTable columns={5} rows={12} pagination />

      {/* Server page navigation — sits outside the table's own shell. */}
      <div className="flex items-center justify-between rounded-b-xl border border-t-0 border-border bg-muted/30 px-4 py-3">
        <SkeletonText variant="body" className="w-[180px]" />
        <Skeleton className="h-7 w-[160px]" />
      </div>
    </PageShell>
  );
}

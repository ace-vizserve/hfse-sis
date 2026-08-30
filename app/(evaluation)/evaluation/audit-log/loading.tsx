import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(evaluation)/evaluation/audit-log/page.tsx` — change this file
 * when that page changes.
 *
 * This route has NO layout of its own, so unlike `/sis/audit-log` the shell and
 * header belong here.
 *
 * The version this replaces drew ten `h-12` bars where the page renders a real
 * `AuditLogDataTable`, and its three stat blocks were flat `h-28` rectangles
 * rather than `Card`s — the page's `StatCard` has a required footer (title +
 * detail), so it is a ~168px card, not a 112px block.
 *
 * The stat grid is passed via `grid` because the page really does break on its
 * container here (`@xl/main:grid-cols-3` inside `@container/main`), and merging
 * that through `className` would leave the archetype's `sm:grid-cols-2` and
 * `lg:grid-cols-4` applying alongside it.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[104px]" />

      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-[180px]" />
        <SkeletonText variant="headline" className="w-[240px]" />
        <SkeletonText variant="body" className="w-[36rem] max-w-full" />
      </header>

      {/* Entries loaded · Unique actors · Writeups submitted. */}
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

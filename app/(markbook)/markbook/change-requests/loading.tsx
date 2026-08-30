import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/change-requests/page.tsx` — change them
 * together.
 *
 * Numbers taken from the page: a `space-y-3` header, then FIVE status cards
 * (Pending / Approved / Applied / Declined / Cancelled) built inline as
 * header-only `<Card>`s with a gradient tile in `CardAction` and NO
 * `CardFooter` — hence `footer={false}`, which is the ~132px card rather than
 * the ~168px one. Their grid breaks on the container
 * (`@xl/main:grid-cols-2 @5xl/main:grid-cols-5`), so it is passed via `grid`;
 * merging it through `className` would leave the archetype's own
 * `sm:grid-cols-2 lg:grid-cols-4` live alongside it.
 *
 * `ChangeRequestsDataTable` declares ten columns — filed, teacher, section,
 * subject, term, field, change, reason, status, actions — with no
 * `initialColumnVisibility`, so all ten are visible. It carries `statusTabs`,
 * drawn as the strip above the toolbar. `pagination` is left OFF because the
 * bar is data-dependent here: `DataTable` hides it when there are no rows, and
 * a school with no filed change requests is the ordinary case.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <SkeletonText variant="eyebrow" className="w-[176px]" />
        <SkeletonText variant="headline" className="w-[300px] max-w-full" />
        <SkeletonText variant="body" className="w-[32rem] max-w-full" />
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={5}
          footer={false}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5"
        />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-9 w-[360px] max-w-full" />
        <SkeletonTable columns={10} rows={10} />
      </div>
    </PageShell>
  );
}

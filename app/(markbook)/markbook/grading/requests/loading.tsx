import { Card, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/grading/requests/page.tsx` — change them
 * together.
 *
 * Numbers taken from the page: a `space-y-3` header, then FIVE status cards
 * (Pending / Approved / Applied / Declined / Cancelled) in
 * `grid grid-cols-2 gap-3 md:grid-cols-5`.
 *
 * `SkeletonCards` is deliberately NOT used for that row. This page's local
 * `StatCard` is the odd one in Markbook: header-only AND with no
 * `CardAction`, so the archetype would paint five gradient icon tiles that
 * are not on the real card. The real `<Card>` is composed here instead, with
 * the value bar pinned to the card's own 28px title rather than the
 * archetype's 32px `stat` voice.
 *
 * `MyRequestsTable` declares nine on-screen columns — filed, field, section,
 * subject, term, change, reason, status, actions — with no
 * `initialColumnVisibility`, so all nine are visible. (Its `csv_*` entries are
 * export-only and never render.) It carries `statusTabs`, drawn as the strip
 * above the toolbar. `pagination` is left OFF: the table is scoped to requests
 * THIS teacher filed, which is commonly zero, and `DataTable` hides the footer
 * bar entirely when there are no rows.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <SkeletonText variant="eyebrow" className="w-[180px]" />
        <SkeletonText variant="headline" className="w-[240px] max-w-full" />
        <SkeletonText variant="body" className="w-[30rem] max-w-full" />
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <SkeletonText variant="micro" className="w-[64px]" />
              <SkeletonText variant="stat" className="h-[28px] w-[42px]" />
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-9 w-[360px] max-w-full" />
        <SkeletonTable columns={9} rows={8} />
      </div>
    </PageShell>
  );
}

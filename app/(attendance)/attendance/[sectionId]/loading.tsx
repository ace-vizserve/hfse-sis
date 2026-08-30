import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';
import { Card } from '@/components/ui/card';

// Loading skeleton for /attendance/[sectionId]. Five parallel fetches
// (calendar, events, daily, rollup, quota) take ~300–600ms at HFSE scale.
// Without this skeleton the user sees the previous page until the server
// component resolves. Mirrors `page.tsx` — keep the two in step.
//
// The marking grid below is composed by hand ON PURPOSE. It is not a
// `DataTable`, so `SkeletonTable` would draw the wrong thing: the real grid
// has sticky identity columns, one column per school day, and a horizontal
// scroll area. The archetypes are used for the parts that ARE standard — the
// masthead voices and the stat row.
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-24" />
          <SkeletonText variant="headline" className="w-[260px]" />
          <SkeletonText variant="body" className="w-[28rem] max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-8 w-40" />
        </div>
      </header>

      <Skeleton className="h-9 w-[380px] rounded-xl" />

      {/* Four StatCards, sheet view only. The grid classes are copied from
          page.tsx and break on the CONTAINER (`@xl/main`), not the viewport —
          this file previously used `md:grid-cols-4`, which reflows at a
          different width from the real row. StatCard here always renders a
          CardFooter, so the archetype's `footer` default is correct. */}
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-4"
        />
      </div>

      {/* Grid shimmer — approx the wide-grid footprint. 30 rows × a handful of
          sticky columns visible. Don't bother rendering 47 date columns
          client-side; the horizontal scroll area paints on hydration. */}
      <Card className="overflow-hidden p-0">
        <div className="space-y-0">
          <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-3 py-2">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-[180px]" />
            <Skeleton className="h-4 w-[110px]" />
            <div className="flex gap-2 ml-auto">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-10" />
              ))}
            </div>
          </div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
            >
              <Skeleton className="h-4 w-6" />
              <Skeleton className="h-4 w-[160px]" />
              <Skeleton className="h-4 w-[90px]" />
              <div className="flex gap-2 ml-auto">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-6 w-10" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageShell>
  );
}

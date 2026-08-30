import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/academic-summary/page.tsx` — change this file
 * when that page changes.
 *
 * The page has three branches; this draws the one a navigation lands on, the
 * school-wide overview (no `?level=`): hero with a single export action, the
 * `OverviewFilterBar` card, then `AcademicOverviewView` — four status cards,
 * a scope note, "The school this year" (three tiles), "How they are doing"
 * (four tiles), and the trend/per-term pair.
 *
 * That is a different page from the one the hand-drawn version drew: twenty
 * `h-10 min-w-[800px]` bars, i.e. the per-level masterfile grid, which is only
 * reached deliberately via `?view=masterfile`. Nothing above the table was
 * drawn at all.
 *
 * Every card in the overview is header + a footnote block, so `footer` stays
 * true, and each grid is passed via `grid` so it replaces the archetype's
 * defaults rather than stacking with them.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-96 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </header>

      {/* OverviewFilterBar — a bordered card: a caption row with a show/hide
          button, then a wrapping row of labelled h-9 selects (term, level,
          class, subject, award category, plus the year when the school has
          more than one). */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <SkeletonText variant="micro" className="w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="flex flex-wrap items-end gap-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <SkeletonText variant="label" className="w-20" />
              <Skeleton className="h-9 w-40" />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-8">
        {/* Where the year stands. */}
        <SkeletonCards
          count={4}
          grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        />

        {/* The "figures cover…" scope note. */}
        <SkeletonText variant="body" className="w-120 max-w-full" />

        {/* The school this year — three tiles. */}
        <section className="flex flex-col gap-3">
          <SkeletonText variant="micro" className="w-40" />
          <SkeletonCards count={3} grid="grid gap-4 sm:grid-cols-3" />
        </section>

        {/* How they are doing — four tiles. */}
        <section className="flex flex-col gap-3">
          <SkeletonText variant="micro" className="w-56" />
          <SkeletonCards
            count={4}
            grid="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          />
        </section>

        {/* Trend beside the per-term table. */}
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="gap-0 py-0">
              <CardHeader className="border-b border-border py-5">
                <SkeletonText variant="micro" className="w-32" />
                <SkeletonText variant="title" className="w-60 max-w-full" />
              </CardHeader>
              <CardContent className="py-5">
                <Skeleton className="h-56 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

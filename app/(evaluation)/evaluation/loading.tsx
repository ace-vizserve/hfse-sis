import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(evaluation)/evaluation/page.tsx` — change this file when that
 * page changes.
 *
 * Two corrections to the version this replaces. It drew THREE cards where the
 * page renders four `MetricCard`s, and it laid them out on
 * `@xl/main:grid-cols-2 @5xl/main:grid-cols-4` — container queries the page
 * does not use here. The real grid is `grid gap-4 xl:grid-cols-4`, a plain
 * viewport breakpoint, and it is passed through `grid` rather than `className`
 * so the archetype's own `sm:grid-cols-2 lg:grid-cols-4` is replaced outright
 * instead of both rulesets applying.
 *
 * `MetricCard` always renders a `CardFooter` (delta chip + sparkline), so
 * `footer` stays at its default.
 *
 * Deliberately not drawn, because the loader cannot know the role or the data:
 * the missing-virtue-theme alert, the priority panels and recommendation
 * callouts, and the hub-card row's third/second tiles (a teacher sees ONE tile
 * on `md:grid-cols-1`, everyone else three on `md:grid-cols-3`). The KPI block
 * itself is registrar-and-above only; it is drawn because it is the tallest
 * thing on the page and omitting it would collapse the fallback to a header.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* DashboardHero — eyebrow, serif title, description, AY badge right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[210px]" />
          <SkeletonText variant="headline" className="w-[420px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <Skeleton className="h-7 w-[86px]" />
      </header>

      {/* ComparisonToolbar — one bordered row of controls. */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* Submission % · Submitted · Outstanding write-ups · Advisers behind. */}
      <SkeletonCards count={4} grid="grid gap-4 xl:grid-cols-4" />

      {/* SubmissionVelocityDrillCard, then WriteupsBySectionCard — both full
          width. */}
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <SkeletonText variant="micro" className="w-[140px]" />
            <SkeletonText variant="title" className="w-[220px] max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </CardContent>
        </Card>
      ))}

      {/* Hub cards — Section roster, Virtue themes, PTC schedule. Each is a
          Card with a header, a body paragraph and a CTA footer. */}
      <section className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonText variant="micro" className="w-[92px]" />
                  <SkeletonText variant="title" className="w-[150px]" />
                </div>
                <div
                  aria-hidden
                  className="size-10 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <SkeletonText variant="body" className="w-[96%]" />
              <SkeletonText variant="body" className="w-[88%]" />
              <SkeletonText variant="body" className="w-[64%]" />
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-[420px] max-w-full" />
      </div>
    </PageShell>
  );
}

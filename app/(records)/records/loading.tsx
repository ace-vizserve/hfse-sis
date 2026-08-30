import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/page.tsx` — change this file when that page
 * changes.
 *
 * Shape taken from the real page, in its order: `DashboardHero` (two badges
 * right), the `ComparisonToolbar` strip, the `InsightsPanel` card, four
 * `MetricCard`s on `xl:grid-cols-4`, the two velocity charts, three quick-link
 * tiles, the drill row (2/1), the full-width expiring-documents card and the
 * activity feed.
 *
 * The KPI grid is passed via `grid`, not `className`: the page breaks at
 * `xl:` only, and merging would leave the archetype's `sm:grid-cols-2` /
 * `lg:grid-cols-4` applying as well. `MetricCard` always renders a
 * `CardFooter` (delta chip + sparkline), so `footer` stays at its default.
 *
 * Deliberately omitted, because the loader cannot know the role or the data:
 * the unsynced-students alert, the recommendation callouts, the registrar-only
 * document-chase strip and the class-assignment readiness card.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      </header>

      {/* ComparisonToolbar — one bordered row of h-10 controls. */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* InsightsPanel — the narrative card. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-40" />
              <SkeletonText variant="title" className="w-64 max-w-full" />
            </div>
            <div
              aria-hidden
              className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>

      {/* Range-aware KPIs. */}
      <SkeletonCards count={4} grid="grid gap-4 xl:grid-cols-4" />

      {/* Enrollment velocity beside withdrawal velocity. */}
      <section className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonText variant="micro" className="w-40" />
              <SkeletonText variant="title" className="w-52" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-52 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Quick links — bordered tiles, not cards. */}
      <section className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </section>

      {/* Document backlog (2 cols) beside level distribution (1 col). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-40" />
              <SkeletonText variant="title" className="w-56" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-56 w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-32" />
              <SkeletonText variant="title" className="w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-56 w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Expiring documents — full width. */}
      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <SkeletonText variant="micro" className="w-44" />
            <SkeletonText variant="title" className="w-72 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-56 w-full rounded-lg" />
          </CardContent>
        </Card>
      </section>

      {/* Recent activity feed. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-32" />
          <SkeletonText variant="title" className="w-52" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-72" />
      </div>
    </PageShell>
  );
}

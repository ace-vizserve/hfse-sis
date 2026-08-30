import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`
 * — change this file when that page changes.
 *
 * Corrections against the real page: the header is NOT the two-column
 * `md:justify-between` split the hand-drawn version drew — it is a
 * `space-y-4` stack whose title line carries the status badge inline, with a
 * row of identifier chips beneath. There are FIVE tabs (Profile, Family,
 * Enrollment, Documents, Lifecycle), not four, and they belong to a `Tabs`
 * block rather than a hairline-bordered strip. Between the header and the
 * tabs sit the funnel-progress rail and FOUR `StatCard`s the old loader drew
 * nothing for; each card's `footnote` prop is required, so it always renders
 * a `CardFooter` and `footer` stays at the archetype default.
 *
 * The tab body drawn is the default one, Profile: a completeness card over
 * `ProfileSectionCard`'s 2×2 grid (Identity / Travel / Contact /
 * Preferences). The old loader's ten loose `h-16` bars on `md:grid-cols-2`
 * matched no tab.
 *
 * Deliberately omitted, because none of it is knowable before the data
 * lands: the Student # and class chips (present only once enrolled), the
 * enrollment-history chips (only when the applicant has applied in more than
 * one year), and the per-tab content of the other four tabs.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-40" />

      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-52" />
        <div className="flex flex-wrap items-baseline gap-3">
          {/* `font-serif text-[34px] md:text-[40px]` — the 38px `headline`
              voice is the closest of the seven. */}
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <Skeleton className="h-6 w-28" />
        </div>
        {/* Identifier chips — h-6 badges. Only the two unconditional ones
            (Enrolee #, AY) are drawn. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-24" />
        </div>
      </header>

      {/* FunnelProgress — four pill chips joined by hairline connectors.
          Skipped by the page only when the application has left the funnel
          (Cancelled / Withdrawn), which is not what this route usually
          opens. */}
      <Skeleton className="h-7 w-136 max-w-full rounded-full" />

      {/* At-a-glance stats: current stage, level applied, documents, enrolee
          type. */}
      <section className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-4"
        />
      </section>

      {/* Five tabs — TabsList is p-1 around h-8 triggers, so 40px tall. */}
      <div className="space-y-6">
        <Skeleton className="h-10 w-120 max-w-full rounded-md" />

        {/* Profile tab (the default): the completeness card, then the 2×2
            section grid. Both card shells are `gap-0 overflow-hidden p-0`
            with a bordered header. */}
        <div className="space-y-5">
          <Card className="gap-0 overflow-hidden p-0">
            <CardHeader className="border-b border-border px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonText variant="micro" className="w-40" />
                  <SkeletonText variant="stat" className="w-64 max-w-full" />
                </div>
                <div
                  aria-hidden
                  className="size-12 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <SkeletonText variant="label" className="w-40" />
                <SkeletonText variant="label" className="w-16" />
              </div>
              {/* The completeness rail is a real 6px bar. */}
              <div
                aria-hidden
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              />
              <SkeletonText variant="micro" className="w-56 max-w-full" />
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="gap-0 overflow-hidden p-0">
                <CardHeader className="border-b border-border px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <SkeletonText variant="micro" className="w-32" />
                      <SkeletonText variant="body" className="w-40" />
                    </div>
                    <div
                      aria-hidden
                      className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
                    />
                  </div>
                </CardHeader>
                <CardContent className="px-5 py-4">
                  <Skeleton className="h-40 w-full rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

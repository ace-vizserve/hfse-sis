import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Loading state for the SIS Admin hub.
 *
 * Rebuilt 2026-08-30. The version this replaces was wrong twice over:
 *
 * 1. It hand-rolled `animate-pulse rounded bg-muted` divs instead of using
 *    `Skeleton`, so it never picked up the fill fix — and `--muted` is
 *    `#f8fafc`, near-white, which is invisible against a white card. The
 *    placeholders were effectively not there.
 *
 * 2. It drew a two-column `md:grid-cols-[1fr_320px]` layout with a sidebar.
 *    The page has no sidebar. Its real shape is a full-width stat strip
 *    (`sm:grid-cols-2 xl:grid-cols-4`), then a 3/2 split
 *    (`lg:grid-cols-5`), then a pair (`lg:grid-cols-2`) — so the whole page
 *    re-flowed the moment data arrived.
 *
 * Grid classes below are copied from `app/(sis)/sis/page.tsx`. If that page's
 * layout changes, this has to change with it.
 */
export default function SisLoading() {
  return (
    <PageShell>
      {/* SisPageHeader — eyebrow / serif title / description, AY badge right. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[190px]" />
          <SkeletonText variant="headline" className="w-[340px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <Skeleton className="h-7 w-[86px]" />
      </header>

      {/* HubYearBand — the readiness strip. */}
      <Skeleton className="h-[92px] w-full rounded-xl" />

      {/* Four HubStats. Each is a Card with a header AND a footer, so the
          archetype's `footer` default is what matches here. */}
      <SkeletonCards
        count={4}
        grid="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      />

      {/* Attention feed (3 cols) beside upcoming events (2 cols). */}
      <section className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[110px]" />
              <SkeletonText variant="title" className="w-[180px]" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[96px]" />
              <SkeletonText variant="title" className="w-[150px]" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Structural changes beside the audit trend. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonText variant="micro" className="w-[104px]" />
              <SkeletonText variant="title" className="w-[168px]" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[168px] w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

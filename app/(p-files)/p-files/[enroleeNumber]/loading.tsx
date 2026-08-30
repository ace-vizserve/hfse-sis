import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(p-files)/p-files/[enroleeNumber]/page.tsx` — change this file
 * when that page changes.
 *
 * Two things the version this replaces got wrong. It put two badge chips on the
 * right of the header, where the real header has nothing there at all — the
 * status line (progress bar + "N of M on file") sits UNDER the headline, on the
 * left. And it drew eight `h-20` tiles on `md:grid-cols-2` where the document
 * grid is `sm:grid-cols-2 lg:grid-cols-3` of full `DocumentCard`s, and drew
 * nothing whatever for the action-queue / family-contact row above them.
 *
 * NO archetype: the two operational cards and the `DocumentCard` grid are
 * bespoke compositions, not a `DataTable` or a stat-card strip, so this
 * composes from `Skeleton`/`SkeletonText`.
 *
 * Three tabs is exact, not typical — `groupOrder` in the page is
 * `['student-expiring', 'parent', 'student']`.
 *
 * `RecentActivityStrip` is not drawn: it renders only when the student has
 * events, so a placeholder would leave a hole on every quiet record.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[160px]" />

      <header>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[200px]" />
            <SkeletonText variant="headline" className="w-[360px] max-w-full" />
            {/* Student number · level · section · AY, one meta line. */}
            <SkeletonText variant="label" className="w-[280px] max-w-full" />
            {/* Completion bar + "N of M on file". The bar is a real h-1.5
                track, so it keeps its own height rather than becoming a bar. */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Skeleton className="h-1.5 w-48 rounded-full" />
              <SkeletonText variant="label" className="w-[200px]" />
            </div>
          </div>
        </div>
      </header>

      {/* ActionQueueCard (2 cols) beside FamilyContactCard (1 col). Both are
          `gap-0 py-0` cards with a bordered header strip. */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonText variant="micro" className="w-[130px]" />
                  <SkeletonText variant="title" className="w-[200px]" />
                </div>
                <Skeleton className="size-9 shrink-0 rounded-xl" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 py-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonText variant="micro" className="w-[110px]" />
                  <SkeletonText variant="title" className="w-[160px]" />
                </div>
                <Skeleton className="size-9 shrink-0 rounded-xl" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 py-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <SkeletonText variant="micro" className="w-[40%]" />
                  <SkeletonText variant="body" className="w-[78%]" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* DocumentGroupTabs — three groups, then a badge row and the card grid
          for the selected one. */}
      <div className="space-y-4">
        <Skeleton className="h-9 w-[330px] rounded-lg" />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-[86px] rounded-md" />
            <Skeleton className="h-5 w-[108px] rounded-md" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[176px] w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-[190px]" />
      </div>
    </PageShell>
  );
}

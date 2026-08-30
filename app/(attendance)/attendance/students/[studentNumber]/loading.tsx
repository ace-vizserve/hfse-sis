import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(attendance)/attendance/students/[studentNumber]/page.tsx` —
 * change this file when that page changes.
 *
 * Shape taken from the real page, in its order: the back link, the hero
 * (eyebrow / serif name / lede, with two badges over an "Open in Records"
 * button on the right), the TWO leave-quota cards on `md:grid-cols-2`, the
 * `StudentAttendanceTab` card, then the trust strip.
 *
 * `SkeletonCards` is deliberately NOT used for the quota pair. Those are not
 * stat cards: each is `gap-0 overflow-hidden p-0` with a bordered header, a
 * body carrying a 44px figure, a progress bar and an inline allowance editor,
 * and a tinted footnote strip — roughly twice the height of the archetype's
 * card. Standing the archetype in for them would move everything below by
 * around 150px the moment the data landed, which is the shift this file exists
 * to prevent. They are composed from the real `Card` instead.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* Back to the Attendance dashboard. */}
      <SkeletonText variant="body" className="w-[170px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-[194px]" />
          <SkeletonText variant="headline" className="w-[300px] max-w-full" />
          <SkeletonText variant="body" className="w-[34rem] max-w-full" />
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-[104px]" />
            <Skeleton className="h-7 w-[86px]" />
          </div>
          <Skeleton className="h-8 w-[160px]" />
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <QuotaCardSkeleton />
        <QuotaCardSkeleton />
      </div>

      {/* StudentAttendanceTab — one card per section the child sits in, each
          carrying the daily ledger and the monthly breakdown. */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-2">
            <SkeletonText variant="micro" className="w-[128px]" />
            <SkeletonText variant="title" className="w-[210px] max-w-full" />
          </div>
          <Skeleton className="h-7 w-[92px]" />
        </CardHeader>
        <CardContent className="space-y-5">
          <Skeleton className="h-[220px] w-full rounded-lg" />
          <Skeleton className="h-[120px] w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Trust strip. */}
      <div className="border-t border-hairline pt-3">
        <SkeletonText variant="micro" className="w-[340px] max-w-full" />
      </div>
    </PageShell>
  );
}

/**
 * One leave-quota card with the figures taken out. The real card is
 * `gap-0 p-0`, so every band supplies its own padding: a bordered header, the
 * body with the big figure + progress bar + inline editor, and the footnote
 * strip.
 */
function QuotaCardSkeleton() {
  return (
    <Card className="@container/card gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText variant="micro" className="w-[168px]" />
            <SkeletonText variant="title" className="w-[190px] max-w-full" />
          </div>
          <div
            aria-hidden
            className="size-10 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
          />
        </div>
      </CardHeader>

      <div className="space-y-4 px-6 py-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            {/* The serif 44px figure — taller than any TEXT_VOICE variant, so
                it is pinned to its own height rather than approximated. */}
            <Skeleton className="h-[44px] w-[58px]" />
            <SkeletonText variant="label" className="w-[150px]" />
          </div>
          {/* The progress bar keeps its real 8px track height. */}
          <Skeleton className="h-2 w-full rounded-full" />
          <SkeletonText variant="micro" className="w-[190px]" />
        </div>
        {/* The inline allowance editor — a label over a control row. */}
        <div className="space-y-2">
          <SkeletonText variant="micro" className="w-[124px]" />
          <Skeleton className="h-9 w-[180px]" />
        </div>
      </div>

      <CardContent className="border-t border-hairline px-6 py-3">
        <SkeletonText variant="micro" className="w-[86%]" />
      </CardContent>
    </Card>
  );
}

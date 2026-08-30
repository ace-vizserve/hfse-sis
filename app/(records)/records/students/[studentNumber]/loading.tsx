import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/students/[studentNumber]/page.tsx` — change
 * this file when that page changes.
 *
 * Corrections against the real page: the fact strip is FOUR cards, not three
 * (academic years, total placements, terms graded, and the house tile), it
 * breaks on `@container/main` rather than `md:`, and every card carries a
 * footnote line under the figure — so `footer` stays true. Below the strip the
 * page is a six-tab `Tabs` block, not the two loose `h-64`/`h-96` slabs the
 * hand-drawn version drew.
 *
 * Deliberately omitted: the document-status and quick-actions strips, which
 * render only when the student has a current-AY admissions row, and the
 * per-tab card count, which differs by tab. Only what always renders is drawn.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-24" />

      <header className="space-y-3">
        <SkeletonText variant="eyebrow" className="w-56" />
        <div className="flex flex-wrap items-baseline gap-3">
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <Skeleton className="h-7 w-24" />
        </div>
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      <section className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
        />
      </section>

      {/* Six tabs — TabsList is p-1 around h-8 triggers, so 40px tall. */}
      <div className="space-y-6">
        <Skeleton className="h-10 w-136 max-w-full rounded-md" />

        {/* Overview tab: the profile card over the post-enrolment checklist. */}
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
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
            <CardContent>
              <Skeleton className="h-56 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-72" />
      </div>
    </PageShell>
  );
}

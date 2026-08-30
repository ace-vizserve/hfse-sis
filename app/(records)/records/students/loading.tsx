import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/students/page.tsx` — change this file when
 * that page changes.
 *
 * What the hand-drawn version left out: the "Dashboard" back link, the four
 * `SummaryStat` cards (enrolled / active / late enrollees / withdrawn — each
 * with a required `CardFooter`), and the cross-year search card. It also drew
 * the roster as ten loose `h-12` bars when the real roster is a `DataTable`
 * sitting INSIDE a `p-0` card with a bordered header — so the whole lower half
 * of the page re-flowed when data landed.
 *
 * Grid classes are the page's own `@container/main` ones, passed via `grid`:
 * `className` would leave the archetype's `sm:`/`lg:` defaults applying too.
 *
 * Seven visible table columns — name, student #, level, section, house,
 * status, row actions. (Enrolee #, nationality and last-updated ship hidden
 * via `initialColumnVisibility`.)
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-72 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
          <Skeleton className="h-9 w-40" />
        </div>
      </header>

      <section className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
        />
      </section>

      {/* Cross-AY search — header, the search control, and a footer note. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-52" />
              <SkeletonText variant="title" className="w-64" />
            </div>
            <div
              aria-hidden
              className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-full" />
        </CardContent>
        <CardFooter>
          <SkeletonText variant="label" className="w-2/3" />
        </CardFooter>
      </Card>

      {/* Roster — a `p-0` card with a bordered header, the DataTable flush
          inside it. */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-40" />
              <SkeletonText variant="title" className="w-56" />
            </div>
            <div
              aria-hidden
              className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="ml-auto h-8 w-28" />
            </div>
            <Skeleton className="h-10 w-96 max-w-full rounded-md" />
            {/* `pagination` on: the roster is every enrolled student in the
                year against a page size of 25, so the bar always renders. */}
            <SkeletonTable columns={7} rows={12} toolbar={false} pagination />
          </div>
        </CardContent>
      </Card>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-72" />
      </div>
    </PageShell>
  );
}

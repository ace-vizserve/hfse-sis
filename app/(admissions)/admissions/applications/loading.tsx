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
 * Mirrors `app/(admissions)/admissions/applications/page.tsx` — change this
 * file when that page changes.
 *
 * What the hand-drawn version left out: the "Admissions dashboard" back link,
 * the THREE `StageStat` cards (Submitted / Ongoing Verification / Processing,
 * each with a required `CardFooter` carrying a progress rail), the cross-year
 * search card, and both card shells around the table. It also drew a five-tab
 * strip under the header where the real tabs live inside the table, and
 * twelve loose `h-12` bars for what is a `DataTable` sitting flush inside a
 * `p-0` card with a bordered header — so the entire lower half of the page
 * re-flowed the moment data landed.
 *
 * TEN visible columns, not the thirteen defined. `StudentDataTable` ships
 * `enroleeNumber`, `nationality` and `lastUpdated` hidden via
 * `initialColumnVisibility` (plus nine `stage_*` facet-only columns, since
 * this page passes `showPipeline`), leaving name, student #, level, section,
 * house, status, pipeline, staleness, submitted and the row actions — this
 * page is the one caller that turns on all three of `showSubmittedColumn`,
 * `showStaleness` and `showPipeline`.
 *
 * Grid classes are the page's own `@container/main` ones, passed via `grid`:
 * `className` would leave the archetype's `sm:`/`lg:` defaults applying too.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-44" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
          {/* AySwitcher. */}
          <Skeleton className="h-9 w-40" />
        </div>
      </header>

      {/* Three funnel-stage cards. `StageStat` always renders its footer (the
          progress rail + percentage are unconditional markup), so `footer`
          stays at the archetype default. */}
      <section className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
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
          <Skeleton className="h-9 w-full md:max-w-md" />
        </CardContent>
        <CardFooter>
          <SkeletonText variant="label" className="w-2/3" />
        </CardFooter>
      </Card>

      {/* Applications table — a `p-0` card with a bordered header, the
          DataTable flush inside it. Toolbar controls are h-8: search, three
          facets, the Staleness facet, the "Stage filters" group dropdown,
          then Export CSV and Columns on the right. The four-bucket status
          strip (All / Submitted / Ongoing Verification / Processing) sits
          between the toolbar and the table. */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText variant="micro" className="w-44" />
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
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="ml-auto h-8 w-28" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-10 w-lg max-w-full rounded-md" />
            {/* `pagination` on: the bar renders whenever the filtered set has
                at least one row, and this is the admissions team's working
                list of every application still in the pipeline. */}
            <SkeletonTable columns={10} rows={12} toolbar={false} pagination />
          </div>
        </CardContent>
      </Card>

      {/* Trust strip. */}
      <div className="mt-2 border-t border-border pt-5">
        <SkeletonText variant="micro" className="w-96 max-w-full" />
      </div>
    </PageShell>
  );
}

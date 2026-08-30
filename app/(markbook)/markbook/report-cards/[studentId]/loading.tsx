import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/report-cards/[studentId]/page.tsx` — change
 * them together.
 *
 * Chrome first, because the old loader had it wrong: this page does NOT use
 * `PageShell`. It is a `space-y-6` wrapper holding a `max-w-[8.5in]` control
 * column (back link, hero, term tabs, publication status) above the report
 * card `<article>`, which is itself `max-w-[8.5in]`. The previous loader
 * wrapped everything in `PageShell` — `max-w-360 space-y-8` — so the fallback
 * was laid out at nearly triple the width of the page it stood in for, and
 * every element on it moved when the card arrived.
 *
 * The document region is composed against `report-card-document.tsx` rather
 * than an archetype: that file draws a RAW `<table>` on a print surface, not
 * the `<Table>` primitive, so `SkeletonTable` would introduce exactly the
 * drift the archetypes exist to remove. Term columns are data-dependent
 * (Terms 1-3 at an interim term, four plus a Final column at T4); three are
 * drawn as the common case.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6">
        <SkeletonText variant="body" className="w-[132px]" />

        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[200px]" />
            <SkeletonText variant="headline" className="w-[280px] max-w-full" />
            <SkeletonText variant="body" className="w-[220px]" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-[104px]" />
          </div>
        </header>

        {/* Term tabs + the sentence under them. */}
        <div className="space-y-2">
          <Skeleton className="h-9 w-[280px] max-w-full" />
          <SkeletonText variant="label" className="w-full max-w-full" />
        </div>
      </div>

      {/* The report card itself. */}
      <article className="mx-auto w-full max-w-[8.5in] overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Letterhead band. */}
        <div className="flex items-center gap-4 border-b border-border px-8 py-6">
          <Skeleton className="size-14 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <SkeletonText variant="title" className="w-[280px] max-w-full" />
            <SkeletonText variant="micro" className="w-[200px] max-w-full" />
          </div>
        </div>

        <div className="space-y-8 px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
          <header className="flex flex-col items-center gap-1 border-b border-border pb-5">
            <SkeletonText variant="micro" className="w-[140px]" />
            <SkeletonText variant="title" className="h-[26px] w-[240px]" />
          </header>

          {/* Student info card — four labelled rows in two columns. */}
          <section className="rounded-xl border border-border bg-muted/40 p-5">
            <SkeletonText variant="micro" className="mb-3 w-[64px]" />
            <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4"
                >
                  <SkeletonText variant="body" className="w-[38%]" />
                  <SkeletonText variant="body" className="w-[46%]" />
                </div>
              ))}
            </div>
          </section>

          {/* Academic grades — subject rows against three term columns. */}
          <section className="space-y-3">
            <SkeletonText variant="title" className="w-[200px]" />
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-4 bg-muted/60 px-4 py-2.5">
                <SkeletonText variant="micro" className="w-[86px]" />
                <SkeletonText variant="micro" className="ml-auto w-[44px]" />
                <SkeletonText variant="micro" className="w-[44px]" />
                <SkeletonText variant="micro" className="w-[44px]" />
              </div>
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-t border-border px-4 py-2"
                >
                  <SkeletonText variant="body" className="w-[38%]" />
                  <SkeletonText variant="body" className="ml-auto w-[44px]" />
                  <SkeletonText variant="body" className="w-[44px]" />
                  <SkeletonText variant="body" className="w-[44px]" />
                </div>
              ))}
            </div>
          </section>

          {/* Adviser comments. */}
          <section className="space-y-3">
            <SkeletonText variant="title" className="w-[220px]" />
            <div className="space-y-2 rounded-xl border border-border p-5">
              <SkeletonText variant="body" className="w-full" />
              <SkeletonText variant="body" className="w-[92%]" />
              <SkeletonText variant="body" className="w-[74%]" />
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}

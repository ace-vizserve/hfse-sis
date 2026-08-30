import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(evaluation)/evaluation/sections/[sectionId]/page.tsx` — change
 * this file when that page changes.
 *
 * NO archetype: `WriteupRosterClient` is a bespoke editor, not a `DataTable`.
 * Each roster entry is an `<li>` on `md:grid-cols-[240px_1fr_auto]` carrying a
 * four-row `<textarea>`, so a row is roughly 150px, not the ~53px a table row
 * is. The version this replaces drew fifteen `h-14` bars, which is under a
 * third of the real height per student — on a 25-student section that is
 * thousands of pixels of jump.
 *
 * It also drew a two-button strip where the header's right side is a single
 * `TermSwitcher` under a "Term" label, and no virtue-theme banner at all.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonText variant="body" className="w-[92px]" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <SkeletonText variant="eyebrow" className="w-[190px]" />
          {/* Section name, then the level and AY badges, on one baseline. */}
          <div className="flex flex-wrap items-baseline gap-3">
            <SkeletonText variant="headline" className="w-[260px] max-w-full" />
            <Skeleton className="h-7 w-[92px]" />
            <Skeleton className="h-7 w-[86px]" />
          </div>
          <SkeletonText variant="body" className="w-[32rem] max-w-full" />
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <SkeletonText variant="micro" className="w-[36px]" />
          <Skeleton className="h-9 w-[180px]" />
        </div>
      </header>

      {/* Virtue-theme banner — always present, as either the theme or the
          "not set" warning. */}
      <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <SkeletonText variant="micro" className="w-[200px]" />
        <SkeletonText variant="title" className="w-[160px]" />
        <SkeletonText variant="micro" className="w-[86%]" />
      </div>

      {/* WriteupRosterClient — the explainer/summary strip, then the roster. */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
          <SkeletonText variant="label" className="w-[280px] max-w-full" />
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-[86px] rounded-full" />
            ))}
          </div>
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {Array.from({ length: 8 }).map((_, i) => (
            <li
              key={i}
              className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[240px_1fr_auto]"
            >
              <div className="min-w-0 space-y-1">
                <SkeletonText variant="body" className="w-[80%]" />
                <SkeletonText variant="micro" className="w-[54%]" />
                <Skeleton className="h-5 w-[96px] rounded-full" />
              </div>
              {/* rows={4} textarea. */}
              <div
                aria-hidden
                className="h-[104px] w-full rounded-md border border-input bg-transparent"
              />
              <div className="flex items-start gap-2">
                <Skeleton className="h-8 w-[108px]" />
                <Skeleton className="h-8 w-[80px]" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}

import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/ay-setup/page.tsx` (and the `AySetupHeader` it
 * renders) — change this file when either changes.
 *
 * NO PageShell: `loading.js` nests inside `layout.js`, and this route's layout
 * is exactly `<PageShell>{children}</PageShell>`. The header IS the page's,
 * though — `AySetupHeader` is a component, not a layout (its readiness chip
 * reads `?ay=`, which a layout never sees) — so it is drawn here.
 *
 * The version this replaces drew a header with no back link and no tab strip,
 * then two plain rounded blocks (h-64 + h-96) where the checklist's picker row
 * and one `Card` of ten `px-6 py-4` step rows go.
 */
export default function Loading() {
  return (
    <>
      {/* AySetupHeader — SisPageHeader (back link, eyebrow, title, description,
          AY + readiness chips, "New AY" action) then the two-tab PageTabNav. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[168px]" />
            <SkeletonText variant="headline" className="w-[280px] max-w-full" />
            <SkeletonText variant="body" className="w-[32rem] max-w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-[86px]" />
            <Skeleton className="h-7 w-[104px]" />
            <Skeleton className="h-8 w-[110px]" />
          </div>
        </header>
      </div>

      <Skeleton className="h-9 w-[240px] rounded-lg" />

      <div className="mt-6">
        {/* YearSetupChecklist — AY picker + status badge, then one Card whose
            body is a `divide-y` list of the ten readiness steps. */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-[200px]" />
            <Skeleton className="h-6 w-[92px]" />
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="gap-1.5 border-b border-border py-5">
              <SkeletonText variant="micro" className="w-[110px]" />
              <SkeletonText variant="title" className="w-[280px] max-w-full" />
              <SkeletonText variant="body" className="w-[22rem] max-w-full" />
            </CardHeader>
            <ul className="divide-y divide-border">
              {Array.from({ length: 10 }).map((_, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-start gap-4 px-6 py-4"
                >
                  <Skeleton className="size-10 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonText
                      variant="body"
                      className="w-[42%] min-w-[160px]"
                    />
                    <SkeletonText
                      variant="label"
                      className="w-[28%] min-w-[120px]"
                    />
                  </div>
                  <Skeleton className="h-6 w-[96px] shrink-0" />
                  <Skeleton className="h-8 w-[120px] shrink-0" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

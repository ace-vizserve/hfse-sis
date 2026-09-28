import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/cohorts/class-chosen/page.tsx` — change
 * this file when it changes.
 *
 * Same header voice as the other cohorts, minus the CSV button (this page
 * exports from the table toolbar). `ClassChosenTable` has SEVEN visible columns
 * (student, enrolee number, year, chosen class, application status, still
 * needed, class chosen), two facets and a three-tab status strip.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-2">
        <SkeletonText variant="micro" className="w-52" />
        <div className="flex items-baseline gap-3">
          {/* `font-serif text-2xl` — a 32px line box, the `stat` voice. */}
          <SkeletonText variant="stat" className="w-72 max-w-full" />
          <Skeleton className="h-6 w-24" />
        </div>
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="ml-auto h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-10 w-80 max-w-full rounded-md" />
        {/* No `pagination`: the bar renders only when the list is non-empty,
            and on most days nobody may be waiting. */}
        <SkeletonTable columns={7} rows={10} toolbar={false} />
      </div>
    </PageShell>
  );
}

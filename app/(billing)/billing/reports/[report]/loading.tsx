import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `reports/[report]/page.tsx` — back link, hero with its actions,
 *  the period fields, then the report card: company, title, date, rows. */
export default function Loading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-5 w-32" />
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-36" />
            <SkeletonText variant="headline" className="w-[28rem] max-w-full" />
            <SkeletonText variant="body" className="w-96 max-w-full" />
          </div>
          <Skeleton className="h-10 w-96 max-w-full" />
        </header>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-16 w-48" />
        <Skeleton className="h-16 w-44" />
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="space-y-2 border-b border-border p-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

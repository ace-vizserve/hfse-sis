import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `reports/[report]/page.tsx` — back link and title with Customize
 *  / Save As, the period controls, then the report "paper": its toolbar,
 *  company, title, date, rows. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <div className="flex items-center justify-between gap-4">
          <SkeletonText variant="headline" className="w-[28rem] max-w-full" />
          <Skeleton className="h-10 w-48" />
        </div>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-14 w-44" />
        <Skeleton className="h-14 w-40" />
      </div>
      <div className="mx-auto w-full max-w-6xl rounded-xl border border-border">
        <div className="flex justify-between border-b border-border px-4 py-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="flex flex-col items-center gap-2 px-6 pt-7 pb-5">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="space-y-2 px-4 pb-6">
          <Skeleton className="h-10" />
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

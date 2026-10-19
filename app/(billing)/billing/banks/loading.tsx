import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/** Mirrors `banks/page.tsx` — hero, one tile per bank account, then the
 *  register card (title + Ending balance, period, table). */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-48" />
          <SkeletonText variant="headline" className="w-72 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-10 w-56" />
      </header>
      <SkeletonCards
        count={4}
        grid="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      />
      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-end justify-between gap-4">
          <SkeletonText variant="headline" className="w-64 max-w-full" />
          <Skeleton className="h-10 w-48" />
        </div>
        <Skeleton className="h-10 w-80 max-w-full" />
        <SkeletonTable columns={8} rows={10} />
      </div>
    </PageShell>
  );
}

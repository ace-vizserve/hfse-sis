import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/** Mirrors `accounts/page.tsx` — hero, three stat tiles, the table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-48" />
          <SkeletonText variant="headline" className="w-80 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-10 w-72" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>
      <SkeletonTable columns={5} rows={12} />
    </PageShell>
  );
}

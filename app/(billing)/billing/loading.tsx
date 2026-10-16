import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/** Mirrors `app/(billing)/billing/page.tsx` — header, four stat cards, the table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-40" />
          <SkeletonText variant="headline" className="w-64 max-w-full" />
          <SkeletonText variant="body" className="w-120 max-w-full" />
        </div>
        <Skeleton className="h-9 w-56" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>
      <SkeletonTable columns={7} rows={10} />
    </PageShell>
  );
}

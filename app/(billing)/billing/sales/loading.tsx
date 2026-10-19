import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `sales/page.tsx` — header, money bar, filters, table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-72 max-w-full" />
        <SkeletonText variant="body" className="w-96 max-w-full" />
      </header>
      <Skeleton className="h-32 rounded-xl" />
      <div className="flex gap-3">
        <Skeleton className="h-14 w-44" />
        <Skeleton className="h-14 w-44" />
      </div>
      <SkeletonTable columns={6} rows={10} />
    </PageShell>
  );
}

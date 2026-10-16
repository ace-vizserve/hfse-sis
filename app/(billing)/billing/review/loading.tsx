import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `review/page.tsx` — back link, header, year tabs, the table. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-28" />
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-64 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>
      <Skeleton className="h-9 w-72" />
      <SkeletonTable columns={4} rows={8} />
    </PageShell>
  );
}

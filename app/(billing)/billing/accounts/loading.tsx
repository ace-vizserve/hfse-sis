import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `accounts/page.tsx` — header, filter + type, the accounts table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-80 max-w-full" />
        <SkeletonText variant="body" className="w-96 max-w-full" />
      </header>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-64" />
      </div>
      <SkeletonTable columns={5} rows={12} />
    </PageShell>
  );
}

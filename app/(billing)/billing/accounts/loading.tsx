import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `accounts/page.tsx` — breadcrumb + title, filter + type, table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <SkeletonText variant="body" className="w-48" />
        <SkeletonText variant="headline" className="w-80 max-w-full" />
      </header>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-64" />
      </div>
      <SkeletonTable columns={5} rows={12} />
    </PageShell>
  );
}

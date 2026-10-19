import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `banks/page.tsx` — breadcrumb + title, account dropdown and
 *  Ending balance, the paging line, the register. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <SkeletonText variant="body" className="w-64" />
        <SkeletonText variant="headline" className="w-72 max-w-full" />
        <div className="flex items-end justify-between gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-10 w-40" />
        </div>
      </header>
      <Skeleton className="ml-auto h-8 w-96 max-w-full" />
      <SkeletonTable columns={8} rows={10} />
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/admin/parent-portal/page.tsx` — change this file when
 * that page changes. Both tabs have the same shape: header, tabs, three stat
 * tiles, then the titled card with the table.
 */
export default function Loading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[168px]" />
          <SkeletonText variant="headline" className="w-[260px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </header>
      </div>

      <Skeleton className="h-10 w-[260px] rounded-md" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>

      <Skeleton className="h-96 w-full rounded-xl" />
    </PageShell>
  );
}

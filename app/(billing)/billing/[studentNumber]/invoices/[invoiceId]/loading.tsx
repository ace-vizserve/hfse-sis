import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors the invoice page — back link, header, four stat cards, lines + side cards. */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-40" />
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-56" />
          <SkeletonText variant="headline" className="w-96 max-w-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-9 w-96 max-w-full" />
      </header>
      <div className="@container/main">
        <SkeletonCards
          count={4}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-4"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </PageShell>
  );
}

import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/components/ui/page-shell';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-20" />
      <div className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </PageShell>
  );
}

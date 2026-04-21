import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-32" />

      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </header>

      <Skeleton className="h-64 w-full rounded-xl" />

      <Skeleton className="h-96 w-full rounded-xl" />
    </PageShell>
  );
}

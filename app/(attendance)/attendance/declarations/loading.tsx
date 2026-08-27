import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-9 w-56" />
      </div>

      <Skeleton className="h-96 w-full rounded-xl" />
    </PageShell>
  );
}

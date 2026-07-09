import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>

      <section className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </section>

      <section className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </section>

      <section className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </section>
    </PageShell>
  );
}

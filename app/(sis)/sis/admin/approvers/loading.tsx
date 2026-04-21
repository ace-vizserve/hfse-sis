import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-32" />

      <header className="space-y-3">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </header>

      <div className="space-y-6">
        {Array.from({ length: 1 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-hairline bg-white p-0">
            <div className="space-y-2 border-b border-hairline bg-muted/40 px-6 py-4">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3 w-[24rem] max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

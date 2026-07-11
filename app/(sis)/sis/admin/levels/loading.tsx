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

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-9 w-56 rounded-md" />
      </div>

      <div className="space-y-2 rounded-xl border border-hairline bg-white p-0">
        <div className="space-y-2 border-b border-hairline bg-muted/40 px-6 py-4">
          <Skeleton className="h-5 w-56" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-4">
              <Skeleton className="h-6 w-12 rounded-md" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-8 w-56 rounded-md" />
              <Skeleton className="ml-auto h-6 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

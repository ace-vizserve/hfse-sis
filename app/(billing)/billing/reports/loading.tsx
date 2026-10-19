import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `reports/page.tsx` — header, then a card per report group. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-56 max-w-full" />
        <SkeletonText variant="body" className="w-96 max-w-full" />
      </header>
      {[5, 1].map((n, g) => (
        <div
          key={g}
          className="space-y-4 rounded-xl border border-border px-6 py-5"
        >
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
            {Array.from({ length: n }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}

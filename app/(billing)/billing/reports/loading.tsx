import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `reports/page.tsx` — hero, the search box, then Favorites and a
 *  card per report group. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-32" />
        <SkeletonText variant="headline" className="w-56 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>
      <Skeleton className="h-10 w-full max-w-md" />
      {[1, 12, 1].map((n, g) => (
        <div
          key={g}
          className="space-y-4 rounded-xl border border-border bg-card p-6"
        >
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
            {Array.from({ length: n }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}

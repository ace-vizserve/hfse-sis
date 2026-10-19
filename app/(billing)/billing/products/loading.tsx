import { PageShell } from '@/components/ui/page-shell';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `products/page.tsx` — header, table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-40" />
        <SkeletonText variant="headline" className="w-72 max-w-full" />
        <SkeletonText variant="body" className="w-96 max-w-full" />
      </header>
      <SkeletonTable columns={5} rows={10} />
    </PageShell>
  );
}

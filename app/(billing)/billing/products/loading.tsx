import { PageShell } from '@/components/ui/page-shell';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/** Mirrors `products/page.tsx` — breadcrumb + title, then the table. */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <SkeletonText variant="body" className="w-40" />
        <SkeletonText variant="headline" className="w-72 max-w-full" />
      </header>
      <SkeletonTable columns={9} rows={10} />
    </PageShell>
  );
}

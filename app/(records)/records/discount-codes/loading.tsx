import { PageShell } from '@/components/ui/page-shell';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/discount-codes/page.tsx` — change this file
 * when that one changes.
 *
 * That page is a redirect stub: the discount-code catalogue moved to SIS Admin
 * in 2026-04, and the component's whole body forwards to
 * `/sis/admin/discount-codes`. There is no shape here to mirror, so the loader
 * it replaces — a hero, an AY switcher, four stat cards and a tall table
 * block — was drawing a page that no longer exists at this path. It stays
 * minimal on purpose: it shows for the instant the redirect takes, then the
 * destination's own loader takes over.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-48" />
        <SkeletonText variant="headline" className="w-72 max-w-full" />
      </header>
    </PageShell>
  );
}

import { PageShell } from '@/components/ui/page-shell';
import { SkeletonDetail } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/sections/[id]/page.tsx` — change them
 * together.
 *
 * That page is a REDIRECT STUB: it awaits `params` and sends the visitor to
 * `/classroom/[id]`, so it renders no content of its own. The old loader here
 * drew a full roster — stat cards, a filter bar, fifteen row bars — for a page
 * that has not existed since the Classroom module superseded it, and none of
 * it ever matched what landed.
 *
 * A bare masthead is the honest fallback: it holds the page's own chrome for
 * the moment the redirect resolves, and deliberately does NOT mirror
 * `/classroom/[id]`, which owns its own loader.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonDetail />
    </PageShell>
  );
}

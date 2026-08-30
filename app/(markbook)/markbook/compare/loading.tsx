import { PageShell } from '@/components/ui/page-shell';
import { SkeletonDetail } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/compare/page.tsx` — change them together.
 *
 * That page is a REDIRECT STUB: Markbook's Compare surface was replaced by
 * Academic Performance Insights, and the route now only forwards to
 * `/markbook/insights`. It renders no content of its own, so the old loader
 * here — a filter row, six tiles and a chart block — described a page that no
 * longer exists and nothing it drew ever landed.
 *
 * A bare masthead is the honest fallback for the instant the redirect
 * resolves. It deliberately does NOT mirror the Insights page, which has its
 * own loader.
 */
export default function Loading() {
  return (
    <PageShell>
      <SkeletonDetail />
    </PageShell>
  );
}

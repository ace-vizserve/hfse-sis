import { PageShell } from '@/components/ui/page-shell';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(records)/records/compare/page.tsx` — change this file when
 * that one changes.
 *
 * That page is a redirect stub: Compare was replaced by Records → Insights,
 * and the component's whole body is `redirect('/records/insights')`. It
 * therefore has NO shape to mirror, and the loader it used to carry — a hero,
 * a filter row, six stat tiles and a chart — drew a page that has not existed
 * for months. Anything more than a header bar here is a picture of a screen
 * the visitor will never see, so this deliberately stays minimal: it shows
 * for the instant the redirect takes and is replaced by the Insights page's
 * own loader.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-32" />
        <SkeletonText variant="headline" className="w-60 max-w-full" />
      </header>
    </PageShell>
  );
}

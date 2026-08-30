import { PageShell } from '@/components/ui/page-shell';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/compare/page.tsx` — change this file
 * when that one changes.
 *
 * That page is a REDIRECT STUB: Admissions Compare was replaced by the
 * Enrollment Health insights surface, and the component's whole body is
 * `redirect('/admissions/insights')`. It renders nothing of its own, so the
 * loader it used to carry — a header, a three-control filter row, six tiles
 * and a chart block — drew a screen that has not existed for months, and not
 * one of those bars ever had a real element to hand over to.
 *
 * A bare masthead is the honest fallback for the instant the redirect takes.
 * It deliberately does NOT mirror `/admissions/insights`, which has its own
 * loader and paints as soon as the redirect resolves.
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

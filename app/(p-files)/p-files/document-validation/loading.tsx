import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(p-files)/p-files/document-validation/page.tsx` — change this
 * file when that page changes.
 *
 * NO PageShell, NO header and NO tab strip, deliberately. `loading.js` nests
 * inside `layout.js`, and this route's layout already renders the `PageShell`,
 * the "Document validation" header and the three-queue `PageTabNav` (with its
 * badge counts). The version this replaces drew a header and a tab strip of
 * its own, so the fallback painted a second eyebrow, headline, description and
 * tab row under the real ones.
 *
 * What the page itself contributes is small: a one-line summary sentence and
 * `AwaitingQueue`, inside `space-y-3`.
 *
 * `AwaitingQueue` defines six columns and hides two
 * (`initialColumnVisibility: { levelApplied: false, classSection: false }`), so
 * FOUR are visible — document, owner, preview, row actions. Page size is 25 and
 * `hidePagination` is not set, so the pager renders inside the shell.
 */
export default function Loading() {
  return (
    <div className="space-y-3">
      <SkeletonText variant="body" className="w-[30rem] max-w-full" />
      <SkeletonTable columns={4} rows={10} pagination />
    </div>
  );
}

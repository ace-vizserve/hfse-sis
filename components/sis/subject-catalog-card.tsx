import { ListChecks } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CatalogSubjectRow } from '@/lib/sis/subjects/queries';

// Step ① "Subjects" — STUB (Task 1 of the "Unified Subject Setup page"
// plan; docs: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
// Task 2 replaces this file's body with the real merged catalog + tune
// table (tri-state Offered toggle + MIXED confirm flow, inline
// "needs attention" fix, "+ Add subject" drawer, per-row Edit drawer).
//
// The prop surface below is already the real data shape Task 2 needs —
// `catalog` is exactly `lib/sis/subjects/queries.ts::listCatalogForLevelType`'s
// output, already fetched + level-scoped by the page — so Task 2 only has
// to edit THIS file; `app/(sis)/sis/admin/subjects/page.tsx` stays
// untouched.
export function SubjectCatalogCard({
  catalog,
  levelLabel,
  ayCode,
}: {
  catalog: CatalogSubjectRow[];
  levelLabel: string;
  ayCode: string;
}) {
  // Placeholder-only tally — see CatalogSubjectRow.needsAttention's doc
  // comment (lib/sis/subjects/queries.ts) for why this under-counts
  // GP/COMP/ARTD/PESTD today; Task 2 derives the real flag from the raw
  // fields this row already carries, not from this count.
  const needsAttentionCount = catalog.filter((c) => c.needsAttention).length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <ListChecks className="size-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            ① Subjects
          </p>
          <p className="truncate font-serif text-[16px] font-semibold text-foreground">
            {levelLabel}&apos;s catalog for {ayCode}
          </p>
        </div>
        {needsAttentionCount > 0 && (
          <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-brand-amber-light px-2.5 py-1 font-mono text-[10px] font-semibold text-brand-amber">
            {needsAttentionCount} need{needsAttentionCount === 1 ? 's' : ''}{' '}
            attention
          </span>
        )}
      </div>

      <div className="space-y-3 border-t border-border px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Coming in the next task — the merged catalog + tune table, one row per
          subject offered (or offerable) at this level.{' '}
          {catalog.length > 0
            ? `${catalog.length} subject${catalog.length === 1 ? '' : 's'} ready to show.`
            : 'Nothing in the catalog for this level yet.'}
        </p>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </div>
    </Card>
  );
}

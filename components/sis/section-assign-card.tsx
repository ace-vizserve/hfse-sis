import { ListTree } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { SectionWithSubjectsRow } from '@/lib/sis/subjects/queries';

// Step ② "Assign to sections" — STUB (Task 1 of the "Unified Subject Setup
// page" plan; docs: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
// Task 3 replaces this file's body with the real per-section
// full-catalog checklist (checked = attached, "Recommended" tag from the
// resolved track bundle, inline track selector, Mother-Tongue radio) +
// the Global/Standard bulk-flag buttons + confirm modal.
//
// The prop surface below is already the real data shape Task 3 needs —
// `sections` is exactly
// `lib/sis/subjects/queries.ts::listSectionsWithSubjectsForLevelType`'s
// output, already fetched + level-scoped by the page, with each section's
// specific level code + per-subject attached/recommended state already
// resolved server-side — so Task 3 only has to edit THIS file;
// `app/(sis)/sis/admin/subjects/page.tsx` stays untouched.
export function SectionAssignCard({
  sections,
  levelLabel,
}: {
  sections: SectionWithSubjectsRow[];
  levelLabel: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <ListTree className="size-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            ② Assign to sections
          </p>
          <p className="truncate font-serif text-[16px] font-semibold text-foreground">
            {levelLabel} sections
          </p>
        </div>
      </div>

      <div className="space-y-3 border-t border-border px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Coming in the next task — a per-section subject checklist, flagged
          Global or Standard, with sheets generated automatically once attached.{' '}
          {sections.length > 0
            ? `${sections.length} section${sections.length === 1 ? '' : 's'} at this level.`
            : 'No sections at this level yet.'}
        </p>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </Card>
  );
}

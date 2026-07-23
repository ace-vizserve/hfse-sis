import { FileQuestion } from 'lucide-react';
import { redirect } from 'next/navigation';

import { LevelMismatchesTable } from '@/components/sis/level-mismatches-table';
import { PageShell } from '@/components/ui/page-shell';
import { getLevelRows } from '@/lib/sis/levels';
import { loadUnmatchedLevelLabels } from '@/lib/sis/level-review';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /records/level-mismatches — reconciliation queue listing admissions
// `levelApplied` free-text values that don't canonicalize onto any known
// `public.levels` row (KD-#90-adjacent: surface the gap, one-click fix).
// The picker table posts to the Task 2.4 route (`/api/sis/level-aliases`)
// which persists an alias so the label resolves automatically from then on.
//
// Role-gate + import paths mirror `/records/unsynced/page.tsx` exactly
// (`getSessionUser` from `@/lib/supabase/server`, `PageShell` from
// `@/components/ui/page-shell`). Both loaders are already cached +
// tag-invalidated (`sis:${ayCode}` / `levels`), so the page just renders.

export default async function LevelMismatchesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role ?? '';
  if (
    role !== 'academic_coordinator' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();
  const [rows, levels] = await Promise.all([
    loadUnmatchedLevelLabels(),
    getLevelRows(service),
  ]);

  const countLabel =
    rows.length === 0
      ? 'Every observed level name currently resolves to a known level.'
      : `${rows.length.toLocaleString('en-SG')} level name${rows.length === 1 ? '' : 's'} from admissions data don't match a known level yet — map each one once and it resolves automatically from then on.`;

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Operations
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Level naming to review
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {countLabel}
        </p>
      </header>

      <LevelMismatchesTable
        rows={rows}
        levels={levels.map((l) => ({ id: l.id, code: l.code, label: l.label }))}
      />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FileQuestion className="size-3" strokeWidth={2.25} />
        <span>Current + upcoming AY</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}

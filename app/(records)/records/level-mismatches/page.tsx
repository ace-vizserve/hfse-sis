import { FileQuestion } from 'lucide-react';
import { redirect } from 'next/navigation';

import { LevelMismatchesTable } from '@/components/sis/level-mismatches-table';
import { LevelsAwaitingSectionsCard } from '@/components/sis/levels-awaiting-sections-card';
import { PageShell } from '@/components/ui/page-shell';
import { getLevelRows } from '@/lib/sis/levels';
import { loadUnmatchedLevelLabels } from '@/lib/sis/level-review';
import { loadLevelsAwaitingSections } from '@/lib/sis/levels-awaiting-sections';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /records/level-mismatches — the two things that stop a student being put in
// a class, on one page, because a registrar treats them as one job.
//
//   1. No class to put them in — the level resolves, the student is Enrolled,
//      and the AY has no section at that level. `lib/sis/levels-awaiting-
//      sections.ts`. Listed FIRST: real students are already stuck behind it,
//      and it is the one a registrar can act on immediately.
//   2. Level names we don't recognise — an admissions `levelApplied` free-text
//      value that canonicalizes onto no known `public.levels` row.
//      `lib/sis/level-review.ts`. The picker posts to `/api/sis/level-aliases`,
//      which persists an alias so the label resolves from then on (and, since
//      the review queue reads that same alias table, drops the row from this
//      list).
//
// Role-gate + import paths mirror `/records/unsynced/page.tsx` exactly
// (`getSessionUser` from `@/lib/supabase/server`, `PageShell` from
// `@/components/ui/page-shell`). All three loaders are already cached +
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
  const [rows, awaitingSections, levels] = await Promise.all([
    loadUnmatchedLevelLabels(),
    loadLevelsAwaitingSections(),
    getLevelRows(service),
  ]);

  const blockedCount = rows.length + awaitingSections.length;
  const summary =
    blockedCount === 0
      ? 'Nothing is blocking enrolment. Every level name is recognised, and every level with students waiting has a class.'
      : 'Students can only be assigned to a class once their level is recognised and that level has a class to put them in. Anything still missing is below.';

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Operations
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Levels needing attention
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {summary}
        </p>
      </header>

      <LevelsAwaitingSectionsCard rows={awaitingSections} />

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Level names we don&apos;t recognise
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {rows.length === 0
              ? 'Every level name coming from admissions matches a level you already have.'
              : `${rows.length.toLocaleString('en-SG')} level name${rows.length === 1 ? '' : 's'} from admissions don't match a level you have. Map each one once and it is recognised from then on.`}
          </p>
        </div>

        <LevelMismatchesTable
          rows={rows}
          levels={levels.map((l) => ({
            id: l.id,
            code: l.code,
            label: l.label,
          }))}
        />
      </section>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FileQuestion className="size-3" strokeWidth={2.25} />
        <span>Current + upcoming AY</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}

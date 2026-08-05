import { UserX } from 'lucide-react';
import { redirect } from 'next/navigation';

import {
  UnsyncedStudentsQueue,
  type AssignableLevelSections,
} from '@/components/sis/unsynced-students-queue';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { listAssignableSections } from '@/lib/sis/class-assignment';
import { sectionMapKey } from '@/lib/sis/section-map-key';
import { loadUnsyncedInScope } from '@/lib/sis/unsynced-students';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /records/unsynced — operational queue listing enrolled students whose
// admissions row says they're enrolled but who never made it into the
// grading schema. Per Hard Rule #4 the gap is usually a missing
// `classSection`; the "Assign section" CTA in the queue opens the
// AssignSectionDialog from Chunk A and unblocks them.
//
// Role-gate matches the records layout (registrar / school_admin /
// superadmin). The lib loader is already cached + tag-invalidated via
// `sis:${ayCode}`, so the page just renders rows + builds the per-level
// section map for inline dialog mounting.

export default async function UnsyncedStudentsPage() {
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

  const currentAy = await getCurrentAcademicYear();
  if (!currentAy) {
    return (
      <PageShell>
        <div className="rounded-xl border border-hairline bg-card p-6 text-center text-sm text-muted-foreground">
          No active academic year is set. Ask a system administrator to set one
          in Settings.
        </div>
      </PageShell>
    );
  }

  // Every year that can currently have someone waiting, not just the live one.
  // Admissions enrol into next year's intake during the early-bird window, and
  // a queue that only reads the current AY hides exactly that work.
  const rows = await loadUnsyncedInScope();

  // Build the section map up-front so each dialog open is pre-populated (no
  // per-row fetch on click). Keyed by AY **and** level: the same level has
  // different sections in different years, so a level-only key would offer a
  // registrar next year's classes for this year's student.
  const uniquePairs = Array.from(
    new Map(
      rows
        .filter(
          (r) =>
            typeof r.levelApplied === 'string' && r.levelApplied.trim().length
        )
        .map((r) => [
          sectionMapKey(r.ayCode, r.levelApplied!),
          { ayCode: r.ayCode, level: r.levelApplied! },
        ])
    ).values()
  );
  const sectionsByLevel = await loadSectionsForLevels(uniquePairs);

  const ayCount = new Set(rows.map((r) => r.ayCode)).size;
  const countLabel =
    rows.length === 0
      ? 'All enrolled students are set up — no action needed.'
      : `${rows.length.toLocaleString('en-SG')} student${rows.length === 1 ? '' : 's'} waiting for a class${ayCount > 1 ? ', across more than one academic year' : ''}.`;

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Waiting on setup
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Students needing setup
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Enrolled students who don&rsquo;t yet have access to grading and
          attendance because they haven&rsquo;t been given a class. {countLabel}
        </p>
      </header>

      <UnsyncedStudentsQueue rows={rows} sectionsByLevel={sectionsByLevel} />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <UserX className="size-3" strokeWidth={2.25} />
        <span>Current + upcoming AY</span>
        <span className="text-border">·</span>
        <span>Enrolled only</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Section lookup — one `listAssignableSections` call per distinct level,
// fanned out concurrently. Returns a map keyed by the level label exactly
// as it appears on the unsynced row's levelApplied field; level resolution
// (including alias-table lookups) is delegated entirely to the shared
// helper (Task 3.1) instead of a hand-rolled canonicalization pass.
// ──────────────────────────────────────────────────────────────────────────

async function loadSectionsForLevels(
  pairs: Array<{ ayCode: string; level: string }>
): Promise<Record<string, AssignableLevelSections>> {
  if (pairs.length === 0) return {};
  const service = createServiceClient();

  const entries = await Promise.all(
    pairs.map(
      async ({ ayCode, level }) =>
        [
          sectionMapKey(ayCode, level),
          await listAssignableSections(service, ayCode, level),
        ] as const
    )
  );

  return Object.fromEntries(entries);
}

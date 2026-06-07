import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { QuickViewHeader } from '@/components/markbook/academic-summary/quick-view-header';
import { CommentsView } from '@/components/markbook/academic-summary/comments-view';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Academic Summary → Comments quick-view (Task 9 of 14).
//
// Form Class Adviser write-up completion status (Submitted / Draft / Missing)
// per student per term (T1–T3 only — T4 has no FCA comment, KD #49).
// Read-only here — edits live in the Evaluation module (KD #49/#126).
//
// Mirrors attendance/page.tsx structure exactly: same role gate,
// resolveAcademicSummaryScope, ayQuery, empty-states, MasterfileToolbar,
// QuickViewHeader.

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string; class?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'registrar' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const scope = await resolveAcademicSummaryScope(sp);
  // Back-link preserves the full scope (AY + level + class) so returning to the
  // hub reopens the same view, not the default level.
  const backParams = new URLSearchParams({ ay: scope.ayCode });
  if (scope.selectedLevelId) backParams.set('level', scope.selectedLevelId);
  if (scope.selectedSectionId) backParams.set('class', scope.selectedSectionId);
  const ayQuery = `?${backParams.toString()}`;

  const subtitle =
    'Form Class Adviser write-up completion (Terms 1–3). Read-only here — edits stay in Evaluation.';

  // No academic year configured at all.
  if (scope.noAyRow) {
    return (
      <PageShell>
        <QuickViewHeader
          title="Comments"
          subtitle={subtitle}
          ayQuery={ayQuery}
        />
        <div className="text-sm text-destructive">
          No academic year configured.
        </div>
      </PageShell>
    );
  }

  // AY exists but no levels with sections.
  if (scope.empty || !scope.payload) {
    return (
      <PageShell>
        <QuickViewHeader
          title="Comments"
          subtitle={subtitle}
          ayQuery={ayQuery}
        />
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No levels with sections configured for this academic year.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <QuickViewHeader title="Comments" subtitle={subtitle} ayQuery={ayQuery} />

      <MasterfileToolbar
        ayCodes={scope.ayCodes}
        selectedAyCode={scope.ayCode}
        levels={scope.levels}
        selectedLevelId={scope.selectedLevelId}
        sections={scope.payload.sections}
        selectedSectionId={scope.selectedSectionId}
      />

      <CommentsView payload={scope.payload} />
    </PageShell>
  );
}

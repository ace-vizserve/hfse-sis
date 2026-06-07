import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { QuickViewHeader } from '@/components/markbook/academic-summary/quick-view-header';
import { AwardsView } from '@/components/markbook/academic-summary/awards-view';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Academic Summary → Awards quick-view (Task 7 of 14).
//
// Per-student award breakdown — Overall Academic Award or per-subject award —
// for the selected level/class. Full-year shows the official tier (Gold/Silver/
// Bronze/Not eligible); per-term shows provisional performance only (no tier).
//
// Table approach: plain shadcn <Table> primitives (same as masterfile-drill-sheet;
// per-class ≤ 50 rows; no TanStack / virtualization needed). Siblings (Attendance,
// Comments) should mirror this approach.

export default async function AwardsPage({
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
  const ayQuery = sp.ay ? `?ay=${encodeURIComponent(sp.ay)}` : '';

  // No academic year configured at all.
  if (scope.noAyRow) {
    return (
      <PageShell>
        <QuickViewHeader
          title="Awards"
          subtitle="Subject awards and the Overall Academic Award by student."
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
          title="Awards"
          subtitle="Subject awards and the Overall Academic Award. Pick a subject (or Overall) and a term — full-year shows the official award tier; a single term shows provisional performance."
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
      <QuickViewHeader
        title="Awards"
        subtitle="Subject awards and the Overall Academic Award. Pick a subject (or Overall) and a term — full-year shows the official award tier; a single term shows provisional performance."
        ayQuery={ayQuery}
      />

      <MasterfileToolbar
        ayCodes={scope.ayCodes}
        selectedAyCode={scope.ayCode}
        levels={scope.levels}
        selectedLevelId={scope.selectedLevelId}
        sections={scope.payload.sections}
        selectedSectionId={scope.selectedSectionId}
      />

      <AwardsView payload={scope.payload} />
    </PageShell>
  );
}

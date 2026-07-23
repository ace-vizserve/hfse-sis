import { redirect } from 'next/navigation';

import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { AwardsSummaryView } from '@/components/markbook/awards/awards-summary-view';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Awards — three-tier module page (relocated from Academic Summary, see
// docs/superpowers/plans/2026-07-22-academic-summary-module-redesign.md,
// Task 3). Guard + scope-resolution mirrors
// app/(records)/records/academic-summary/awards/page.tsx exactly; only the
// header and the mounted view differ (module page header + AwardsSummaryView
// instead of QuickViewHeader + AwardsView).

export default async function MarkbookAwardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string; class?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'academic_coordinator' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const scope = await resolveAcademicSummaryScope(sp);

  const header = (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Markbook · Academic awards
        </p>
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight text-foreground md:text-[38px]">
          Awards
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Subject and overall academic awards across a level, ranked best-first.
          Finalises when Term 4 grades are in.
        </p>
      </div>
    </header>
  );

  // No academic year configured at all.
  if (scope.noAyRow) {
    return (
      <div className="space-y-6">
        {header}
        <div className="text-sm text-destructive">
          No academic year configured.
        </div>
      </div>
    );
  }

  // AY exists but no levels with sections.
  if (scope.empty || !scope.payload) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No levels with sections configured for this academic year.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <MasterfileToolbar
        ayCodes={scope.ayCodes}
        selectedAyCode={scope.ayCode}
        levels={scope.levels}
        selectedLevelId={scope.selectedLevelId}
        sections={scope.payload.sections}
        selectedSectionId={scope.selectedSectionId}
      />

      <AwardsSummaryView payload={scope.payload} />
    </div>
  );
}

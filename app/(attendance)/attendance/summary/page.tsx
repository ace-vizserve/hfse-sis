import { notFound, redirect } from 'next/navigation';

import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { AttendanceSummaryView } from '@/components/attendance/summary/attendance-summary-view';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Attendance Summary — three-tier module page (relocated from Academic
// Summary, see
// docs/superpowers/plans/2026-07-22-academic-summary-module-redesign.md,
// Task 4). Guard mirrors app/(attendance)/attendance/insights/page.tsx
// (ALLOWED_ROLES set → redirect/notFound); scope-resolution mirrors
// app/(markbook)/markbook/awards/page.tsx exactly. Only the header and the
// mounted view differ (module page header + AttendanceSummaryView).

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

export default async function AttendanceSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string; class?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

  const sp = await searchParams;
  const scope = await resolveAcademicSummaryScope(sp);

  const header = (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Attendance · Class summary
        </p>
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight text-foreground md:text-[38px]">
          Attendance Summary
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Per-student present, late, and absent across a level, with attendance
          rate.
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

      <AttendanceSummaryView payload={scope.payload} />
    </div>
  );
}

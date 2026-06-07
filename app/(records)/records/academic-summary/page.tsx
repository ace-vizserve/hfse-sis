import { redirect } from 'next/navigation';

import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { MasterfileView } from '@/components/markbook/masterfile-view';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Academic Records Summary — the consolidated masterfile (KD #95). Lives in the
// Records module (whole-student outcomes) but reads grade data from the
// Markbook data layer (lib/markbook/masterfile*). Per-level cross-subject grid.
//
// URL params:
//   ?ay=<ay_code>       optional (defaults to current AY); demo can flip
//                        between AY9999 (active/operational) and AY9998
//                        (prior closed AY with full Final Grades + awards)
//                        without using the environment switcher
//   ?level=<level_id>   required (page redirects to first level if omitted)
//   ?class=<section_id> optional (filter to one class; omit for all classes)

export default async function AcademicSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{
    ay?: string;
    level?: string;
    class?: string;
    view?: string;
  }>;
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

  // Branch 1 (original "!ayRow"): the requested AY doesn't exist in academic_years.
  if (scope.noAyRow) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No academic year configured.
        </div>
      </PageShell>
    );
  }

  // Branch 2 (original "!selectedLevelId"): AY exists but no levels with sections.
  if (scope.empty || scope.selectedLevelId === null) {
    return (
      <PageShell>
        <header className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · Academic Summary
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Academic Records Summary.
          </h1>
          <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            The consolidated masterfile — every student&rsquo;s grades, status
            and remarks across all terms.
          </p>
        </header>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No levels with sections configured for this academic year. Sync the
          roster from Admissions or seed sections from the Master Template
          before reviewing the academic summary.
        </div>
      </PageShell>
    );
  }

  // Branch 3 (original "!payload"): loadMasterfile returned null.
  if (!scope.payload) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          Could not load academic summary data.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Academic Summary
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {scope.payload.level.label}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {scope.ayCode}
          </Badge>
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {scope.payload.rows.length}{' '}
            {scope.payload.rows.length === 1 ? 'student' : 'students'}
          </Badge>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          The consolidated masterfile — every student&rsquo;s grades, status and
          remarks across all terms. Award and General Average figures compute
          server-side; data still coming in shows as pending, never a fabricated
          grade. Switch to Table for the full grid, or Export to Excel for the
          complete masterfile sheet.
        </p>
      </header>

      <MasterfileToolbar
        ayCodes={scope.ayCodes}
        selectedAyCode={scope.ayCode}
        levels={scope.levels}
        selectedLevelId={scope.selectedLevelId}
        sections={scope.payload.sections}
        selectedSectionId={scope.selectedSectionId}
      />

      <MasterfileView
        payload={scope.payload}
        initialView={sp.view === 'table' ? 'table' : 'dashboard'}
      />

      <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Award thresholds · Bronze ≥ {scope.payload.thresholds.bronzeMin} ·
        Silver ≥ {scope.payload.thresholds.silverMin} · Gold ≥{' '}
        {scope.payload.thresholds.goldMin} · Editable in{' '}
        <span className="text-foreground">SIS Admin → School config</span>
      </p>
    </PageShell>
  );
}

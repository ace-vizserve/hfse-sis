import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AcademicOverviewView } from '@/components/markbook/academic-overview-view';
import { OverviewExportMenu } from '@/components/markbook/overview-export-menu';
import { OverviewFilterBar } from '@/components/markbook/overview-filter-bar';
import { Button } from '@/components/ui/button';
import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { MasterfileView } from '@/components/markbook/masterfile-view';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getAcademicOverview } from '@/lib/markbook/academic-overview';
import {
  resolveAcademicSummaryScope,
  type AcademicSummaryScope,
} from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Build a ?ay=…&level=…[&class=…] query string from the resolved scope so
// child routes (awards / attendance / comments) open scoped to the same cohort.
function buildScopeQuery(scope: AcademicSummaryScope): string {
  const params = new URLSearchParams();
  params.set('ay', scope.ayCode);
  if (scope.selectedLevelId) params.set('level', scope.selectedLevelId);
  if (scope.selectedSectionId) params.set('class', scope.selectedSectionId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

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
    subject?: string;
    term?: string;
    view?: string;
  }>;
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
  // The overview is the page. Every filter — grade level included — narrows it
  // in place rather than navigating somewhere with a different layout; the
  // per-level masterfile is reached deliberately, via ?view=masterfile.
  const wantsMasterfile = sp.view === 'masterfile';
  // On the overview path the level is a FILTER, not a scope the resolver should
  // load a masterfile for — so it is withheld here and applied to the overview
  // aggregate instead. Only ?view=masterfile hands the level through.
  const scope = await resolveAcademicSummaryScope(
    wantsMasterfile ? sp : { ay: sp.ay },
    { allowAllLevels: !wantsMasterfile }
  );

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
  //
  // ⚠ `allLevels` must be excluded here. The school-wide view deliberately has
  // no selected level, so the original `selectedLevelId === null` test — written
  // when null could only mean "this AY has no sections" — now also matches the
  // healthy all-levels state and would show the empty card instead of the page.
  if (!scope.allLevels && (scope.empty || scope.selectedLevelId === null)) {
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

  // School-wide: no level picked. Loads its own light aggregate rather than a
  // masterfile per level, and each ladder row links back into the per-level
  // dashboard below.
  if (scope.allLevels && scope.academicYearId) {
    // Unknown ids are dropped rather than shown as a chip full of UUID.
    const levelId =
      sp.level && scope.levels.some((l) => l.id === sp.level) ? sp.level : null;
    const termNumber =
      sp.term && /^[1-4]$/.test(sp.term) ? Number(sp.term) : null;
    const overview = await getAcademicOverview(
      scope.ayCode,
      scope.academicYearId,
      {
        levelId,
        sectionId: sp.class ?? null,
        subjectId: sp.subject ?? null,
        termNumber,
      }
    );
    return (
      <PageShell>
        {/* Canonical hero header (09a §8): title left, single action right. */}
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Records · Academic Summary
            </p>
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              Academic Summary
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              School-wide performance for {scope.ayCode}, across all grade
              levels. Pick a level to open its full masterfile.
            </p>
          </div>
          <OverviewExportMenu ayCode={scope.ayCode} />
        </header>

        <OverviewFilterBar
          ayCode={scope.ayCode}
          ayCodes={scope.ayCodes}
          options={overview.filterOptions}
          filters={overview.filters}
        />

        {levelId && (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/records/academic-summary?ay=${encodeURIComponent(scope.ayCode)}&level=${encodeURIComponent(levelId)}&view=masterfile`}
              >
                <FileSpreadsheet className="size-4" />
                Open full masterfile for this level
              </Link>
            </Button>
          </div>
        )}

        <AcademicOverviewView
          overview={overview}
          levelHref={(id) =>
            `/records/academic-summary?ay=${encodeURIComponent(scope.ayCode)}&level=${encodeURIComponent(id)}`
          }
        />
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
          automatically; data still coming in shows as pending, never a
          fabricated grade. Use the quick views for awards, attendance and
          comments, or Generate Masterfile for the full spreadsheet.
        </p>
      </header>

      <MasterfileToolbar
        ayCodes={scope.ayCodes}
        selectedAyCode={scope.ayCode}
        levels={scope.levels}
        selectedLevelId={scope.selectedLevelId}
        sections={scope.payload.sections}
        selectedSectionId={scope.selectedSectionId}
        allowAllLevels
      />

      <MasterfileView
        payload={scope.payload}
        scopeQuery={buildScopeQuery(scope)}
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

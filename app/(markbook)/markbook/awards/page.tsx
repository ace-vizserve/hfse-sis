import { redirect } from 'next/navigation';

import { AwardsOverviewView } from '@/components/markbook/awards/awards-overview-view';
import { OverviewFilterBar } from '@/components/markbook/overview-filter-bar';
import { awardsSelects } from '@/components/markbook/overview-filter-selects';
import { PageShell } from '@/components/ui/page-shell';
import { getAwardsOverview } from '@/lib/markbook/awards-overview';
import { OVERALL_CATEGORY } from '@/lib/markbook/awards-overview-compute';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

// Markbook · Awards — school-wide.
//
// Lands on the whole school and narrows in place, the same model Academic
// Summary uses (AY · Term · Grade · Section, with Award category where that
// page has Subject). It replaced a per-level view driven by the masterfile
// toolbar: the finding this page exists to surface — every Gold sitting in
// Primary One to Four, Secondary carrying none at any level — is invisible one
// level at a time.
//
// ⚠ For most of the year this page reports STANDING, not awards. See the header
// of lib/markbook/awards-overview-compute.ts before changing any wording.
//
// URL params (all optional; absent means "the whole school"):
//   ?ay=<ay_code>        academic year, defaults to the current one
//   ?level=<level_id>    one grade level
//   ?class=<section_id>  one class
//   ?term=<1-4>          one term — never settles an award
//   ?category=overall|<subject_id>   which award ladder

const ALLOWED_ROLES = new Set([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

export default async function MarkbookAwardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ay?: string;
    level?: string;
    class?: string;
    term?: string;
    category?: string;
  }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (!session.role || !ALLOWED_ROLES.has(session.role)) redirect('/');

  const sp = await searchParams;
  // Only the year is handed to the resolver — every other axis is a filter on
  // the aggregate, not a scope it should load a masterfile for.
  const scope = await resolveAcademicSummaryScope(
    { ay: sp.ay },
    { allowAllLevels: true }
  );

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
          Where every student stands against the school&rsquo;s award
          thresholds, and who is closest to moving up. Settles when Term 4
          grades are in.
        </p>
      </div>
    </header>
  );

  if (scope.noAyRow) {
    return (
      <PageShell>
        {header}
        <div className="text-sm text-destructive">
          No academic year configured.
        </div>
      </PageShell>
    );
  }

  if (!scope.academicYearId) {
    return (
      <PageShell>
        {header}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No levels with sections configured for this academic year.
        </div>
      </PageShell>
    );
  }

  // Unknown ids are dropped rather than shown as a chip full of UUID.
  const levelId =
    sp.level && scope.levels.some((l) => l.id === sp.level) ? sp.level : null;
  const termNumber =
    sp.term && /^[1-4]$/.test(sp.term) ? Number(sp.term) : null;

  const overview = await getAwardsOverview(scope.ayCode, scope.academicYearId, {
    levelId,
    sectionId: sp.class ?? null,
    termNumber,
    category: sp.category ?? OVERALL_CATEGORY,
  });

  // An unknown ?category would silently show an empty page, so fall back to the
  // overall ladder rather than reporting zero students under a heading nobody
  // asked for.
  const category = overview.filterOptions.categories.some(
    (c) => c.id === overview.filters.category
  )
    ? overview.filters.category
    : OVERALL_CATEGORY;
  const resolved =
    category === overview.filters.category
      ? overview
      : await getAwardsOverview(scope.ayCode, scope.academicYearId, {
          levelId,
          sectionId: sp.class ?? null,
          termNumber,
          category,
        });

  const levelHref = (id: string) => {
    const params = new URLSearchParams();
    params.set('ay', scope.ayCode);
    params.set('level', id);
    if (termNumber != null) params.set('term', String(termNumber));
    if (category !== OVERALL_CATEGORY) params.set('category', category);
    return `/markbook/awards?${params.toString()}`;
  };

  return (
    <PageShell>
      {header}

      <OverviewFilterBar
        ayCode={scope.ayCode}
        ayCodes={scope.ayCodes}
        selects={awardsSelects(resolved.filterOptions, resolved.filters)}
      />

      <AwardsOverviewView overview={resolved} levelHref={levelHref} />
    </PageShell>
  );
}

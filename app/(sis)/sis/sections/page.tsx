import { redirect } from 'next/navigation';
import { LayoutGrid, Users, UserX } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { NewSectionButton } from '@/components/markbook/new-section-button';
import { HubStat } from '@/components/sis/hub-stat';
import { SectionsNeededPanel } from '@/components/sis/sections-needed-panel';
import { SisSectionsDataTable } from '@/components/sis/sections-data-table';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { compareLevelLabels, getOfferedLevelIds } from '@/lib/sis/levels';
import { sgToday } from '@/lib/dates';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';
import { computeIndexStatus } from '@/lib/sis/section-index-status';
import type { Schedule } from '@/lib/schemas/section';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type SectionCard = {
  id: string;
  name: string;
  level_id: string;
  level_code: string;
  level_label: string;
  level_type: 'primary' | 'secondary' | 'unknown';
  schedule: Schedule | null;
  active: number;
  withdrawn: number;
  unnumbered: number;
};

export default async function SisSectionsListPage({
  searchParams,
}: {
  // Grade Levels' row menu deep-links here (?addSectionLevel=<id>) so
  // "Add section" from that page opens this page's New Section dialog
  // pre-filled, instead of landing the registrar on a blank page to
  // re-find the level they just came from.
  searchParams: Promise<{ addSectionLevel?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  // Compute termStarted = the school year's first term has begun (today ≥
  // earliest term start_date). Used to escalate the "Generate index" dialog
  // mid-year. We query terms for the current AY and check the minimum
  // start_date against sgToday() (SGT date — KD #32). A null start_date on
  // every term is treated as "not yet started" (conservative, no false
  // escalations during initial setup).
  let termStarted = false;
  if (ay) {
    const { data: terms } = await supabase
      .from('terms')
      .select('start_date')
      .eq('academic_year_id', ay.id)
      .order('start_date', { ascending: true });
    const today = sgToday();
    const earliestStart = (terms ?? [])
      .map((t) => t.start_date)
      .filter((d): d is string => !!d)
      .sort()[0];
    termStarted = !!earliestStart && earliestStart <= today;
  }

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select('id, name, schedule, level:levels(id, code, label, level_type)')
        .eq('academic_year_id', ay.id)
    : {
        data: [] as Array<{
          id: string;
          name: string;
          schedule: Schedule | null;
          level: LevelLite | LevelLite[] | null;
        }>,
      };

  // Level catalogue for the "New section" dialog + the "Sections needed"
  // gap panel below.
  type LevelCatalogRow = LevelLite & { is_core: boolean; sort_order: number };
  const { data: levelRows } = await supabase
    .from('levels')
    .select('id, code, label, level_type, is_core, sort_order')
    .order('sort_order');
  const levelCatalog = (levelRows ?? []) as LevelCatalogRow[];
  const levelOptions = levelCatalog.map((l) => ({
    id: l.id,
    code: l.code,
    label: l.label,
  }));

  // Validate against the real catalog — never trust a raw query param as a
  // level id.
  const initialAddSectionLevelId = levelOptions.some(
    (l) => l.id === sp.addSectionLevel
  )
    ? sp.addSectionLevel
    : undefined;

  // Which levels are actually meant to run this AY — core levels always
  // are; volatile levels need an ay_level_offerings row (KD #153). Feeds
  // the "Sections needed" gap below: a SHELVED level with no section is
  // fine (deliberately not running), an OFFERED one with no section is a
  // real gap — nobody can be enrolled there this year.
  const offeredLevelIds = ay
    ? await getOfferedLevelIds(supabase, ay.id)
    : new Set<string>();

  const ids = (sections ?? []).map((s) => s.id);
  const counts: Record<
    string,
    { active: number; withdrawn: number; unnumbered: number }
  > = {};
  if (ids.length > 0) {
    const { data: enrolments } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status, index_number')
      .in('section_id', ids);
    for (const row of enrolments ?? []) {
      const b = (counts[row.section_id] ??= {
        active: 0,
        withdrawn: 0,
        unnumbered: 0,
      });
      if (row.enrollment_status === 'withdrawn') b.withdrawn++;
      else {
        b.active++;
        if (row.index_number == null) b.unnumbered++;
      }
    }
  }

  const adviserMap = ay
    ? await loadFormAdvisersBySection(ids, ay.ay_code)
    : ({} as Record<string, { userId: string; name: string }>);

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? (l[0] ?? null) : l;

  const cards: SectionCard[] = (sections ?? []).map((s) => {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    return {
      id: s.id,
      name: s.name,
      level_id: lvl?.id ?? '',
      level_code: lvl?.code ?? '',
      level_label: lvl?.label ?? 'Unknown',
      level_type: (lvl?.level_type ?? 'unknown') as SectionCard['level_type'],
      schedule: ((s as { schedule?: Schedule | null }).schedule ??
        null) as Schedule | null,
      active: counts[s.id]?.active ?? 0,
      withdrawn: counts[s.id]?.withdrawn ?? 0,
      unnumbered: counts[s.id]?.unnumbered ?? 0,
    };
  });

  const totalSections = cards.length;
  const totalActive = cards.reduce((n, c) => n + c.active, 0);
  const totalWithdrawn = cards.reduce((n, c) => n + c.withdrawn, 0);

  // Offered levels (core, or volatile-and-switched-on) with zero sections
  // in this AY — the real "capture the grade level, make it easy to add a
  // section" gap.
  const levelIdsWithSections = new Set(
    cards.map((c) => c.level_id).filter(Boolean)
  );
  const levelsNeedingSection = levelCatalog
    .filter(
      (l) =>
        (l.is_core || offeredLevelIds.has(l.id)) &&
        !levelIdsWithSections.has(l.id)
    )
    .map((l) => ({ id: l.id, code: l.code, label: l.label }));

  // Derive unique level options sorted in canonical pedagogical order.
  const uniqueLevelLabels = Array.from(
    new Map(cards.map((c) => [c.level_label, c])).entries()
  ).sort(([a], [b]) => compareLevelLabels(a, b));
  const levels = uniqueLevelLabels.map(([, c]) => ({
    id: c.level_code,
    code: c.level_code,
    label: c.level_label,
  }));

  // Flat rows for the DataTable.
  const rows = cards.map((c) => ({
    id: c.id,
    name: c.name,
    levelLabel: c.level_label,
    schedule: c.schedule,
    active: c.active,
    withdrawn: c.withdrawn,
    indexStatus: computeIndexStatus(c.active, c.unnumbered),
    fcaName: adviserMap[c.id]?.name ?? null,
  }));

  // Section list for the bulk "Generate all indexes" button in the toolbar.
  const sectionsList = cards.map((c) => ({ id: c.id, name: c.name }));

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Sections & advisers."
        description="Every section for the current academic year. Structural config lives here; day-to-day roster / grading / attendance for each section are in the Markbook module."
        chips={
          ay && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {ay.ay_code}
            </Badge>
          )
        }
        actions={
          <NewSectionButton
            levels={levelOptions}
            ayCode={ay?.ay_code ?? null}
            initialLevelId={initialAddSectionLevelId}
          />
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HubStat
          label="Total sections"
          value={totalSections}
          icon={LayoutGrid}
          tone="brand"
          subtext={`${levels.length} ${levels.length === 1 ? 'level' : 'levels'} · ${ay?.label ?? 'No current AY'}`}
        />
        <HubStat
          label="Active students"
          value={totalActive}
          icon={Users}
          tone="mint"
          subtext="Currently enrolled, across every section"
        />
        <HubStat
          label="Withdrawn"
          value={totalWithdrawn}
          icon={UserX}
          tone={totalWithdrawn > 0 ? 'amber' : 'muted'}
          subtext="Kept on the roster for the audit trail"
        />
      </div>

      <SectionsNeededPanel
        levels={levelsNeedingSection}
        ayCode={ay?.ay_code ?? null}
      />

      {/* Sections DataTable — replaces the pill grid. Level facet + search +
          per-row ⋯ actions (Open roster / Generate index / Generate sheets).
          The bulk "Generate all indexes" button lives in toolbarTrailing. */}
      <SisSectionsDataTable
        rows={rows}
        levels={levels}
        role={sessionUser.role}
        termStarted={termStarted}
        sections={sectionsList}
        ayId={ay?.id ?? ''}
      />
    </PageShell>
  );
}

import { redirect } from 'next/navigation';
import { LayoutGrid, Users, UserX } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { NewSectionButton } from '@/components/markbook/new-section-button';
import {
  CopySectionsButton,
  type CopySource,
} from '@/components/sis/copy-sections-button';
import { HubStat } from '@/components/sis/hub-stat';
import {
  SectionsOverview,
  type LevelGroup,
} from '@/components/sis/sections-overview';
import type { LevelCardSection } from '@/components/sis/section-level-card';
import { SectionsAySwitcher } from '@/components/sis/sections-ay-switcher';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { sgToday } from '@/lib/dates';
import { hasTermStarted } from '@/lib/sis/current-term';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';
import { computeIndexStatus } from '@/lib/sis/section-index-status';
import type { Schedule, SectionClassType } from '@/lib/schemas/section';

// "Sections & advisers" — one card per grade level, not one row per
// section. The page's purpose is really "does every level have its
// section(s) set up, staffed, numbered" — a per-LEVEL readiness check —
// but the prior design was a flat per-SECTION table, so any level without
// a section yet rendered as a full row of dashes just to say "nothing
// here." A card per level fixes that at the root, and folds in a
// level-scoped quick-add that the flat table had no room for. The
// template-driven "create all N official section names in one click" (KD
// #144) was removed with the Structure Defaults template (migration 089)
// — there's no more master list of official section names independent of
// an AY to offer it from; "Add section" is a plain manual add now. The
// other year is the template instead: "Copy sections" sets this year up from
// any other, and ?ay= lets the upcoming year be set up before it is current —
// a section admissions places a child into but the SIS lacks makes the sync
// skip that child silently (2026-09-24, three AY2027 children).
// Rebuilt from a live-reviewed mockup — see docs/superpowers/plans history
// if this page changes shape again.
//
// The level catalog is a fixed 10 core levels (P1-P6, S1-S4) since
// migration 086 removed the volatile Youngstarters/Cambridge Secondary
// levels and the per-AY offered/shelved concept — every level shown here
// is always relevant, no "is this level offered this year" filtering.

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type SectionRaw = {
  id: string;
  name: string;
  level_id: string;
  level_code: string;
  level_label: string;
  level_type: LevelLite['level_type'];
  schedule: Schedule | null;
  classType: SectionClassType | null;
  active: number;
  withdrawn: number;
  unnumbered: number;
};

const GROUP_LABEL: Record<LevelLite['level_type'], string> = {
  primary: 'Primary',
  secondary: 'Secondary',
};
const GROUP_ORDER: LevelLite['level_type'][] = ['primary', 'secondary'];

export default async function SisSectionsListPage({
  searchParams,
}: {
  // A caller can deep-link here with ?addSectionLevel=<id> to open this
  // page's New Section dialog pre-filled for a specific level (e.g. from a
  // level-scoped "no section yet" callout elsewhere), instead of landing
  // the registrar on a blank page to re-find the level.
  searchParams: Promise<{ addSectionLevel?: string; ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const supabase = await createClient();

  // The current year by default; ?ay= may pick the upcoming one (taking
  // applications) so next year's sections can be set up before it is current.
  // Anything else falls back to the current year — same set the create route
  // accepts.
  const [currentAy, upcomingAy] = await Promise.all([
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);
  const ay =
    (sp.ay && upcomingAy?.ay_code === sp.ay ? upcomingAy : null) ?? currentAy;
  const ayOptions = [
    ...(currentAy ? [{ ayCode: currentAy.ay_code, isCurrent: true }] : []),
    ...(upcomingAy ? [{ ayCode: upcomingAy.ay_code, isCurrent: false }] : []),
  ];

  // termStarted = the school year's first term has begun. Used to escalate the
  // "Generate index" dialog mid-year (KD #136). Null-start_date handling and the
  // SGT clock live in hasTermStarted — see lib/sis/current-term.ts.
  let termStarted = false;
  if (ay) {
    const { data: terms } = await supabase
      .from('terms')
      .select('start_date')
      .eq('academic_year_id', ay.id);
    termStarted = hasTermStarted(terms ?? [], sgToday());
  }

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select(
          'id, name, schedule, class_type, level:levels(id, code, label, level_type)'
        )
        .eq('academic_year_id', ay.id)
    : {
        data: [] as Array<{
          id: string;
          name: string;
          schedule: Schedule | null;
          class_type: SectionClassType | null;
          level: LevelLite | LevelLite[] | null;
        }>,
      };

  // Level catalogue for the "New section" dialog + each level card.
  type LevelCatalogRow = LevelLite & { sort_order: number };
  const { data: levelRows } = await supabase
    .from('levels')
    .select('id, code, label, level_type, sort_order')
    .order('sort_order');
  const levelCatalog = (levelRows ?? []) as LevelCatalogRow[];
  const levelOptions = levelCatalog.map((l) => ({
    id: l.id,
    code: l.code,
    label: l.label,
    level_type: l.level_type,
  }));

  // Validate against the real catalog — never trust a raw query param as a
  // level id.
  const initialAddSectionLevelId = levelOptions.some(
    (l) => l.id === sp.addSectionLevel
  )
    ? sp.addSectionLevel
    : undefined;

  // "Copy sections" sources: every other year, newest first, with the
  // sections this year does not have yet. A year with nothing to add is left
  // out, and the button hides when no year has anything to add.
  const levelById = new Map(levelCatalog.map((l) => [l.id, l]));
  const have = new Set(
    (sections ?? []).map((s) => {
      const lvl = Array.isArray(s.level) ? s.level[0] : s.level;
      return `${lvl?.id}::${s.name}`;
    })
  );
  const { data: otherSections } = ay
    ? await supabase
        .from('sections')
        .select(
          'id, name, level_id, class_type, academic_year:academic_years!inner(ay_code)'
        )
        .neq('academic_year_id', ay.id)
    : { data: [] };
  const copyByAy = new Map<string, CopySource['missing']>();
  for (const s of (otherSections ?? []) as Array<{
    id: string;
    name: string;
    level_id: string;
    class_type: string | null;
    academic_year: { ay_code: string } | { ay_code: string }[] | null;
  }>) {
    if (have.has(`${s.level_id}::${s.name}`)) continue;
    const ayRow = Array.isArray(s.academic_year)
      ? s.academic_year[0]
      : s.academic_year;
    if (!ayRow) continue;
    const list = copyByAy.get(ayRow.ay_code) ?? [];
    list.push({
      id: s.id,
      name: s.name,
      levelLabel: levelById.get(s.level_id)?.label ?? 'Other',
      classType: s.class_type,
    });
    copyByAy.set(ayRow.ay_code, list);
  }
  const sortOrder = (label: string) =>
    levelCatalog.find((l) => l.label === label)?.sort_order ?? 999;
  const copySources: CopySource[] = [...copyByAy.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([ayCode, missing]) => ({
      ayCode,
      missing: missing.sort(
        (a, b) =>
          sortOrder(a.levelLabel) - sortOrder(b.levelLabel) ||
          a.name.localeCompare(b.name)
      ),
    }));

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

  const rawSections: SectionRaw[] = (sections ?? []).map((s) => {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    return {
      id: s.id,
      name: s.name,
      level_id: lvl?.id ?? '',
      level_code: lvl?.code ?? '',
      level_label: lvl?.label ?? 'Unknown',
      level_type: lvl?.level_type ?? 'primary',
      schedule: (s as { schedule?: Schedule | null }).schedule ?? null,
      classType:
        (s as { class_type?: SectionClassType | null }).class_type ?? null,
      active: counts[s.id]?.active ?? 0,
      withdrawn: counts[s.id]?.withdrawn ?? 0,
      unnumbered: counts[s.id]?.unnumbered ?? 0,
    };
  });

  const totalActive = rawSections.reduce((n, c) => n + c.active, 0);
  const totalWithdrawn = rawSections.reduce((n, c) => n + c.withdrawn, 0);

  // The fixed 10-level catalog — a level needing a section must still get
  // a card even though no section row carries its label yet.
  const relevantLevelCatalog = levelCatalog;

  const sectionsByLevelId = new Map<string, SectionRaw[]>();
  for (const s of rawSections) {
    const list = sectionsByLevelId.get(s.level_id) ?? [];
    list.push(s);
    sectionsByLevelId.set(s.level_id, list);
  }
  const levelsWithSections = new Set(
    rawSections.map((s) => s.level_id).filter(Boolean)
  ).size;

  const groups: LevelGroup[] = GROUP_ORDER.map((levelType) => ({
    levelType,
    groupLabel: GROUP_LABEL[levelType],
    levels: relevantLevelCatalog
      .filter((l) => l.level_type === levelType)
      .map((l) => {
        const sectionsForLevel: LevelCardSection[] = (
          sectionsByLevelId.get(l.id) ?? []
        )
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({
            id: s.id,
            name: s.name,
            schedule: s.schedule,
            classType: s.classType,
            active: s.active,
            withdrawn: s.withdrawn,
            indexStatus:
              s.active > 0 ? computeIndexStatus(s.active, s.unnumbered) : null,
            fcaName: adviserMap[s.id]?.name ?? null,
          }));
        return {
          level: {
            id: l.id,
            code: l.code,
            label: l.label,
            level_type: l.level_type,
          },
          sections: sectionsForLevel,
        };
      }),
  })).filter((g) => g.levels.length > 0);

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Sections & advisers."
        description="One card per level — every level, its section(s), and whether it's staffed. Day-to-day roster / grading / attendance is in Markbook."
        chips={
          ay &&
          (ayOptions.length > 1 ? (
            <SectionsAySwitcher current={ay.ay_code} options={ayOptions} />
          ) : (
            <Badge
              variant="outline"
              className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {ay.ay_code}
            </Badge>
          ))
        }
        actions={
          <div className="flex items-center gap-2">
            {ay && copySources.length > 0 && (
              <CopySectionsButton
                targetAyCode={ay.ay_code}
                sources={copySources}
              />
            )}
            <NewSectionButton
              levels={levelOptions}
              ayCode={ay?.ay_code ?? null}
              initialLevelId={initialAddSectionLevelId}
            />
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HubStat
          label="Levels covered"
          value={`${levelsWithSections} / ${relevantLevelCatalog.length}`}
          icon={LayoutGrid}
          tone="brand"
          subtext={`Have at least one section · ${ay?.label ?? 'No current AY'}`}
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

      <SectionsOverview
        groups={groups}
        role={sessionUser.role}
        termStarted={termStarted}
        ayId={ay?.id ?? ''}
        ayCode={ay?.ay_code ?? null}
        allSections={rawSections.map((s) => ({ id: s.id, name: s.name }))}
      />
    </PageShell>
  );
}

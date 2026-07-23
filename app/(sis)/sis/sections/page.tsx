import { redirect } from 'next/navigation';
import { LayoutGrid, Users, UserX } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { NewSectionButton } from '@/components/markbook/new-section-button';
import { HubStat } from '@/components/sis/hub-stat';
import {
  SectionsOverview,
  type LevelGroup,
} from '@/components/sis/sections-overview';
import type { LevelCardSection } from '@/components/sis/section-level-card';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { sgToday } from '@/lib/dates';
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
// an AY to offer it from; "Add section" is a plain manual add now.
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
  searchParams: Promise<{ addSectionLevel?: string }>;
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

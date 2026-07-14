import { redirect } from 'next/navigation';
import { Layers, ShieldAlert } from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { PageShell } from '@/components/ui/page-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import {
  computeLevelDemand,
  type LevelDemandRow,
} from '@/lib/sis/level-demand';
import {
  computeLevelTransitions,
  type LevelTransitionRow,
} from '@/lib/sis/level-transitions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  AddLevelDialog,
  LevelsAySwitcher,
  LevelsManagerClient,
} from '@/components/sis/levels-manager-client';

// Grade Levels admin — Levels & Grade Progression, Phase 3 (migration 078).
// school_admin/superadmin manage the level catalog (core P1-S4 are
// permanent; volatile levels like YS tiers or CS1/CS2 can be offered or
// shelved per AY).
//
// The `next_level_id` column + its editable "Next level" picker were
// REMOVED (2026-07-14) after confirming with the school that the real
// progression logic is one-to-many (a level can branch to more than one
// destination — e.g. Primary Six students split between "Secondary One"
// and an HFSE Global Education Programme track) and already lives,
// correctly, in the separate admissions portal's own hardcoded map — the
// portal never read this SIS field. A one-to-one FK couldn't represent
// that anyway. Replaced with `lib/sis/level-transitions.ts`'s
// `computeLevelTransitions` — a real, evidence-based report cross-
// referencing each returning applicant's PRIOR-AY placement
// (section_students/students, Hard Rule #4 studentNumber) against their
// CURRENT-AY `levelApplied`, so the one-to-many split shows up naturally
// from what actually happened, nothing hand-maintained. `next_level_id`
// itself is left in the schema, dormant — no migration, no API change.
export default async function GradeLevelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'superadmin' &&
    sessionUser.role !== 'school_admin'
  ) {
    redirect('/sis');
  }

  const sp = await searchParams;
  const service = createServiceClient();

  // Academic-year options + current selection — same idiom as
  // /sis/admin/subjects: a plain ?ay= query string keeps the page a server
  // component while still letting the registrar pick which AY's offerings
  // the volatile-level Switches read/write.
  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code, label, is_current')
    .order('ay_code', { ascending: false });
  type AyRow = {
    id: string;
    ay_code: string;
    label: string;
    is_current: boolean;
  };
  const ayList = (ays ?? []) as AyRow[];
  const currentAy: AyRow | null =
    (sp.ay ? ayList.find((a) => a.ay_code === sp.ay) : undefined) ??
    ayList.find((a) => a.is_current) ??
    ayList[0] ??
    null;

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  const levels = await getLevelRows(service);

  let offeredLevelIds: string[] = [];
  let demandRows: LevelDemandRow[] = [];
  let transitionRows: LevelTransitionRow[] = [];
  let acceptingAyCode: string | null = null;
  let priorAyCode: string | null = null;

  if (currentAy) {
    const offeredSet = await getOfferedLevelIds(service, currentAy.id);
    offeredLevelIds = Array.from(offeredSet);

    // Demand + transitions are scoped to the AY prospective/returning
    // applicants are actually applying into: the upcoming early-bird AY if
    // one is open (KD #118), else the operationally current AY. These two
    // AY calls use a cookie-scoped server client (per their own module
    // doc), so they run here in the RSC body rather than inside any
    // unstable_cache.
    const upcoming = await getUpcomingAcademicYear();
    const acceptingAy = upcoming ?? (await getCurrentAcademicYear());

    if (acceptingAy) {
      acceptingAyCode = acceptingAy.ay_code;
      const acceptingOfferedSet =
        acceptingAy.id === currentAy.id
          ? offeredSet
          : await getOfferedLevelIds(service, acceptingAy.id);

      const admissions = createAdmissionsClient();
      const prefix = `ay${acceptingAy.ay_code.replace(/^AY/i, '').toLowerCase()}`;
      type AppLevelRow = {
        studentNumber: string | null;
        levelApplied: string | null;
      };
      // Cast required: Supabase can't infer row shapes for dynamic table
      // names (same pattern as lib/sis/cohorts.ts).
      type PageResult<T> = PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>;
      try {
        const apps = await fetchAllPages<AppLevelRow>(
          (from, to) =>
            admissions
              .from(`${prefix}_enrolment_applications`)
              .select('studentNumber, levelApplied')
              .range(from, to) as unknown as PageResult<AppLevelRow>
        );
        demandRows = computeLevelDemand(apps, levels, acceptingOfferedSet);

        // Prior AY = the year immediately before the accepting AY (numeric
        // year - 1) — whoever was placed there last AY is who could be
        // "returning" into the accepting AY's applications. Falls back to
        // no transitions (empty array) when that AY isn't in the system —
        // e.g. the very first AY the school ever ran.
        const acceptingYear = Number(acceptingAy.ay_code.replace(/^AY/i, ''));
        const priorAy = ayList.find(
          (a) => Number(a.ay_code.replace(/^AY/i, '')) === acceptingYear - 1
        );

        if (priorAy) {
          priorAyCode = priorAy.ay_code;
          const { data: sectionRows } = await service
            .from('sections')
            .select('id, level_id')
            .eq('academic_year_id', priorAy.id);
          const priorSections = (sectionRows ?? []) as Array<{
            id: string;
            level_id: string;
          }>;
          const levelIdBySection = new Map(
            priorSections.map((s) => [s.id, s.level_id])
          );
          const priorSectionIds = priorSections.map((s) => s.id);

          if (priorSectionIds.length > 0) {
            const { data: ssRows } = await service
              .from('section_students')
              .select(
                'section_id, enrollment_status, student:students(student_number)'
              )
              .in('section_id', priorSectionIds)
              .neq('enrollment_status', 'withdrawn');
            // Supabase's JS client types a to-one embed as an array (it
            // can't statically know section_students.student_id -> students
            // is many-to-one without generated types, which this project
            // doesn't use) — each row genuinely embeds exactly one student,
            // so take [0].
            type SsRow = {
              section_id: string;
              student: Array<{ student_number: string }> | null;
            };
            const priorEnrollments = ((ssRows ?? []) as SsRow[])
              .map((r) => ({
                studentNumber: r.student?.[0]?.student_number ?? null,
                levelId: levelIdBySection.get(r.section_id) ?? null,
              }))
              .filter(
                (e): e is { studentNumber: string; levelId: string } =>
                  e.studentNumber != null && e.levelId != null
              );

            transitionRows = computeLevelTransitions(
              priorEnrollments,
              apps,
              levels
            );
          }
        }
      } catch (err) {
        console.warn(
          '[sis/admin/levels] demand/transitions fetch failed:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return (
    <PageShell>
      <SisPageHeader
        group="Structure"
        title="Grade levels."
        description="Primary 1 to Secondary 4 are permanent. Other levels can be offered or shelved per school year."
        chips={
          currentAy && (
            <>
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {currentAy.ay_code}
              </Badge>
              <LevelsAySwitcher
                current={currentAy.ay_code}
                options={ayOptions}
              />
            </>
          )
        }
        actions={currentAy && <AddLevelDialog levels={levels} />}
      />

      {/* Risk banner (Phase-0.4 convention) — Levels shares group="Structure"
          with Subjects/Template but had none, despite Offered-switch edits
          reaching the live parent-facing Admissions application form for
          the accepting AY. Same §9.4 recipe as Subjects'/Template's amber
          banners. */}
      {currentAy && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
            <ShieldAlert className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Offering changes reach the live application form
            </p>
            <p className="text-sm text-muted-foreground">
              Turning a level&apos;s{' '}
              <strong className="font-semibold text-foreground">Offered</strong>{' '}
              switch off removes it from what applicants can choose on the
              admissions portal immediately.
            </p>
          </div>
        </div>
      )}

      {!currentAy ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <Layers className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No academic years
            </div>
            <p className="text-sm text-muted-foreground">
              Create an AY first via AY Setup.
            </p>
          </CardContent>
        </Card>
      ) : (
        <LevelsManagerClient
          levels={levels}
          offeredLevelIds={offeredLevelIds}
          demandRows={demandRows}
          transitionRows={transitionRows}
          currentAyCode={currentAy.ay_code}
          currentAyId={currentAy.id}
          acceptingAyCode={acceptingAyCode}
          priorAyCode={priorAyCode}
        />
      )}
    </PageShell>
  );
}

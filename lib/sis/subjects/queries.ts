import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import { MOTHER_TONGUE_UMBRELLA_CODE } from '@/lib/schemas/subject';
import type { SectionClassType } from '@/lib/schemas/section';
import { subjectCodesForTrack } from '@/lib/sis/track-bundles';

// Subject-config queries for /sis/admin/subjects. Service-role reads; the
// page itself is gated to school_admin+superadmin via ROUTE_ACCESS.

export type SubjectRow = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  // `grading_method` (migration 082) — 'standard_sheet' (has a WW/PT/QA
  // grading grid) vs 'no_sheet' (recorded some other way, no grid
  // generated). Every pre-082 subject defaults to 'standard_sheet'.
  grading_method: 'standard_sheet' | 'no_sheet';
};

export type LevelRow = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

// One row per (subject × AY) — migration 080 collapsed subject_configs off
// the level dimension (weight is a property of the subject, not any one
// level it's taught at). Which levels a subject is taught at now lives on
// `subject_level_offerings` (see `listSubjectLevelOfferings` below).
export type SubjectConfigRow = {
  id: string;
  academic_year_id: string;
  subject_id: string;
  ww_weight: number; // stored as 0.00–1.00 in DB; UI converts
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number; // max possible QA score, default 30 (Hard Rule #1 canonical)
};

// `subject_level_offerings(subject_id, level_id, academic_year_id)` — this
// AY's "which levels does this subject teach at" source of truth.
export type SubjectLevelOfferingRow = {
  subject_id: string;
  level_id: string;
};

// `subject_report_map(subject_id, report_subject_id)` — global (no AY
// column), which report-card column a subject's grades roll up into. Every
// subject is seeded self-mapped (migration 080).
export type SubjectReportMapRow = {
  subject_id: string;
  report_subject_id: string;
};

export async function listSubjects(): Promise<SubjectRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subjects')
    .select('id, code, name, is_examinable, grading_method')
    .order('name', { ascending: true });
  if (error) {
    console.error('[subjects] listSubjects failed:', error.message);
    return [];
  }
  return (data ?? []) as SubjectRow[];
}

export async function listLevels(): Promise<LevelRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .order('code', { ascending: true });
  if (error) {
    console.error('[subjects] listLevels failed:', error.message);
    return [];
  }
  return (data ?? []) as LevelRow[];
}

export async function listSubjectConfigsForAy(
  academicYearId: string
): Promise<SubjectConfigRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
    )
    .eq('academic_year_id', academicYearId);
  if (error) {
    console.error('[subjects] listSubjectConfigsForAy failed:', error.message);
    return [];
  }
  return ((data ?? []) as SubjectConfigRow[]).map((r) => ({
    ...r,
    // `numeric(4,2)` comes back as a string from supabase-js; coerce to number.
    ww_weight: Number(r.ww_weight),
    pt_weight: Number(r.pt_weight),
    qa_weight: Number(r.qa_weight),
  }));
}

// Which levels each subject is attached to in a given AY — the level
// dimension migration 080 moved off `subject_configs`. AY-scoped sibling of
// `lib/sis/template/queries.ts::listTemplateSubjectLevelOfferings`.
export async function listSubjectLevelOfferings(
  academicYearId: string
): Promise<SubjectLevelOfferingRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_level_offerings')
    .select('subject_id, level_id')
    .eq('academic_year_id', academicYearId);
  if (error) {
    console.error(
      '[subjects] listSubjectLevelOfferings failed:',
      error.message
    );
    return [];
  }
  return (data ?? []) as SubjectLevelOfferingRow[];
}

// Report-card column mapping — global, no AY filter (migration 080's
// confirmed deviation: `subject_report_map` has no `academic_year_id`
// column).
export async function listSubjectReportMap(): Promise<SubjectReportMapRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_report_map')
    .select('subject_id, report_subject_id');
  if (error) {
    console.error('[subjects] listSubjectReportMap failed:', error.message);
    return [];
  }
  return (data ?? []) as SubjectReportMapRow[];
}

// ─────────────────────────────────────────────────────────────────────────
// listCatalogForLevelType — Task 1 of the "Unified Subject Setup page"
// plan (docs: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
// One row per subject genuinely relevant to a level TYPE (Primary or
// Secondary), annotated with everything Step ① ("Subjects") needs: its
// config (if any), its report-map target, and its offering state
// collapsed across every individual level of that type into
// 'on' | 'off' | 'mixed'.
// ─────────────────────────────────────────────────────────────────────────

export type CatalogOfferingState = 'on' | 'off' | 'mixed';

export type CatalogSubjectRow = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  grading_method: 'standard_sheet' | 'no_sheet';
  /** Whether a subject_configs row exists for this AY. */
  hasConfig: boolean;
  /** The full config row (weights + slot counts) when hasConfig is true. */
  config: SubjectConfigRow | null;
  /** Resolved report-map target — defaults to self.id when no explicit
   * subject_report_map row exists, matching the existing convention in
   * subject-level-tree.tsx / subject-monitoring-table.tsx
   * (`reportSubjectIdBySubjectId.get(subject.id) ?? subject.id`). */
  reportSubjectId: string;
  /** Code of the resolved report target — equals `code` when self-mapped. */
  reportSubjectCode: string;
  /** Offering state across every level of the requested type that is
   * actually offered this AY (core levels + offered volatile levels). */
  offeringState: CatalogOfferingState;
  /** The specific level ids (within the requested type) this subject is
   * currently offered at — empty when offeringState is 'off'. */
  offeredLevelIds: string[];
  /** hasConfig-only signal today ("no subject_configs row yet for this
   * AY = brand-new, unconfirmed subject"). Deliberately NOT the full
   * "needs attention" rule the plan describes (also: unexpected/missing
   * report-map target; grading_method='no_sheet' surfaced as a deliberate
   * chip) — that richer derivation is Task 2's job, working from the raw
   * fields this row already exposes (hasConfig, config, reportSubjectId,
   * grading_method). IMPORTANT CAVEAT (see Task 1 report): migration 082
   * pre-populates subject_configs for its 4 new subjects (GP/COMP/ARTD/
   * PESTD), so hasConfig is already true for all four and this flag will
   * read false for them even though their weights are an unconfirmed
   * assumption — Task 2 needs a different signal for that specific case,
   * this loader does not invent one. */
  needsAttention: boolean;
};

export async function listCatalogForLevelType(
  service: SupabaseClient,
  academicYearId: string,
  levelType: 'primary' | 'secondary'
): Promise<CatalogSubjectRow[]> {
  const [subjects, configs, offerings, reportMap, allLevels, offeredLevelIds] =
    await Promise.all([
      listSubjects(),
      listSubjectConfigsForAy(academicYearId),
      listSubjectLevelOfferings(academicYearId),
      listSubjectReportMap(),
      getLevelRows(service),
      getOfferedLevelIds(service, academicYearId),
    ]);

  // Levels of this type actually offered this AY — core levels always
  // count; volatile (non-core) levels only when an ay_level_offerings row
  // exists (KD #153), mirroring the existing page's own `levels` filter.
  const levelsOfType = allLevels.filter(
    (l) => l.levelType === levelType && (l.isCore || offeredLevelIds.has(l.id))
  );
  const levelIdsOfType = new Set(levelsOfType.map((l) => l.id));

  const configBySubjectId = new Map(configs.map((c) => [c.subject_id, c]));
  const reportBySubjectId = new Map(
    reportMap.map((r) => [r.subject_id, r.report_subject_id])
  );
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  // Per subject: which of THIS level type's currently-offered levels it's
  // attached to, AND (separately) whether it has ANY offering row at all,
  // anywhere (either level type). The second signal is what lets this
  // loader tell "a brand-new subject not yet attached anywhere" (should
  // surface at whichever level type is being viewed, so there's somewhere
  // to attach it) apart from "a subject that genuinely belongs to the
  // OTHER level type" (e.g. HIST is Secondary-only — it must not appear
  // on the Primary catalog just because it happens to have zero Primary
  // offerings).
  const offeredLevelIdsBySubjectId = new Map<string, Set<string>>();
  const anyOfferingBySubjectId = new Set<string>();
  for (const o of offerings) {
    anyOfferingBySubjectId.add(o.subject_id);
    if (!levelIdsOfType.has(o.level_id)) continue;
    const set =
      offeredLevelIdsBySubjectId.get(o.subject_id) ?? new Set<string>();
    set.add(o.level_id);
    offeredLevelIdsBySubjectId.set(o.subject_id, set);
  }

  const rows: CatalogSubjectRow[] = [];
  for (const subject of subjects) {
    // Mother Tongue itself is never a directly-attached row — Filipino
    // and Mandarin are the real graded subjects, each carrying its own
    // subject_report_map entry pointing at MT (see
    // lib/schemas/subject.ts::MOTHER_TONGUE_UMBRELLA_CODE doc comment).
    if (subject.code === MOTHER_TONGUE_UMBRELLA_CODE) continue;

    const offeredSet =
      offeredLevelIdsBySubjectId.get(subject.id) ?? new Set<string>();
    const offeredCount = offeredSet.size;
    const hasAnyOfferingAnywhere = anyOfferingBySubjectId.has(subject.id);

    // Not offered at this level type at all, but genuinely offered at the
    // OTHER type — this catalog isn't its home, skip it entirely.
    if (offeredCount === 0 && hasAnyOfferingAnywhere) continue;

    let offeringState: CatalogOfferingState;
    if (offeredCount === 0) offeringState = 'off';
    else if (levelsOfType.length > 0 && offeredCount >= levelsOfType.length)
      offeringState = 'on';
    else offeringState = 'mixed';

    const config = configBySubjectId.get(subject.id) ?? null;
    const reportSubjectId = reportBySubjectId.get(subject.id) ?? subject.id;
    const reportSubjectCode =
      subjectById.get(reportSubjectId)?.code ?? subject.code;

    rows.push({
      id: subject.id,
      code: subject.code,
      name: subject.name,
      is_examinable: subject.is_examinable,
      grading_method: subject.grading_method,
      hasConfig: !!config,
      config,
      reportSubjectId,
      reportSubjectCode,
      offeringState,
      offeredLevelIds: Array.from(offeredSet),
      needsAttention: !config,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────
// listSectionsWithSubjectsForLevelType — level-filtered sibling of
// lib/markbook/grading-sheet-scope.ts::buildGradingSheetScopes's "sections
// + their attached subjects in one shot" shape (that module is a pure
// scope-builder over already-fetched rows; this is the actual query +
// per-section subject map, filtered to one level type, feeding Step ②
// "Assign to sections").
//
// Each returned section additionally carries whether every catalog
// subject at this level is part of that section's RECOMMENDED bundle —
// computed server-side, once, here, via the section's class_type
// (`lib/sis/track-bundles.ts::subjectCodesForTrack`) — so Task 3's
// checklist UI never has to duplicate the bundle lookup client-side.
// ─────────────────────────────────────────────────────────────────────────

export type SectionCatalogSubjectAssignment = {
  subjectConfigId: string;
  subjectId: string;
  code: string;
  /** True when a section_subjects row pairs this section to this config. */
  attached: boolean;
  /** True when this subject is part of the section's resolved bundle;
   * null when the section has no class_type (Global/Standard unset). */
  recommended: boolean | null;
};

export type SectionWithSubjectsRow = {
  id: string;
  name: string;
  levelId: string;
  /** The section's SPECIFIC level code (e.g. "S3", not just "secondary")
   * — needed by Task 3's per-section bundle resolution. */
  levelCode: string;
  classType: SectionClassType | null;
  /** Active + late-enrollee headcount; null only if the section query
   * itself failed (never for "zero students" — that's a real 0). */
  studentCount: number | null;
  /** One entry per catalog subject that HAS a subject_configs row for
   * this AY (an unconfigured "needs attention" subject has no
   * subjectConfigId to attach/detach yet — it isn't attachable until
   * Step ① confirms it, so it's intentionally absent from this list;
   * Task 3 should not need to special-case that, but it's worth knowing
   * this list's length can be shorter than the full catalog's). */
  subjects: SectionCatalogSubjectAssignment[];
};

// TODO(sdd-task-3): swap this for `resolveTrackBundle(classType,
// levelCode)` once Task 3 lands the level-aware Standard-bundle resolver
// in lib/sis/track-bundles.ts (the flat TRACK_BUNDLES lookup will be
// replaced there). Until that lands, every Standard section at every
// level — including S3/S4 — is recommended the flat
// TRACK_BUNDLES.Standard list (HIST, never HUM) via the current
// `subjectCodesForTrack(classType)` call below. This is a known,
// documented gap Task 1 deliberately does not fix (that's explicitly
// Task 3's job, including its own HUM/S3-S4 offering verification) — this
// is the one call site to redirect.
// levelCode is intentionally unused today — kept in the signature so
// Task 3's `resolveTrackBundle(classType, levelCode)` swap-in is a
// body-only change at this one call site, not a call-site signature
// change too.
function recommendedCodesForSection(
  classType: SectionClassType | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  levelCode: string
): readonly string[] | null {
  if (!classType) return null;
  return subjectCodesForTrack(classType);
}

export async function listSectionsWithSubjectsForLevelType(
  service: SupabaseClient,
  academicYearId: string,
  levelType: 'primary' | 'secondary'
): Promise<SectionWithSubjectsRow[]> {
  const [allLevels, offeredLevelIds, catalog] = await Promise.all([
    getLevelRows(service),
    getOfferedLevelIds(service, academicYearId),
    listCatalogForLevelType(service, academicYearId, levelType),
  ]);

  const levelsOfType = allLevels.filter(
    (l) => l.levelType === levelType && (l.isCore || offeredLevelIds.has(l.id))
  );
  const levelById = new Map(levelsOfType.map((l) => [l.id, l]));
  const levelIds = levelsOfType.map((l) => l.id);
  if (levelIds.length === 0) return [];

  const { data: sectionRows, error: sectionsError } = await service
    .from('sections')
    .select('id, name, level_id, class_type')
    .eq('academic_year_id', academicYearId)
    .in('level_id', levelIds)
    .order('name', { ascending: true });
  if (sectionsError) {
    console.error(
      '[subjects] listSectionsWithSubjectsForLevelType sections query failed:',
      sectionsError.message
    );
    return [];
  }
  const sections = (sectionRows ?? []) as Array<{
    id: string;
    name: string;
    level_id: string;
    class_type: SectionClassType | null;
  }>;
  if (sections.length === 0) return [];

  const sectionIds = sections.map((s) => s.id);

  // Same "one query, in()-scoped to this page's sections, bucket
  // client-side" pattern app/(sis)/sis/sections/page.tsx already uses for
  // its own student-count column — cheap at this app's per-level section
  // count (≤10ish, per the plan's own stated assumption).
  const [{ data: assignmentRows }, { data: enrolmentRows }] = await Promise.all(
    [
      service
        .from('section_subjects')
        .select('section_id, subject_config_id')
        .in('section_id', sectionIds),
      service
        .from('section_students')
        .select('section_id, enrollment_status')
        .in('section_id', sectionIds),
    ]
  );

  const attachedBySection = new Map<string, Set<string>>();
  for (const row of (assignmentRows ?? []) as Array<{
    section_id: string;
    subject_config_id: string;
  }>) {
    const set = attachedBySection.get(row.section_id) ?? new Set<string>();
    set.add(row.subject_config_id);
    attachedBySection.set(row.section_id, set);
  }

  const studentCountBySection = new Map<string, number>();
  for (const row of (enrolmentRows ?? []) as Array<{
    section_id: string;
    enrollment_status: string;
  }>) {
    if (row.enrollment_status === 'withdrawn') continue;
    studentCountBySection.set(
      row.section_id,
      (studentCountBySection.get(row.section_id) ?? 0) + 1
    );
  }

  // Only catalog subjects with a real subject_configs row have a
  // subjectConfigId to attach/detach at all — see SectionWithSubjectsRow's
  // `subjects` doc comment above.
  const configuredCatalog = catalog.filter((c) => c.hasConfig && c.config);

  return sections.map((section) => {
    const level = levelById.get(section.level_id);
    const attachedIds = attachedBySection.get(section.id) ?? new Set<string>();
    const recommendedCodes = recommendedCodesForSection(
      section.class_type,
      level?.code ?? ''
    );
    const recommendedSet = recommendedCodes ? new Set(recommendedCodes) : null;

    const subjects: SectionCatalogSubjectAssignment[] = configuredCatalog.map(
      (c) => ({
        subjectConfigId: c.config!.id,
        subjectId: c.id,
        code: c.code,
        attached: attachedIds.has(c.config!.id),
        recommended: recommendedSet ? recommendedSet.has(c.code) : null,
      })
    );

    return {
      id: section.id,
      name: section.name,
      levelId: section.level_id,
      levelCode: level?.code ?? '',
      classType: section.class_type,
      studentCount: studentCountBySection.get(section.id) ?? 0,
      subjects,
    };
  });
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import { MOTHER_TONGUE_UMBRELLA_CODE } from '@/lib/schemas/subject';

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
  // migration 085 — "has a human confirmed this number" independent of
  // "does a row exist." Defaults true for any config an admin creates
  // through the Subject Setup page's own Add/Tune flow; migration 082's
  // four stand-in GP/COMP/ARTD/PESTD rows were backfilled to false since
  // their weights are a documented, unconfirmed assumption. See
  // CatalogSubjectRow.needsAttention below for the consumer.
  weights_confirmed: boolean;
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
      'id, academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, weights_confirmed'
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
   * subject_report_map row exists. */
  reportSubjectId: string;
  /** Code of the resolved report target — equals `code` when self-mapped. */
  reportSubjectCode: string;
  /** Offering state across every level of the requested type that is
   * actually offered this AY (core levels + offered volatile levels). */
  offeringState: CatalogOfferingState;
  /** The specific level ids (within the requested type) this subject is
   * currently offered at — empty when offeringState is 'off'. */
  offeredLevelIds: string[];
  /** Task 2's signal: true when there is no `subject_configs` row yet for
   * this AY (a brand-new subject with nothing to show), OR a row exists
   * but its weights are unconfirmed (`config.weights_confirmed === false`
   * — migration 085; the case migration 082's four stand-in GP/COMP/ARTD/
   * PESTD rows hit, since `hasConfig` alone reads true for them despite
   * their weights being a documented, unconfirmed assumption — see Task
   * 1's report + migration 085's header for why `weights_confirmed` was
   * chosen over the two documented alternatives). Deliberately NOT also
   * checking `reportSubjectId`/report-map "unexpectedness" — the plan
   * doc's aspirational broader rule ("a report-map entry that's missing
   * or points somewhere unexpected") has no crisp, evidence-backed
   * definition of "unexpected" (a self-map IS the expected default for
   * most subjects but NOT for Filipino/Mandarin, which correctly
   * self-report to Mother Tongue) — building a heuristic for it here
   * would be guessing at a rule nobody asked for. `grading_method ===
   * 'no_sheet'` is likewise NOT a needsAttention trigger — it renders as
   * a deliberate "No sheet" chip in the Weights column instead of a gap,
   * per the plan's own framing ("reads as a deliberate choice rather than
   * a gap"). */
  needsAttention: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// computeCatalogForLevelType — the pure decision logic extracted out of
// listCatalogForLevelType (review finding on Task 1: this branchy logic —
// the offering-state collapse to on/off/mixed, the Mother Tongue exclusion,
// and the cross-level-type inclusion/exclusion rule — had zero test
// coverage). No Supabase/DB imports; takes already-fetched rows plus the
// requested level type's actually-offered level ids and returns the same
// CatalogSubjectRow[] shape, mirroring the
// lib/sis/subject-config-gaps.ts::computeSubjectConfigGaps pattern (pure
// comparison function, DB-fetching caller is a thin wrapper below).
// ─────────────────────────────────────────────────────────────────────────

export function computeCatalogForLevelType(
  subjects: SubjectRow[],
  configs: SubjectConfigRow[],
  offerings: SubjectLevelOfferingRow[],
  reportMap: SubjectReportMapRow[],
  // Ids of the levels of the requested type that are actually offered this
  // AY (core levels + any volatile level with an ay_level_offerings row) —
  // the caller resolves this via getLevelRows/getOfferedLevelIds (KD #153).
  levelIdsOfType: readonly string[]
): CatalogSubjectRow[] {
  const levelIdSet = new Set(levelIdsOfType);

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
    if (!levelIdSet.has(o.level_id)) continue;
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
    else if (levelIdsOfType.length > 0 && offeredCount >= levelIdsOfType.length)
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
      needsAttention:
        subject.grading_method !== 'no_sheet' &&
        (!config || config.weights_confirmed === false),
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

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
  const levelIdsOfType = allLevels
    .filter(
      (l) =>
        l.levelType === levelType && (l.isCore || offeredLevelIds.has(l.id))
    )
    .map((l) => l.id);

  return computeCatalogForLevelType(
    subjects,
    configs,
    offerings,
    reportMap,
    levelIdsOfType
  );
}

// ─────────────────────────────────────────────────────────────────────────
// listSectionsForLevelType — just enough to populate the simplified
// Subject Setup page's "Attach to section" modal: which sections exist at
// this level type, and their specific level code (so a registrar picking
// among 15+ same-level-type sections can tell them apart). Deliberately
// NOT the heavier per-section subject/attachment/recommended-bundle shape
// this replaced — that fed a per-section checklist + track-flagging UI
// that was rejected as overengineered in favor of a fully manual "check
// subjects, pick sections, Attach" flow (see the "Unified Subject Setup
// page" plan's history, docs\superpowers\plans, for the prior design).
// ─────────────────────────────────────────────────────────────────────────

export type SectionOption = {
  id: string;
  name: string;
  levelCode: string;
  levelType: 'primary' | 'secondary';
};

export async function listSectionsForLevelType(
  service: SupabaseClient,
  academicYearId: string,
  levelType: 'primary' | 'secondary'
): Promise<SectionOption[]> {
  const [allLevels, offeredLevelIds] = await Promise.all([
    getLevelRows(service),
    getOfferedLevelIds(service, academicYearId),
  ]);

  const levelsOfType = allLevels.filter(
    (l) => l.levelType === levelType && (l.isCore || offeredLevelIds.has(l.id))
  );
  const levelById = new Map(levelsOfType.map((l) => [l.id, l]));
  const levelIds = levelsOfType.map((l) => l.id);
  if (levelIds.length === 0) return [];

  const { data: sectionRows, error: sectionsError } = await service
    .from('sections')
    .select('id, name, level_id')
    .eq('academic_year_id', academicYearId)
    .in('level_id', levelIds)
    .order('name', { ascending: true });
  if (sectionsError) {
    console.error(
      '[subjects] listSectionsForLevelType sections query failed:',
      sectionsError.message
    );
    return [];
  }

  return (
    (sectionRows ?? []) as Array<{
      id: string;
      name: string;
      level_id: string;
    }>
  ).map((s) => ({
    id: s.id,
    name: s.name,
    levelCode: levelById.get(s.level_id)?.code ?? '',
    levelType,
  }));
}

import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import {
  computeNationalityByLevel,
  computeNationalityMix,
  type CategoryMixRow,
  type NationalityByLevel,
  type NationalityMixRow,
} from '@/lib/admissions/insights-funnel';
import { growthDelta, type Growth } from '@/lib/dashboard/growth';
import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
import {
  controllabilityOf,
  enrolledCategoryBucket,
  isMidYearJoinKind,
  isTerminalLevel,
  levelLabelOf,
  MONTH_LABELS,
  movementLevelOf,
  movementMonthIndex,
  UNSPECIFIED_CATEGORY,
  withdrawalReasonLabelOf,
} from '@/lib/sis/insights-shared';

export {
  isTerminalLevel,
  MONTH_LABELS,
  TERMINAL_LEVEL_CODES,
  WITHDRAWAL_CONTROLLABILITY,
  type WithdrawalControllability,
} from '@/lib/sis/insights-shared';
import { getMovementEvents, type MovementEvent } from '@/lib/sis/movements';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// Records Insights synthesis (Phase 2 of Module Insights, KD #140).
//
// Pure `rollupMovements` aggregates the cross-AY movement feed into the
// Retention/Population breakdowns; thin cached loaders add cross-AY retention
// (studentNumber set-intersection priorAy ∩ currentAy) + headcount. Reuses
// `lib/sis/movements.ts` + `lib/sis/dashboard.ts` loaders. `growthDelta` is
// re-exported for the page (hoisted to lib/dashboard/growth.ts, shared with
// Admissions).

export { growthDelta, type Growth };

// ──────────────────────────────────────────────────────────────────────────
// Movement rollups (pure)
// ──────────────────────────────────────────────────────────────────────────

export type LabelCount = { reason: string; count: number };
export type LevelCountRow = { level: string; count: number };
export type TermCountRow = { termNumber: number; count: number };

/**
 * One row of the reason×level attrition matrix:
 * the level, plus a count per withdrawal-reason key.
 * Reason keys are the human-readable labels (reasonLabel values),
 * not the raw enum values, to mirror what withdrawalsByReason uses.
 */
export type WithdrawalByReasonAndLevel = {
  level: string;
  /** key = humanized reason label (or 'Unspecified'), value = count */
  reasonCounts: Record<string, number>;
  total: number;
};

export type ControllabilityBreakdown = {
  controllableCount: number;
  structuralCount: number;
  unspecifiedCount: number;
  total: number;
  controllablePct: number | null;
  /** Top controllable reason by label + its level concentration, or null */
  topControllableTakeaway: string | null;
};

export type MovementRollup = {
  counts: {
    withdrawn: number;
    lateEnrolled: number;
    transferred: number;
    reEnrolled: number;
  };
  withdrawalsByReason: LabelCount[];
  withdrawalsByLevel: LevelCountRow[];
  /** Reason×level matrix — for the stacked-bar attrition chart */
  withdrawalsByReasonAndLevel: WithdrawalByReasonAndLevel[];
  /** All reason labels that appear in at least one withdrawal */
  withdrawalReasonKeys: string[];
  /** Controllability summary + prescriptive takeaway */
  controllability: ControllabilityBreakdown;
  lateByLevel: LevelCountRow[];
  lateByTerm: TermCountRow[];
};

function bump<K>(m: Map<K, number>, k: K) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function sortedLabels(m: Map<string, number>): LabelCount[] {
  return [...m.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
function sortedLevels(m: Map<string, number>): LevelCountRow[] {
  return [...m.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
}

export function rollupMovements(events: MovementEvent[]): MovementRollup {
  const counts = {
    withdrawn: 0,
    lateEnrolled: 0,
    transferred: 0,
    reEnrolled: 0,
  };
  const wReason = new Map<string, number>();
  const wLevel = new Map<string, number>();
  const lLevel = new Map<string, number>();
  const lTerm = new Map<number, number>();

  // reason×level matrix: level → (reasonLabel → count)
  const wReasonByLevel = new Map<string, Map<string, number>>();

  // Controllability tallies: keyed on raw WithdrawalReason enum value
  let controllableCount = 0;
  let structuralCount = 0;
  let unspecifiedCount = 0;

  // Track "top controllable reason" by (reasonLabel, levelLabel, count) for the
  // prescriptive takeaway string.
  const controllableByLabel = new Map<string, number>();
  // Per (reasonLabel × level) count — for concentration analysis.
  const controllableByLabelAndLevel = new Map<string, number>(); // key = `${label}::${level}`

  for (const e of events) {
    const level = movementLevelOf(e);
    if (e.kind === 'withdrawn') {
      counts.withdrawn += 1;
      const reasonLabel = withdrawalReasonLabelOf(e);

      bump(wReason, reasonLabel);
      bump(wLevel, level);

      // Reason×level matrix
      if (!wReasonByLevel.has(level)) wReasonByLevel.set(level, new Map());
      bump(wReasonByLevel.get(level)!, reasonLabel);

      // Controllability — the same classifier the withdrawals drill reads.
      const bucket = controllabilityOf(e.reason);
      if (bucket === 'controllable') {
        controllableCount += 1;
        bump(controllableByLabel, reasonLabel);
        bump(controllableByLabelAndLevel, `${reasonLabel}::${level}`);
      } else if (bucket === 'structural') {
        structuralCount += 1;
      } else {
        unspecifiedCount += 1;
      }
    } else if (e.kind === 'late-enrolled') {
      counts.lateEnrolled += 1;
      bump(lLevel, level);
      if (typeof e.termNumber === 'number') bump(lTerm, e.termNumber);
    } else if (e.kind === 'section-transfer') {
      counts.transferred += 1;
    } else if (e.kind === 're-enrolled') {
      counts.reEnrolled += 1;
    }
  }

  // Build reason×level rows — one row per level, sorted by total withdrawals desc.
  const allReasonKeys = [...wReason.keys()].sort(
    (a, b) => (wReason.get(b) ?? 0) - (wReason.get(a) ?? 0)
  );
  const withdrawalsByReasonAndLevel: WithdrawalByReasonAndLevel[] = [
    ...wReasonByLevel.entries(),
  ]
    .map(([level, reasonMap]) => {
      const reasonCounts: Record<string, number> = {};
      for (const key of allReasonKeys) {
        reasonCounts[key] = reasonMap.get(key) ?? 0;
      }
      const total = [...reasonMap.values()].reduce((s, n) => s + n, 0);
      return { level, reasonCounts, total };
    })
    .sort((a, b) => b.total - a.total || a.level.localeCompare(b.level));

  // Prescriptive controllable takeaway.
  const total = counts.withdrawn;
  const controllablePct =
    total === 0 ? null : Math.round((controllableCount / total) * 1000) / 10;

  let topControllableTakeaway: string | null = null;
  if (controllableCount > 0) {
    // Find the top controllable reason label.
    let topLabel = '';
    let topLabelCount = 0;
    for (const [label, n] of controllableByLabel) {
      if (n > topLabelCount) {
        topLabelCount = n;
        topLabel = label;
      }
    }
    // Find the level where that reason is most concentrated.
    let topLevel = '';
    let topLevelCount = 0;
    for (const [key, n] of controllableByLabelAndLevel) {
      if (!key.startsWith(`${topLabel}::`)) continue;
      if (n > topLevelCount) {
        topLevelCount = n;
        topLevel = key.slice(topLabel.length + 2); // strip 'reason::'
      }
    }
    topControllableTakeaway = topLevel
      ? `${topLabel} is the leading actionable loss — concentrated in ${topLevel} (${topLevelCount} student${topLevelCount === 1 ? '' : 's'}).`
      : `${topLabel} is the leading actionable loss (${topLabelCount} student${topLabelCount === 1 ? '' : 's'}).`;
  }

  return {
    counts,
    withdrawalsByReason: sortedLabels(wReason),
    withdrawalsByLevel: sortedLevels(wLevel),
    withdrawalsByReasonAndLevel,
    withdrawalReasonKeys: allReasonKeys,
    controllability: {
      controllableCount,
      structuralCount,
      unspecifiedCount,
      total,
      controllablePct,
      topControllableTakeaway,
    },
    lateByLevel: sortedLevels(lLevel),
    lateByTerm: [...lTerm.entries()]
      .map(([termNumber, count]) => ({ termNumber, count }))
      .sort((a, b) => a.termNumber - b.termNumber),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// On-roll rows — the ONE predicate every enrolled-population loader and its
// drill share: the year's class rows that are not withdrawn (graduated rows
// included), inner-joined to their section + level. Counted as ROWS.
// ──────────────────────────────────────────────────────────────────────────

export type ServiceClient = ReturnType<typeof createServiceClient>;

export const ON_ROLL_LEVEL_SELECT =
  'section:sections!inner(academic_year_id, levels!inner(label, code))';

export async function resolveAyId(
  service: ServiceClient,
  ayCode: string
): Promise<string | null> {
  const { data } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Every on-roll class row of the year, past the PostgREST 1000-row cap.
 * `select` MUST embed `section:sections!inner(academic_year_id …)` — the
 * year filter runs on that embed.
 */
export function fetchOnRollRows<T>(
  service: ServiceClient,
  ayId: string,
  select: string
): Promise<T[]> {
  // `select` is a runtime string, so supabase-js cannot infer the row type —
  // the cast names it. The builder itself is passed through untouched, so
  // fetchAllPages still appends its `id` tie-break ORDER BY.
  return fetchAllPages<T>(
    (from, to) =>
      service
        .from('section_students')
        .select(select)
        .eq('section.academic_year_id', ayId)
        .neq('enrollment_status', 'withdrawn')
        .range(from, to) as unknown as PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>
  );
}

type LevelEmbedRow = { label: string | null; code: string };
export type OnRollSectionEmbed = {
  id?: string;
  academic_year_id?: string;
  name?: string | null;
  levels: LevelEmbedRow | LevelEmbedRow[] | null;
};
export type OnRollRow = {
  section: OnRollSectionEmbed | OnRollSectionEmbed[] | null;
};

export function sectionOf(r: OnRollRow): OnRollSectionEmbed | null {
  return Array.isArray(r.section) ? (r.section[0] ?? null) : r.section;
}

/** Enrolled headcount: class rows per level label (Insights §1). */
export function headcountFromRows(rows: OnRollRow[]): RecordsHeadcount {
  const levelCounts = new Map<string, number>();
  for (const r of rows) {
    const sec = sectionOf(r);
    if (!sec) continue;
    const label = levelLabelOf(sec.levels);
    levelCounts.set(label, (levelCounts.get(label) ?? 0) + 1);
  }
  const byLevel: LevelCount[] = [...levelCounts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level));
  const total = byLevel.reduce((s, l) => s + l.count, 0);
  return { total, byLevel };
}

export type EnroleeValueRow = {
  enroleeNumber: string | null;
  category?: string | null;
  nationality?: string | null;
};

/** enroleeNumber → the admissions value, blanks skipped. */
export function valueByEnroleeNumber(
  appRows: EnroleeValueRow[],
  key: 'category' | 'nationality'
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of appRows) {
    const v = a[key];
    if (a.enroleeNumber && v) out.set(a.enroleeNumber, v);
  }
  return out;
}

/** The whole year's applications table, read the way every mix loader reads it. */
export async function fetchEnroleeValueMap(
  service: ServiceClient,
  ayCode: string,
  key: 'category' | 'nationality'
): Promise<Map<string, string>> {
  const appRows = await fetchAllPages<EnroleeValueRow>(
    (from, to) =>
      service
        .from(`${prefixFor(ayCode)}_enrolment_applications`)
        .select(`enroleeNumber, ${key}`)
        .range(from, to) as unknown as PromiseLike<{
        data: EnroleeValueRow[] | null;
        error: { message: string } | null;
      }>
  );
  return valueByEnroleeNumber(appRows, key);
}

/** Nationality × level inputs: section level label + the raw enrolee's nationality. */
export function nationalityByLevelInputs(
  rows: Array<OnRollRow & { enrolee_number: string | null }>,
  nationalityByEnroleeNumber: Map<string, string>
): { level: string; nationality: string | null }[] {
  return rows.map((r) => {
    const en = r.enrolee_number?.trim();
    return {
      level: levelLabelOf(sectionOf(r)?.levels),
      nationality: (en && nationalityByEnroleeNumber.get(en)) || null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Cross-AY retention
// ──────────────────────────────────────────────────────────────────────────

export type Retention = {
  priorAy: string | null;
  returned: number;
  didNotReturn: number;
  priorTotal: number;
  pct: number | null;
};

/** Per-level retention row: how many from priorAy's cohort at this level returned. */
export type LevelRetentionRow = {
  level: string;
  priorTotal: number;
  returned: number;
  didNotReturn: number;
  pct: number | null;
};

export type EnrolRow = OnRollRow & {
  student:
    | { student_number: string | null }
    | { student_number: string | null }[]
    | null;
};

export type EnrolledStudentData = {
  studentNumbers: Set<string>;
  levelByStudentNumber: Map<string, string>;
};

/**
 * One entry per student_number, with the level of the first row that has a
 * section (level is stable within an AY in practice). Rows with no student
 * number are skipped.
 */
export function enrolledStudentDataFrom(rows: EnrolRow[]): EnrolledStudentData {
  const studentNumbers = new Set<string>();
  const levelByStudentNumber = new Map<string, string>();
  for (const r of rows) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!s?.student_number) continue;
    const sn = s.student_number;
    studentNumbers.add(sn);
    if (!levelByStudentNumber.has(sn)) {
      const sec = sectionOf(r);
      if (sec) levelByStudentNumber.set(sn, levelLabelOf(sec.levels));
    }
  }
  return { studentNumbers, levelByStudentNumber };
}

/**
 * Returns both a flat Set of student_numbers AND a map of
 * student_number → level label for per-level retention bucketing.
 * The level label is the canonical word-form from `levels.label`
 * (e.g. "Primary 1"), falling back to `levels.code` ("P1") if missing.
 * When a student appears in multiple sections in the same AY (mid-year
 * transfer), the first non-null level encountered is used — level is
 * stable within an AY in practice.
 */
export async function loadEnrolledStudentData(
  ayCode: string
): Promise<EnrolledStudentData> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId)
    return { studentNumbers: new Set(), levelByStudentNumber: new Map() };
  const rows = await fetchOnRollRows<EnrolRow>(
    service,
    ayId,
    `student:students(student_number), ${ON_ROLL_LEVEL_SELECT}`
  );
  return enrolledStudentDataFrom(rows);
}

export type RetentionCohortMember = {
  studentNumber: string;
  /** Prior-year level label; null when no level is on record. */
  level: string | null;
  returned: boolean;
};

/**
 * The retention cohort: every prior-year student, marked returned when on
 * roll in the current year. The terminal level (S4) graduates rather than
 * leaves, so it is dropped unless `includeTerminal`. A student with no level
 * is NOT assumed terminal.
 */
export function retentionCohortFrom(
  prior: EnrolledStudentData,
  currentNumbers: ReadonlySet<string>,
  opts: { includeTerminal?: boolean } = {}
): RetentionCohortMember[] {
  const out: RetentionCohortMember[] = [];
  for (const sn of prior.studentNumbers) {
    const level = prior.levelByStudentNumber.get(sn) ?? null;
    if (!opts.includeTerminal && isTerminalLevel(level ?? '')) continue;
    out.push({ studentNumber: sn, level, returned: currentNumbers.has(sn) });
  }
  return out;
}

export function retentionFromCohort(
  priorAy: string,
  cohort: RetentionCohortMember[]
): Retention {
  const priorTotal = cohort.length;
  const returned = cohort.filter((m) => m.returned).length;
  return {
    priorAy,
    returned,
    didNotReturn: priorTotal - returned,
    priorTotal,
    pct:
      priorTotal === 0 ? null : Math.round((returned / priorTotal) * 1000) / 10,
  };
}

/** Per prior-year level, worst rate first. Students with no level are skipped. */
export function retentionByLevelFromCohort(
  cohort: RetentionCohortMember[]
): LevelRetentionRow[] {
  const byLevel = new Map<string, { total: number; returned: number }>();
  for (const m of cohort) {
    if (m.level === null) continue;
    const bucket = byLevel.get(m.level) ?? { total: 0, returned: 0 };
    bucket.total += 1;
    if (m.returned) bucket.returned += 1;
    byLevel.set(m.level, bucket);
  }
  return [...byLevel.entries()]
    .map(([level, { total, returned }]) => ({
      level,
      priorTotal: total,
      returned,
      didNotReturn: total - returned,
      pct: total === 0 ? null : Math.round((returned / total) * 1000) / 10,
    }))
    .sort((a, b) => {
      const aRate = a.pct ?? 100;
      const bRate = b.pct ?? 100;
      return aRate - bRate || a.level.localeCompare(b.level);
    });
}

/**
 * Of priorAy's enrolled students, how many are also enrolled in currentAy.
 *
 * The prior-year TERMINAL grade (S4) is excluded from the denominator: those
 * students graduated, so their absence this year is completion, not attrition
 * — counting them would deflate the rate. Consistent with the by-level
 * breakdown, which excludes the same cohort via `isTerminalLevel`.
 */
async function loadRecordsRetention(
  currentAy: string,
  priorAy: string | null
): Promise<Retention> {
  if (!priorAy) {
    return {
      priorAy: null,
      returned: 0,
      didNotReturn: 0,
      priorTotal: 0,
      pct: null,
    };
  }
  const [current, prior] = await Promise.all([
    loadEnrolledStudentData(currentAy),
    loadEnrolledStudentData(priorAy),
  ]);
  return retentionFromCohort(
    priorAy,
    retentionCohortFrom(prior, current.studentNumbers)
  );
}

/**
 * Per-level retention: of each level's cohort in priorAy, how many
 * returned in currentAy (regardless of whether they stayed at the same level).
 * A P6 student who returns as S1 counts as "returned".
 *
 * Hard Rule #4: keyed on student_number throughout — never enroleeNumber.
 */
async function loadRecordsRetentionByLevel(
  currentAy: string,
  priorAy: string | null
): Promise<LevelRetentionRow[]> {
  if (!priorAy) return [];
  const [current, prior] = await Promise.all([
    loadEnrolledStudentData(currentAy),
    loadEnrolledStudentData(priorAy),
  ]);
  return retentionByLevelFromCohort(
    retentionCohortFrom(prior, current.studentNumbers, {
      includeTerminal: true,
    })
  );
}

const CACHE_TTL_SECONDS = 60;

export function getRecordsRetention(
  currentAy: string,
  priorAy: string | null
): Promise<Retention> {
  return unstable_cache(
    () => loadRecordsRetention(currentAy, priorAy),
    ['sis', 'records-retention', currentAy, priorAy ?? ''],
    { tags: ['sis', `sis:${currentAy}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

export function getRecordsRetentionByLevel(
  currentAy: string,
  priorAy: string | null
): Promise<LevelRetentionRow[]> {
  return unstable_cache(
    () => loadRecordsRetentionByLevel(currentAy, priorAy),
    ['sis', 'records-retention-by-level', currentAy, priorAy ?? ''],
    { tags: ['sis', `sis:${currentAy}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Headcount — total enrolled + per-level breakdown for the AY.
// ──────────────────────────────────────────────────────────────────────────

export type RecordsHeadcount = {
  total: number;
  byLevel: LevelCount[];
};

/**
 * Thin sum over getLevelDistribution — total enrolled + the per-level array.
 *
 * NOTE: This reads from `ay{YY}_enrolment_status` (admissions-side). It is
 * used by the Records *dashboard* and kept unchanged to avoid blast radius.
 * The Records *Insights* page uses `getInsightsHeadcount` (section_students)
 * so that §1 headcount and §4 retention share the same enrolled source
 * (KD #90: these two tables drift when admissions rows land Enrolled without a
 * section_students row). Do NOT call this function from the Insights page.
 */
export async function getRecordsHeadcount(
  ayCode: string
): Promise<RecordsHeadcount> {
  const byLevel = await getLevelDistribution(ayCode);
  const total = byLevel.reduce((s, l) => s + l.count, 0);
  return { total, byLevel };
}

/**
 * Insights-scoped headcount — reads `section_students` so that §1 enrolled
 * count and §4 retention (which also reads section_students via
 * `loadEnrolledStudentNumbers`) share the same source and are always
 * internally consistent. Returns per-level counts using the canonical word-form
 * level label (e.g. "Primary 1") for display in the Insights page.
 *
 * Never call this from the Records *dashboard* — use `getRecordsHeadcount`
 * there to preserve backward-compatible behaviour.
 */
export async function getInsightsHeadcount(
  ayCode: string
): Promise<RecordsHeadcount> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return { total: 0, byLevel: [] };
  const rows = await fetchOnRollRows<OnRollRow>(
    service,
    ayId,
    ON_ROLL_LEVEL_SELECT
  );
  return headcountFromRows(rows);
}

// ──────────────────────────────────────────────────────────────────────────
// Enrolled category mix — New vs. Current vs. VizSchool variants.
//
// Enrolled headcount (section_students) and `category` (the admissions-side
// ay{YYYY}_enrolment_applications table) are different sources — crossing
// them means resolving each enrolled student's enrolee_number back to their
// admissions row, and that link is not guaranteed for every historically-
// synced row (the same class of gap Records' "Unsynced students" queue
// already tracks). Any enrolled student whose enrolee_number is null, or
// whose enrolee_number has no matching admissions row, or whose category is
// null/unrecognized, buckets into 'Unspecified' — never silently dropped
// from the total.
// ──────────────────────────────────────────────────────────────────────────

export type EnrolledStudentCategoryRow = { enroleeNumber: string | null };

/**
 * Pure: given the enrolled section_students rows for an AY (each carrying
 * its enrolee_number, possibly null) and an enroleeNumber → category lookup
 * built from that AY's admissions applications table, buckets every
 * enrolled student into their category.
 *
 * All 4 real ENROLEE_CATEGORIES values always appear in the output, even at
 * count 0 (same convention as computeCategoryMix in
 * lib/admissions/insights-funnel.ts). 'Unspecified' is appended ONLY when
 * its count is > 0.
 */
export function computeEnrolledCategoryMix(
  enrolledRows: EnrolledStudentCategoryRow[],
  categoryByEnroleeNumber: Map<string, string>
): CategoryMixRow[] {
  const counts = new Map<string, number>(ENROLEE_CATEGORIES.map((c) => [c, 0]));
  let unspecified = 0;
  for (const r of enrolledRows) {
    const bucket = enrolledCategoryBucket(
      r.enroleeNumber,
      categoryByEnroleeNumber
    );
    if (bucket === UNSPECIFIED_CATEGORY) unspecified += 1;
    else counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const out: CategoryMixRow[] = ENROLEE_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  if (unspecified > 0) {
    out.push({ category: UNSPECIFIED_CATEGORY, count: unspecified });
  }
  return out;
}

async function loadEnrolledCategoryMixUncached(
  ayCode: string
): Promise<CategoryMixRow[]> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return computeEnrolledCategoryMix([], new Map());
  const [enrolledRows, categoryByEnroleeNumber] = await Promise.all([
    fetchOnRollRows<{ enrolee_number: string | null }>(
      service,
      ayId,
      `enrolee_number, ${ON_ROLL_LEVEL_SELECT}`
    ),
    fetchEnroleeValueMap(service, ayCode, 'category'),
  ]);
  return computeEnrolledCategoryMix(
    enrolledRows.map((r) => ({ enroleeNumber: r.enrolee_number })),
    categoryByEnroleeNumber
  );
}

export function getEnrolledCategoryMix(
  ayCode: string
): Promise<CategoryMixRow[]> {
  return unstable_cache(
    () => loadEnrolledCategoryMixUncached(ayCode),
    ['sis', 'enrolled-category-mix', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Enrolled nationality mix
//
// Same two-source cross as the category mix above, and the same rule: an
// enrolled student whose enrolee_number is null, or whose enrolee_number has
// no matching admissions row, or whose nationality is blank, buckets into
// 'Unspecified' — never silently dropped from the total. The Records chart
// total must equal the enrolled headcount shown in the same band, or the
// bucketing is losing students (KD #124: counts agree by construction).
//
// Measured 2026-08-17: all 383 (AY2025) and 406 (AY2026) enrolled students
// carry an enrolee_number, so Unspecified should render at 0 for both. If it
// ever appears, that is a real sync gap worth chasing, not a display quirk.
//
// The folding, aliasing and ordering all come from computeNationalityMix in
// lib/admissions/insights-funnel.ts — one implementation, so the Admissions
// and Records charts can never disagree about how a country is spelled or
// where 'Other' sits.
// ──────────────────────────────────────────────────────────────────────────

export function computeEnrolledNationalityMix(
  enrolledRows: EnrolledStudentCategoryRow[],
  nationalityByEnroleeNumber: Map<string, string>,
  limit = 8
): NationalityMixRow[] {
  return computeNationalityMix(
    enrolledRows.map((r) => {
      const en = r.enroleeNumber?.trim();
      return {
        nationality: (en && nationalityByEnroleeNumber.get(en)) || null,
      };
    }),
    limit
  );
}

async function loadEnrolledNationalityMixUncached(
  ayCode: string
): Promise<NationalityMixRow[]> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return computeEnrolledNationalityMix([], new Map());
  const [enrolledRows, nationalityByEnroleeNumber] = await Promise.all([
    fetchOnRollRows<{ enrolee_number: string | null }>(
      service,
      ayId,
      `enrolee_number, ${ON_ROLL_LEVEL_SELECT}`
    ),
    fetchEnroleeValueMap(service, ayCode, 'nationality'),
  ]);
  return computeEnrolledNationalityMix(
    enrolledRows.map((r) => ({ enroleeNumber: r.enrolee_number })),
    nationalityByEnroleeNumber
  );
}

export function getEnrolledNationalityMix(
  ayCode: string
): Promise<NationalityMixRow[]> {
  return unstable_cache(
    () => loadEnrolledNationalityMixUncached(ayCode),
    ['sis', 'enrolled-nationality-mix', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Nationality × level
//
// Answers the question the flat mix cannot: is the school's diversity spread
// evenly, or does it sit in particular year groups?
//
// RECORDS ONLY, DELIBERATELY. The obvious alternative — cross Admissions'
// `levelApplied` — was measured on production 2026-08-17 and rejected: it
// carries 79 blanks in AY2025 (9.6%) and five inconsistent spellings of the
// Youngstarters levels ("Youngstarters", "YoungStarter Little Star",
// "Youngstarters | Junior Stars", …), so the same year group would draw as
// several near-duplicate rows. Enrolled students take their level from the
// managed `levels` table instead — exactly 10 values, no drift, no blanks.
// Tidying `levelApplied` is the school's data decision, not this chart's.
//
// One shared legend across every level. The top nationalities are chosen
// GLOBALLY, not per level, so a colour means the same thing on every bar —
// per-level top-N would silently relabel the segments row to row.
// ──────────────────────────────────────────────────────────────────────────

async function loadEnrolledNationalityByLevelUncached(
  ayCode: string
): Promise<NationalityByLevel> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return computeNationalityByLevel([]);
  const [enrolledRows, nationalityByEnroleeNumber] = await Promise.all([
    fetchOnRollRows<OnRollRow & { enrolee_number: string | null }>(
      service,
      ayId,
      `enrolee_number, ${ON_ROLL_LEVEL_SELECT}`
    ),
    fetchEnroleeValueMap(service, ayCode, 'nationality'),
  ]);
  return computeNationalityByLevel(
    nationalityByLevelInputs(enrolledRows, nationalityByEnroleeNumber)
  );
}

export function getEnrolledNationalityByLevel(
  ayCode: string
): Promise<NationalityByLevel> {
  return unstable_cache(
    () => loadEnrolledNationalityByLevelUncached(ayCode),
    ['sis', 'enrolled-nationality-by-level', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Net-movement trend — one AyTrendPoint per (AY, month-of-year).
//
// Net movement = enrolments(+) − withdrawals(−) for each calendar month.
// "Enrolment" events: late-enrolled + re-enrolled (first-time enrolments are
// handled by the headcount loaders; what we track here is mid-year movement).
// "Withdrawal" events: withdrawn.
// Section-transfers are excluded (not a population change).
//
// Month label is the abbreviated 3-letter month name derived from the event
// date (yyyy-mm-dd), locale-independent.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pure: compute per-month net movement from a pre-fetched events array for
 * one AY. Returns 12 points (Jan–Dec), value = net (can be 0 or negative).
 *
 * `isCurrent` (the DB `is_current` flag for `ayCode`, KD honesty rule) gates
 * the future-month clamp: when true, months after `today`'s real calendar
 * month are null (a gap in the chart — unchanged behavior for the truly-
 * current AY). When false, NO clamp is applied — every saved month renders,
 * including honest zeros.
 *
 * The cutoff is derived from `today`'s own calendar month index, never from
 * `ayCode`'s digits — the old mask built a date string from the AY code's
 * numeric year (`"${ayCode-year}-${month}-01" > today`), which is always
 * lexically "in the future" for a future-coded AY holding real data (the
 * AY9999 test environment, seeded with 2026-dated rows), nulling out every
 * month regardless of what actually happened. Keying the clamp on `isCurrent`
 * alone — and computing it from `today`'s real month, not the code's year —
 * fixes that for both current AND non-current future-coded AYs.
 */
export function netMovementByMonth(
  events: MovementEvent[],
  ayCode: string,
  today: string,
  isCurrent: boolean
): AyTrendPoint[] {
  const net = new Array<number>(12).fill(0);
  for (const e of events) {
    const monthIdx = movementMonthIndex(e.date);
    if (monthIdx < 0) continue;
    if (isMidYearJoinKind(e.kind)) {
      net[monthIdx] += 1;
    } else if (e.kind === 'withdrawn') {
      net[monthIdx] -= 1;
    }
    // section-transfer: no population change → skip
  }
  const todayMonthIdx = Number(today.slice(5, 7)) - 1; // 0-based
  return MONTH_LABELS.map((label, i) => {
    // Null for months after today's real calendar month — but ONLY for the
    // DB-current AY. Non-current AYs (historical, or a future-coded AY not
    // currently active) render exactly what is saved, unclamped.
    const value = isCurrent && i > todayMonthIdx ? null : net[i];
    return { periodLabel: label, ayCode, value };
  });
}

export type MonthlyMovementPoint = {
  month: string;
  enrollments: number;
  withdrawals: number;
};

/**
 * Pure: buckets a pre-fetched movement-events array into one
 * `{month, enrollments, withdrawals}` point per label in `months` (in the
 * order given). "Enrollments" = late-enrolled + re-enrolled (mid-year
 * joins); "withdrawals" = withdrawn. Section-transfers carry no population
 * change and are excluded — mirrors `netMovementByMonth`'s own event-kind
 * classification, just split into two always-positive counts instead of one
 * signed net.
 *
 * Honest by construction, no clamp needed: `events` only ever contains real,
 * already-happened audit rows, so a not-yet-arrived month simply has no
 * events (0) — never a fabricated or clamped value (contrast
 * `netMovementByMonth`, which reads a pre-aggregated monthly series and DOES
 * need the `isCurrent` future-month clamp).
 */
export function monthlyMovementSeries(
  events: MovementEvent[],
  months: readonly string[]
): MonthlyMovementPoint[] {
  const enrollments = new Array(months.length).fill(0);
  const withdrawals = new Array(months.length).fill(0);
  for (const e of events) {
    const monthIdx = movementMonthIndex(e.date);
    if (monthIdx < 0 || monthIdx >= months.length) continue;
    if (isMidYearJoinKind(e.kind)) {
      enrollments[monthIdx] += 1;
    } else if (e.kind === 'withdrawn') {
      withdrawals[monthIdx] += 1;
    }
    // section-transfer: no population change → skip
  }
  return months.map((month, i) => ({
    month,
    enrollments: enrollments[i],
    withdrawals: withdrawals[i],
  }));
}

/**
 * The in-progress calendar month for the DB-current AY's movement trend as
 * of `today` (`yyyy-MM-dd`, SGT per KD #32) — the month whose net-movement
 * count is a PARTIAL total, not a finished month — or `null` when
 * `isCurrent` is false (a non-current AY, historical or future-coded, has
 * no partial month; it renders exactly what is saved, KD-honesty rule).
 * Mirrors `netMovementByMonth`'s month-index math exactly.
 *
 * Used by the Insights caption's honesty guard (`summariseAyTrend`'s
 * `inProgressPeriod` option) so a few days of net movement this month aren't
 * compared against a full historical month as a fabricated decline.
 */
export function currentInProgressMonthLabel(
  isCurrent: boolean,
  today: string
): (typeof MONTH_LABELS)[number] | null {
  if (!isCurrent) return null;
  const monthIdx = Number(today.slice(5, 7)) - 1; // 0-based
  if (monthIdx < 0 || monthIdx > 11) return null;
  return MONTH_LABELS[monthIdx];
}

/**
 * Backfill-resolution guard (pure).
 *
 * Backfilled AY movement events all carry the migration/backfill run-date in
 * `audit_log.created_at`, so an entire year of activity piles into 1-2
 * months — overlaying that series on the movement trend chart would read as
 * fabricated seasonality, not a real monthly pattern. Given ONE AY's monthly
 * points (12 points, one per month), this returns true only when the
 * non-zero, non-null months span at least 2 distinct months — i.e. there is
 * genuine monthly resolution behind the series, not a single-month pile-up.
 */
export function hasMonthlyResolution(points: AyTrendPoint[]): boolean {
  const monthsWithActivity = new Set(
    points
      .filter((p) => p.value !== null && p.value !== 0)
      .map((p) => p.periodLabel)
  );
  return monthsWithActivity.size >= 2;
}

/** One AY the movement trend is requested for, plus whether the DB flags it
 *  `is_current` (`getCurrentAcademicYear`'s `ay_code`) — the clamp fix's
 *  single source of truth for "has this AY's calendar caught up to today." */
export type AyMovementRequest = { ayCode: string; isCurrent: boolean };

/**
 * Async loader: fetches movement events for each AY and returns the combined
 * array of AyTrendPoints for use with buildAyTrend + AyComparisonLineChart.
 */
export async function getMovementTrendByAy(
  ays: AyMovementRequest[],
  today: string
): Promise<AyTrendPoint[]> {
  if (ays.length === 0) return [];
  const eventsByAy = await Promise.all(
    ays.map((a) => getMovementEvents(a.ayCode))
  );
  const points: AyTrendPoint[] = [];
  for (let i = 0; i < ays.length; i++) {
    const monthPoints = netMovementByMonth(
      eventsByAy[i],
      ays[i].ayCode,
      today,
      ays[i].isCurrent
    );
    points.push(...monthPoints);
  }
  return points;
}

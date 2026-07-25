import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import type { CategoryMixRow } from '@/lib/admissions/insights-funnel';
import { growthDelta, type Growth } from '@/lib/dashboard/growth';
import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';
import {
  WITHDRAWAL_REASON_LABELS,
  WITHDRAWAL_REASON_VALUES,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
import { LEVEL_LABELS } from '@/lib/sis/levels';
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

/**
 * Controllability classification for withdrawal reasons.
 * controllable = school can realistically act on it;
 * structural   = largely external, school cannot prevent.
 */
export type WithdrawalControllability = 'controllable' | 'structural';

/**
 * Maps every WITHDRAWAL_REASON_VALUES member to controllable or structural.
 * Classification:
 *   financial       → controllable (payment plans, fee concessions)
 *   disciplinary    → controllable (behavioural intervention, mediation)
 *   academic_fit    → controllable (academic support, parental engagement)
 *   transferred_other_school → structural (family choice; departure already done)
 *   family_relocation        → structural (geography; out of school's hands)
 *   health          → structural (medical — school can support but rarely change)
 *   other           → structural (catch-all; unknown cause ≠ actionable)
 *
 * NOTE: 'other' and null/Unspecified are treated as structural so the
 * "controllable %" is always conservative (never inflated by unknowns).
 */
export const WITHDRAWAL_CONTROLLABILITY: Record<
  WithdrawalReason,
  WithdrawalControllability
> = {
  financial: 'controllable',
  disciplinary: 'controllable',
  academic_fit: 'controllable',
  transferred_other_school: 'structural',
  family_relocation: 'structural',
  health: 'structural',
  other: 'structural',
} satisfies Record<WithdrawalReason, WithdrawalControllability>;

// Compile-time exhaustiveness guard — if WITHDRAWAL_REASON_VALUES ever gains a
// new member, the satisfies above will produce a type error until we classify it.
const _exhaustive: typeof WITHDRAWAL_CONTROLLABILITY =
  WITHDRAWAL_CONTROLLABILITY;
void _exhaustive;

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

const UNSPECIFIED = 'Unspecified';
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
    const level = (e.level ?? '').trim() || 'Unknown';
    if (e.kind === 'withdrawn') {
      counts.withdrawn += 1;
      const reasonLabel =
        ((e as { reasonLabel?: string | null }).reasonLabel ?? '').trim() ||
        UNSPECIFIED;
      const rawReason = (
        (e as { reason?: string | null }).reason ?? ''
      ).trim() as WithdrawalReason | '';

      bump(wReason, reasonLabel);
      bump(wLevel, level);

      // Reason×level matrix
      if (!wReasonByLevel.has(level)) wReasonByLevel.set(level, new Map());
      bump(wReasonByLevel.get(level)!, reasonLabel);

      // Controllability classification using raw enum key.
      if (
        rawReason &&
        (WITHDRAWAL_REASON_VALUES as readonly string[]).includes(rawReason)
      ) {
        const controllability =
          WITHDRAWAL_CONTROLLABILITY[rawReason as WithdrawalReason];
        if (controllability === 'controllable') {
          controllableCount += 1;
          bump(controllableByLabel, reasonLabel);
          bump(controllableByLabelAndLevel, `${reasonLabel}::${level}`);
        } else {
          structuralCount += 1;
        }
      } else {
        // No raw reason (null or unrecognized) → unspecified → structural bucket
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
// Cross-AY retention
// ──────────────────────────────────────────────────────────────────────────

/**
 * Terminal grade codes. A prior-year student in one of these levels GRADUATED
 * — their absence the next year is completion, not attrition — so they are
 * excluded from retention entirely (both the overall rate below AND the
 * by-level breakdown on the Insights page, which imports `isTerminalLevel`).
 * Post-migration 086 the catalog is a fixed P1–P6 / S1–S4, so S4 is the only
 * terminal level; a set keeps it obvious and extensible.
 */
export const TERMINAL_LEVEL_CODES: ReadonlySet<string> = new Set(['S4']);

// Every terminal code is a real catalog key, so the mapped labels are all
// defined — no filtering needed.
const TERMINAL_LEVEL_LABELS: ReadonlySet<string> = new Set(
  [...TERMINAL_LEVEL_CODES].map(
    (code) => LEVEL_LABELS[code as keyof typeof LEVEL_LABELS]
  )
);

/**
 * True when a level value is a terminal grade. Accepts BOTH the word-form
 * label ("Secondary 4") and the short code ("S4") because
 * `loadEnrolledStudentData` stores the label but falls back to the code when
 * `levels.label` is null — so callers can pass whichever they hold.
 */
export function isTerminalLevel(levelValue: string): boolean {
  const v = levelValue.trim();
  return TERMINAL_LEVEL_CODES.has(v) || TERMINAL_LEVEL_LABELS.has(v);
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
async function loadEnrolledStudentData(ayCode: string): Promise<{
  studentNumbers: Set<string>;
  levelByStudentNumber: Map<string, string>;
}> {
  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId)
    return { studentNumbers: new Set(), levelByStudentNumber: new Map() };

  // Walk past the PostgREST 1000-row cap — a growing school's roster (esp. the
  // prior AY's) can exceed it, and a silent truncation would undercount
  // retention (the exact metric where that goes unnoticed).
  type EnrolRow = {
    student:
      | { student_number: string | null }
      | { student_number: string | null }[]
      | null;
    section:
      | {
          levels:
            | { label: string | null; code: string }
            | { label: string | null; code: string }[]
            | null;
        }
      | {
          levels:
            | { label: string | null; code: string }
            | { label: string | null; code: string }[]
            | null;
        }[]
      | null;
  };
  const rows = await fetchAllPages<EnrolRow>((from, to) =>
    service
      .from('section_students')
      .select(
        'student:students(student_number), section:sections!inner(academic_year_id, levels!inner(label, code))'
      )
      .eq('section.academic_year_id', ayId)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );

  const studentNumbers = new Set<string>();
  const levelByStudentNumber = new Map<string, string>();
  for (const r of rows) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!s?.student_number) continue;
    const sn = s.student_number;
    studentNumbers.add(sn);
    if (!levelByStudentNumber.has(sn)) {
      const sec = Array.isArray(r.section) ? r.section[0] : r.section;
      if (sec) {
        const lvl = Array.isArray(sec.levels) ? sec.levels[0] : sec.levels;
        const label = lvl?.label?.trim() || lvl?.code?.trim() || 'Unknown';
        levelByStudentNumber.set(sn, label);
      }
    }
  }
  return { studentNumbers, levelByStudentNumber };
}

/**
 * @deprecated Use `loadEnrolledStudentData` for new callers.
 * Kept as a thin wrapper to avoid breaking `loadRecordsRetention`.
 */
async function loadEnrolledStudentNumbers(
  ayCode: string
): Promise<Set<string>> {
  const { studentNumbers } = await loadEnrolledStudentData(ayCode);
  return studentNumbers;
}

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
  const [currentNumbers, priorData] = await Promise.all([
    loadEnrolledStudentNumbers(currentAy),
    loadEnrolledStudentData(priorAy),
  ]);
  let returned = 0;
  let priorTotal = 0;
  for (const sn of priorData.studentNumbers) {
    // A student with no level on record is NOT assumed terminal — counted, so
    // the exclusion never over-reaches on missing data.
    const level = priorData.levelByStudentNumber.get(sn) ?? '';
    if (isTerminalLevel(level)) continue;
    priorTotal += 1;
    if (currentNumbers.has(sn)) returned += 1;
  }
  return {
    priorAy,
    returned,
    didNotReturn: priorTotal - returned,
    priorTotal,
    pct:
      priorTotal === 0 ? null : Math.round((returned / priorTotal) * 1000) / 10,
  };
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
  const [currentData, priorData] = await Promise.all([
    loadEnrolledStudentData(currentAy),
    loadEnrolledStudentData(priorAy),
  ]);
  const currentNumbers = currentData.studentNumbers;
  const priorLevelMap = priorData.levelByStudentNumber;

  // Bucket prior-year students by their prior-year level.
  const byLevel = new Map<string, { total: number; returned: number }>();
  for (const [sn, level] of priorLevelMap) {
    if (!byLevel.has(level)) byLevel.set(level, { total: 0, returned: 0 });
    const bucket = byLevel.get(level)!;
    bucket.total += 1;
    if (currentNumbers.has(sn)) bucket.returned += 1;
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
      // Sort by retention rate ascending (worst first — the levels losing most
      // students are the most diagnostically interesting).
      const aRate = a.pct ?? 100;
      const bRate = b.pct ?? 100;
      return aRate - bRate || a.level.localeCompare(b.level);
    });
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
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return { total: 0, byLevel: [] };

  type SsRow = {
    section:
      | {
          levels:
            | { label: string | null; code: string }
            | { label: string | null; code: string }[]
            | null;
        }
      | {
          levels:
            | { label: string | null; code: string }
            | { label: string | null; code: string }[]
            | null;
        }[]
      | null;
  };

  const rows = await fetchAllPages<SsRow>((from, to) =>
    service
      .from('section_students')
      .select(
        'section:sections!inner(academic_year_id, levels!inner(label, code))'
      )
      .eq('section.academic_year_id', ayId)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );

  const levelCounts = new Map<string, number>();
  for (const r of rows) {
    const sec = Array.isArray(r.section) ? r.section[0] : r.section;
    if (!sec) continue;
    const lvl = Array.isArray(sec.levels) ? sec.levels[0] : sec.levels;
    const label = lvl?.label?.trim() || lvl?.code?.trim() || 'Unknown';
    levelCounts.set(label, (levelCounts.get(label) ?? 0) + 1);
  }

  const byLevel: LevelCount[] = [...levelCounts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level));

  const total = byLevel.reduce((s, l) => s + l.count, 0);
  return { total, byLevel };
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
    const en = r.enroleeNumber?.trim();
    const cat = en ? categoryByEnroleeNumber.get(en) : undefined;
    if (cat && counts.has(cat)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } else {
      unspecified += 1;
    }
  }
  const out: CategoryMixRow[] = ENROLEE_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  if (unspecified > 0) {
    out.push({ category: 'Unspecified', count: unspecified });
  }
  return out;
}

async function loadEnrolledCategoryMixUncached(
  ayCode: string
): Promise<CategoryMixRow[]> {
  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return computeEnrolledCategoryMix([], new Map());

  type SsRow = { enrolee_number: string | null };
  const enrolledRows = await fetchAllPages<SsRow>((from, to) =>
    service
      .from('section_students')
      .select('enrolee_number, section:sections!inner(academic_year_id)')
      .eq('section.academic_year_id', ayId)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );

  const prefix = prefixFor(ayCode);
  type AppRow = { enroleeNumber: string | null; category: string | null };
  const appRows = await fetchAllPages<AppRow>((from, to) =>
    service
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, category')
      .range(from, to)
  );

  const categoryByEnroleeNumber = new Map<string, string>();
  for (const a of appRows) {
    if (a.enroleeNumber && a.category) {
      categoryByEnroleeNumber.set(a.enroleeNumber, a.category);
    }
  }

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

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

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
    const monthIdx = Number(e.date.slice(5, 7)) - 1; // 0-based
    if (monthIdx < 0 || monthIdx > 11) continue;
    if (e.kind === 'late-enrolled' || e.kind === 're-enrolled') {
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
    const monthIdx = Number(e.date.slice(5, 7)) - 1; // 0-based
    if (monthIdx < 0 || monthIdx >= months.length) continue;
    if (e.kind === 'late-enrolled' || e.kind === 're-enrolled') {
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

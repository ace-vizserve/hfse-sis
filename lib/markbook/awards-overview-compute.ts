// School-wide Awards — pure aggregation.
//
// The per-level awards view (lib/markbook/academic-summary-views.ts,
// `buildAwardsRows`) answers "who in Primary Six earned what". This answers
// "where does the school stand, and who is close to moving up" — one row per
// student, one per grade level, across every level at once.
//
// Runtime-pure: no Supabase client, no `server-only`, no `next/cache`. The
// sweep lives in lib/markbook/overview-data.ts and is shared with the Academic
// Overview, so both pages read one set of rows and one set of thresholds.
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠ STANDING IS NOT AN AWARD, and the distinction is the whole design.
//
// An Award is a year-end fact: it needs all four terms, and until Term 4 is
// graded every single one resolves to "not eligible". Measured on production
// 2026-08-18: of 1,732 (student × examinable subject) pairs, 1,723 had exactly
// two terms marked and NOT ONE had four. So the awards page reads 0 / 0 / 0
// for most of every academic year.
//
// STANDING is where a student's marks sit against the school's own published
// cut-offs, on the terms recorded so far. It decides nothing and predicts
// nothing — it restates existing marks against existing thresholds, the same
// discipline "Worth a look" follows on Academic Summary. Three rules keep it
// honest, and every one of them is load-bearing:
//
//   1. `official` stays null until every term is marked. Standing never fills
//      in for it, and the UI must never paint the two alike.
//   2. Every result carries `termsCounted` / `termsTotal`, so a figure can
//      always say what it was worked out from.
//   3. Nothing here is written back. No projection, no "on track to earn".
// ─────────────────────────────────────────────────────────────────────────

import {
  overallAcademicAward,
  subjectAward,
  type AwardThresholds,
} from '@/lib/compute/awards';
import type {
  OverviewGradeInput,
  OverviewLevelInput,
  OverviewSectionInput,
  OverviewStudentInput,
  OverviewSubjectInput,
  OverviewTermInput,
} from '@/lib/markbook/academic-overview-compute';

// ---------------------------------------------------------------------------
// Inputs.

/**
 * Which ladder is being read.
 *
 * `'overall'` is the Overall Academic Award — the mean of a student's
 * examinable Subject Overalls. Any other value is a subject id, giving that
 * subject's own Subject Award. This is the "Award category" filter, and it sits
 * where Subject sits on Academic Summary; the Gold/Silver/Bronze tier is a
 * different axis and filters the table, not the page.
 */
export type AwardCategory = string;

export const OVERALL_CATEGORY = 'overall';

export type AwardsOverviewFilters = {
  levelId: string | null;
  sectionId: string | null;
  termNumber: number | null;
  category: AwardCategory;
};

export const NO_AWARD_FILTERS: AwardsOverviewFilters = {
  levelId: null,
  sectionId: null,
  termNumber: null,
  category: OVERALL_CATEGORY,
};

export type AwardsOverviewInput = {
  ayCode: string;
  filters?: AwardsOverviewFilters;
  terms: OverviewTermInput[];
  levels: OverviewLevelInput[];
  subjects: OverviewSubjectInput[];
  sections: OverviewSectionInput[];
  students: OverviewStudentInput[];
  grades: OverviewGradeInput[];
  enrolledStudentIds: string[];
  thresholds: AwardThresholds;
};

// ---------------------------------------------------------------------------
// Outputs.

export type AwardTier = 'gold' | 'silver' | 'bronze' | 'none';

export type TierCounts = Record<AwardTier, number>;

export type AwardsStudentRow = {
  studentId: string;
  studentNumber: string;
  fullName: string;
  levelId: string;
  levelLabel: string;
  sectionId: string;
  sectionName: string;
  /** Mean of the marks in scope, 1dp. null when the student has none. */
  score: number | null;
  /** Where that score falls against the school's cut-offs. Never an award. */
  standing: AwardTier | null;
  /**
   * The settled award — non-null only once every term of the year is marked.
   * Null is the normal state for most of the year, and must read as "not yet",
   * never as "none".
   */
  official: AwardTier | null;
  /** Terms this student actually has marks in, against the year's total. */
  termsCounted: number;
  /** Points to the bottom of the next band up. null at Gold, or with no score. */
  toNextBand: number | null;
  /** The band those points would reach. */
  nextBand: Exclude<AwardTier, 'none'> | null;
};

export type AwardsLevelRow = {
  levelId: string;
  levelLabel: string;
  sortOrder: number;
  students: number;
  tiers: TierCounts;
  /** Mean score across the level, 1dp. null when nobody has marks. */
  average: number | null;
  /** How many are within `NEAR_BAND_POINTS` of the next band up. */
  withinReach: number;
};

export type AwardsOverview = {
  ayCode: string;
  filters: AwardsOverviewFilters;
  /** e.g. "Primary Six · Term 2" — null when nothing is narrowed. */
  scopeLabel: string | null;
  /** What the chosen category is called, for headings. */
  categoryLabel: string;
  filterOptions: {
    levels: { id: string; label: string }[];
    sections: { id: string; name: string; levelId: string }[];
    terms: { termNumber: number; label: string }[];
    /** 'overall' plus every examinable subject actually taught. */
    categories: { id: AwardCategory; label: string }[];
  };
  coverage: {
    studentsEnrolled: number;
    studentsWithMarks: number;
    /** Terms with at least one mark in scope, against the year's total. */
    termsMarked: number;
    termsTotal: number;
    /** True only when every term is marked — the point the awards settle. */
    complete: boolean;
  };
  tiers: TierCounts;
  /** Students at Bronze or above, on marks so far. */
  atBronzeOrAbove: number;
  /** Within `NEAR_BAND_POINTS` below a cut-off, per band and in total. */
  withinReach: { bronze: number; silver: number; gold: number; total: number };
  thresholds: AwardThresholds;
  levels: AwardsLevelRow[];
  students: AwardsStudentRow[];
  /** Lowest and highest score in scope, for the distribution axis. */
  range: { min: number; max: number } | null;
};

// ---------------------------------------------------------------------------
// Thresholds.

/**
 * How close counts as "within reach".
 *
 * ⚠ A PRESENTATION CUT-OFF, not a school rule. HFSE defines where each band
 * starts; nobody has said how near counts as near. One point is the smallest
 * span still visible at the 1dp precision every score on this page carries — a
 * tenth would name almost nobody, five would name almost everyone. Measured on
 * production 2026-08-18 it names 66 of 372 students. If the school ever defines
 * its own, replace this and do not let the two drift.
 */
export const NEAR_BAND_POINTS = 1.0;

/**
 * Terms in an award period. FOUR, always — a constant, never `terms.length`.
 *
 * ⚠ This exists because trusting the row count settled 372 awards that do not
 * exist. Production AY2026 is configured with only THREE term rows (the Term 4
 * row was never created — a known SIS Admin gap), so "every term marked" was
 * true after Term 3 and the page declared the year finished in August.
 *
 * The academic year has four terms whatever the `terms` table happens to hold,
 * and lib/compute/annual.ts encodes the same thing in its weights
 * (0.2/0.2/0.2/0.4). A missing term row is missing DATA; it must read as an
 * unfinished year, never as a shorter one.
 */
export const AWARD_PERIOD_TERMS = 4;

// ---------------------------------------------------------------------------
// Helpers.

function emptyTiers(): TierCounts {
  return { gold: 0, silver: 0, bronze: 0, none: 0 };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Which band a score falls in. The ladder itself lives in lib/compute/awards. */
export function bandFor(score: number, thresholds: AwardThresholds): AwardTier {
  if (score < thresholds.bronzeMin) return 'none';
  if (score < thresholds.silverMin) return 'bronze';
  if (score < thresholds.goldMin) return 'silver';
  return 'gold';
}

/** Points to the bottom of the next band up, and which band that is. */
export function distanceToNextBand(
  score: number,
  thresholds: AwardThresholds
): { points: number; band: Exclude<AwardTier, 'none'> } | null {
  const ladder: { min: number; band: Exclude<AwardTier, 'none'> }[] = [
    { min: thresholds.bronzeMin, band: 'bronze' },
    { min: thresholds.silverMin, band: 'silver' },
    { min: thresholds.goldMin, band: 'gold' },
  ];
  for (const rung of ladder) {
    if (score < rung.min) {
      return { points: round1(rung.min - score), band: rung.band };
    }
  }
  // Already Gold — there is nothing above it.
  return null;
}

/** The awards ladder's labels, back to a tier key. */
function labelToTier(label: string | null): AwardTier | null {
  if (label === 'Gold') return 'gold';
  if (label === 'Silver') return 'silver';
  if (label === 'Bronze') return 'bronze';
  if (label == null) return null;
  // "Not eligible for …Award" — a real, settled result, not missing data.
  return 'none';
}

// ---------------------------------------------------------------------------
// Main entry.

export function computeAwardsOverview(
  input: AwardsOverviewInput
): AwardsOverview {
  const filters = input.filters ?? NO_AWARD_FILTERS;
  const terms = [...input.terms].sort((a, b) => a.termNumber - b.termNumber);
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));
  const levelById = new Map(input.levels.map((l) => [l.id, l]));
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));
  const studentById = new Map(input.students.map((s) => [s.id, s]));
  const termNumberById = new Map(terms.map((t) => [t.id, t.termNumber]));

  // Examinable only, non-N.A., actually marked — the same three rules the
  // Academic Overview runs on, for the same reasons (KD #104, Hard Rule #3).
  const inCategory = (subjectId: string) =>
    filters.category === OVERALL_CATEGORY
      ? subjectById.get(subjectId)?.isExaminable === true
      : subjectId === filters.category;

  const scoped = input.grades.filter(
    (g) =>
      !g.isNa &&
      g.quarterly != null &&
      inCategory(g.subjectId) &&
      (filters.levelId == null || g.levelId === filters.levelId) &&
      (filters.sectionId == null || g.sectionId === filters.sectionId) &&
      (filters.termNumber == null ||
        termNumberById.get(g.termId) === filters.termNumber)
  ) as (OverviewGradeInput & { quarterly: number })[];

  // ---- per (student, subject) means, then per student ----------------------
  const bySubject = new Map<
    string,
    { studentId: string; sum: number; n: number; terms: Set<number> }
  >();
  const placement = new Map<
    string,
    { levelId: string; sectionId: string; termNumber: number }
  >();

  for (const g of scoped) {
    const key = `${g.studentId} ${g.subjectId}`;
    const slot = bySubject.get(key) ?? {
      studentId: g.studentId,
      sum: 0,
      n: 0,
      terms: new Set<number>(),
    };
    slot.sum += g.quarterly;
    slot.n += 1;
    const tn = termNumberById.get(g.termId) ?? 0;
    slot.terms.add(tn);
    bySubject.set(key, slot);

    // Latest term wins, so a mid-year transfer is counted where they are now.
    const held = placement.get(g.studentId);
    if (!held || tn >= held.termNumber) {
      placement.set(g.studentId, {
        levelId: g.levelId,
        sectionId: g.sectionId,
        termNumber: tn,
      });
    }
  }

  const perStudent = new Map<
    string,
    { overalls: number[]; terms: Set<number> }
  >();
  for (const [, slot] of bySubject) {
    const entry = perStudent.get(slot.studentId) ?? {
      overalls: [],
      terms: new Set<number>(),
    };
    entry.overalls.push(slot.sum / slot.n);
    for (const t of slot.terms) entry.terms.add(t);
    perStudent.set(slot.studentId, entry);
  }

  // A settled award needs all four terms marked — see AWARD_PERIOD_TERMS for
  // why that is a constant rather than `terms.length`. When the term filter
  // narrows to one, no award can settle at all (a single term is not an award
  // period), so `complete` stays false and `official` stays null throughout.
  const termsTotal = AWARD_PERIOD_TERMS;
  const termsMarkedInScope = new Set(
    scoped.map((g) => termNumberById.get(g.termId) ?? 0)
  );
  const yearComplete =
    filters.termNumber == null && termsMarkedInScope.size === termsTotal;

  const enrolled = new Set(input.enrolledStudentIds);

  // ---- student rows -------------------------------------------------------
  const rows: AwardsStudentRow[] = [];
  for (const [studentId, entry] of perStudent) {
    const student = studentById.get(studentId);
    const where = placement.get(studentId);
    if (!student || !where) continue;

    const raw = mean(entry.overalls);
    const score = raw == null ? null : round1(raw);
    const standing = score == null ? null : bandFor(score, input.thresholds);
    const next =
      score == null ? null : distanceToNextBand(score, input.thresholds);

    // The settled award goes through lib/compute/awards, never a second ladder
    // — that module self-tests against HFSE's own IFS formulas on load.
    const eligibility = {
      enrolled: enrolled.has(studentId),
      hasCompleteData: entry.terms.size === termsTotal && termsTotal > 0,
    };
    const label = !yearComplete
      ? null
      : filters.category === OVERALL_CATEGORY
        ? overallAcademicAward(score, input.thresholds, eligibility)
        : subjectAward(score, input.thresholds, eligibility);

    rows.push({
      studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      levelId: where.levelId,
      levelLabel: levelById.get(where.levelId)?.label ?? '',
      sectionId: where.sectionId,
      sectionName: sectionById.get(where.sectionId)?.name ?? '',
      score,
      standing,
      official: labelToTier(label),
      termsCounted: entry.terms.size,
      toNextBand: next?.points ?? null,
      nextBand: next?.band ?? null,
    });
  }

  // Closest to moving up first — the actionable order, and the reason the
  // column exists at all. A student already at Gold has nowhere to go, so they
  // sort last rather than first.
  rows.sort(
    (a, b) =>
      (a.toNextBand ?? Number.POSITIVE_INFINITY) -
        (b.toNextBand ?? Number.POSITIVE_INFINITY) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.fullName.localeCompare(b.fullName)
  );

  // ---- roll-ups -----------------------------------------------------------
  const tiers = emptyTiers();
  const withinReach = { bronze: 0, silver: 0, gold: 0, total: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const r of rows) {
    if (r.standing) tiers[r.standing] += 1;
    if (r.score != null) {
      min = Math.min(min, r.score);
      max = Math.max(max, r.score);
    }
    if (
      r.nextBand &&
      r.toNextBand != null &&
      r.toNextBand <= NEAR_BAND_POINTS
    ) {
      withinReach[r.nextBand] += 1;
      withinReach.total += 1;
    }
  }

  const levelLabel = filters.levelId
    ? (levelById.get(filters.levelId)?.label ?? null)
    : null;
  const sectionName = filters.sectionId
    ? (sectionById.get(filters.sectionId)?.name ?? null)
    : null;
  const termLabel =
    filters.termNumber != null ? `Term ${filters.termNumber}` : null;
  const scopeParts = [levelLabel, sectionName, termLabel].filter(
    (p): p is string => !!p
  );

  return {
    ayCode: input.ayCode,
    filters,
    scopeLabel: scopeParts.length > 0 ? scopeParts.join(' · ') : null,
    categoryLabel:
      filters.category === OVERALL_CATEGORY
        ? 'Overall Academic Award'
        : `${subjectById.get(filters.category)?.name ?? 'Subject'} Award`,
    filterOptions: {
      levels: input.levels.map((l) => ({ id: l.id, label: l.label })),
      sections: input.sections,
      terms: terms.map((t) => ({ termNumber: t.termNumber, label: t.label })),
      categories: [
        { id: OVERALL_CATEGORY, label: 'Overall Academic Award' },
        // Only subjects actually taught, so the picker cannot select an empty
        // scope — the rule the Academic Summary subject picker already follows.
        ...input.subjects
          .filter(
            (s) =>
              s.isExaminable && input.grades.some((g) => g.subjectId === s.id)
          )
          .map((s) => ({ id: s.id, label: `${s.name} Award` }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ],
    },
    coverage: {
      studentsEnrolled: enrolled.size,
      studentsWithMarks: rows.length,
      termsMarked: termsMarkedInScope.size,
      termsTotal,
      complete: yearComplete,
    },
    tiers,
    atBronzeOrAbove: tiers.gold + tiers.silver + tiers.bronze,
    withinReach,
    thresholds: input.thresholds,
    levels: buildLevelRows(rows, input.levels),
    students: rows,
    range: Number.isFinite(min) ? { min, max } : null,
  };
}

function buildLevelRows(
  rows: AwardsStudentRow[],
  levels: OverviewLevelInput[]
): AwardsLevelRow[] {
  const byLevel = new Map<string, AwardsStudentRow[]>();
  for (const r of rows) {
    const list = byLevel.get(r.levelId) ?? [];
    list.push(r);
    byLevel.set(r.levelId, list);
  }

  const out: AwardsLevelRow[] = [];
  for (const level of levels) {
    const group = byLevel.get(level.id);
    if (!group || group.length === 0) continue;
    const tiers = emptyTiers();
    let reach = 0;
    for (const r of group) {
      if (r.standing) tiers[r.standing] += 1;
      if (r.toNextBand != null && r.toNextBand <= NEAR_BAND_POINTS) reach += 1;
    }
    const scores = group
      .map((r) => r.score)
      .filter((s): s is number => s != null);
    const avg = mean(scores);
    out.push({
      levelId: level.id,
      levelLabel: level.label,
      sortOrder: level.sortOrder,
      students: group.length,
      tiers,
      average: avg == null ? null : round1(avg),
      withinReach: reach,
    });
  }

  // The school ladder, not a ranking — order carries progression, exactly as it
  // does on the Academic Summary level table.
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the page, the export and the tests.

export const TIER_DISPLAY_ORDER: { key: AwardTier; label: string }[] = [
  { key: 'gold', label: 'Gold' },
  { key: 'silver', label: 'Silver' },
  { key: 'bronze', label: 'Bronze' },
  { key: 'none', label: 'Not eligible' },
];

/** Total students behind a tier set — the denominator for a spread bar. */
export function tierTotal(tiers: TierCounts): number {
  return tiers.gold + tiers.silver + tiers.bronze + tiers.none;
}

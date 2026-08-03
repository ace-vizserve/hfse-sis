import type { PriorTermGrade } from '@/lib/markbook/grade-diff';

// The grading sheet's term-over-term alert.
//
// The threshold was a bare `5` repeated in four places — the comparison, the
// chip's aria-label, and three lines of dialog copy — which could silently
// disagree after any one of them was edited. One constant now, imported by
// all of them.
//
// It stays a CODE constant rather than moving to `school_config`, following
// `AT_RISK_ATTENDANCE_THRESHOLD_PCT`: this is a display heuristic for drawing
// a teacher's eye, not a policy HFSE has adopted. Move it to config the day
// they tell us what the number should be, and not before — a tunable knob
// nobody has an opinion about is just another empty admin field.
export const GRADE_ALERT_THRESHOLD = 5;

/**
 * Which components a term-over-term comparison covers.
 *
 * `quarterly` is the term grade — what the alert compared before. The other
 * three are the ask from the 2026-07-31 training: Koh and Hermilita wanted
 * this "not only for the quizzes, but also for exam", and a term grade can
 * hold still while written work falls and the exam rises to cover it.
 *
 * These are PERCENTAGES of each component's own total, already stored per
 * entry, so they are comparable across terms even though the assessments
 * behind them differ. Individual slots are not: `ww_scores[0]` in Term 1 and
 * Term 2 are unrelated assessments — the arrays are resized per sheet and the
 * labels are free text — so a per-slot cross-term diff would be noise dressed
 * up as a signal.
 */
export const ALERT_METRICS = [
  { key: 'quarterly', label: 'Term grade' },
  { key: 'ww', label: 'Written work' },
  { key: 'pt', label: 'Performance tasks' },
  { key: 'qa', label: 'Exam' },
] as const;

export type AlertMetric = (typeof ALERT_METRICS)[number]['key'];

export function priorValueFor(
  prior: PriorTermGrade,
  metric: AlertMetric
): number | null {
  switch (metric) {
    case 'quarterly':
      return prior.quarterly_grade;
    case 'ww':
      return prior.ww_ps;
    case 'pt':
      return prior.pt_ps;
    case 'qa':
      return prior.qa_ps;
  }
}

/**
 * How far a single score sits below this student's own average across the
 * other scored slots on the SAME sheet, as a percentage of each slot's max.
 *
 * This is the half of Koh's ask that no cross-term comparison can answer:
 * "she bombed last week's quiz" happens mid-term, long before a term grade
 * exists to compare. It needs no slot identity and no query — everything is
 * already on screen.
 *
 * Returns the flagged slot indices. A slot is flagged when it is at least
 * `threshold` points below the mean of the student's other scored slots in
 * the same component. Fewer than three scored slots returns nothing: with two
 * points, "below average" is just "the lower one".
 */
export type SlotOutlier = {
  /** 0-based position in the component's score array. */
  index: number;
  /** This slot, as a percentage of its own maximum. */
  pct: number;
  /** The student's mean across their OTHER scored slots in this component. */
  othersMeanPct: number;
};

export function outlierSlots(
  scores: (number | null)[],
  totals: number[],
  threshold: number = GRADE_ALERT_THRESHOLD * 2
): SlotOutlier[] {
  const pct: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    const max = totals[i];
    if (score == null || max == null || max <= 0) continue;
    pct.push({ index: i, value: (score / max) * 100 });
  }
  if (pct.length < 3) return [];

  const out: SlotOutlier[] = [];
  for (const p of pct) {
    const others = pct.filter((q) => q.index !== p.index);
    const mean = others.reduce((sum, q) => sum + q.value, 0) / others.length;
    if (mean - p.value >= threshold) {
      out.push({ index: p.index, pct: p.value, othersMeanPct: mean });
    }
  }
  return out;
}

/** Positions only — what the grid needs to tint the right cells. */
export function outlierSlotIndices(
  scores: (number | null)[],
  totals: number[],
  threshold: number = GRADE_ALERT_THRESHOLD * 2
): number[] {
  return outlierSlots(scores, totals, threshold).map((o) => o.index);
}

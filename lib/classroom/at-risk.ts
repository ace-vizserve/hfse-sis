import {
  ALERT_METRICS,
  GRADE_ALERT_THRESHOLD,
  type AlertMetric,
} from '@/lib/markbook/alert-threshold';
import { numericToLetter } from '@/lib/compute/letter-grade';
import type { PriorTermGrade } from '@/lib/markbook/grade-diff';

// The form adviser's at-risk ranking — the half of Ms Koh's 2026-07-31 ask
// (55:10) that nothing built so far reaches: "the subject teacher OR THE FCA
// got to contact the parents." An adviser marks no subject and so has no
// grading sheet, where the subject-teacher version lives (KD #179).
//
// THE STUDENT IS THE UNIT, NOT THE SUBJECT. An adviser rings a parent once,
// about a child — so one student is one row, and the subjects that slipped are
// the detail inside it. A per-subject list would put the same child in front of
// them four times and answer a question nobody asked.
//
// Reuses `GRADE_ALERT_THRESHOLD` and `ALERT_METRICS` rather than restating
// them: a teacher who sees a five-point drop flagged on their own sheet must
// see the same student flagged on the adviser's list, or the two surfaces
// disagree about what "at risk" means.

/** One subject's four component values for the term being looked at. */
export type CurrentComponents = {
  quarterly: number | null;
  ww: number | null;
  pt: number | null;
  qa: number | null;
};

export type AtRiskObservation = {
  sectionStudentId: string;
  subject: string;
  /**
   * MAPEH and the other letter-graded subjects store a band-representative
   * integer in `quarterly_grade` standing in for a letter (KD #104). A student
   * moving down one band changes that integer by about five, which this would
   * otherwise report as "fell 5 points" — a sentence that is not true in the
   * way an adviser will read it.
   */
  isExaminable: boolean;
  current: CurrentComponents;
  /** Ascending by term_number, as `loadPriorTermGrades` returns them. */
  priors: PriorTermGrade[];
};

export type AtRiskStudentRef = {
  sectionStudentId: string;
  studentNumber: string;
  studentName: string;
  indexNumber: number;
};

export type AtRiskInput = {
  students: AtRiskStudentRef[];
  observations: AtRiskObservation[];
};

export type AtRiskDrop = {
  subject: string;
  metric: AlertMetric;
  metricLabel: string;
  priorTermLabel: string;
  prior: number;
  current: number;
  /** Negative. `current - prior`. */
  diff: number;
  /**
   * How the two values should READ. For an examinable subject that is the
   * numbers themselves; for a letter-graded one it is the band each number
   * stands for, so the row says "Very Good → Good" rather than "87 → 82".
   * Computed here rather than in the component so every consumer — a future
   * export, an email, a second screen — tells the same story.
   */
  display: { prior: string; current: string; kind: 'points' | 'band' };
};

export type AtRiskStudent = AtRiskStudentRef & {
  /** Steepest first. */
  drops: AtRiskDrop[];
  /** The steepest single fall — what the list is ranked on. */
  worstDiff: number;
};

function currentValue(
  c: CurrentComponents,
  metric: AlertMetric
): number | null {
  return c[metric === 'quarterly' ? 'quarterly' : metric];
}

function priorValue(p: PriorTermGrade, metric: AlertMetric): number | null {
  switch (metric) {
    case 'quarterly':
      return p.quarterly_grade;
    case 'ww':
      return p.ww_ps;
    case 'pt':
      return p.pt_ps;
    case 'qa':
      return p.qa_ps;
  }
}

/**
 * The most recent prior term that actually carries a mark for this metric.
 *
 * NOT simply the last prior term. A subject can go unmarked for a whole term —
 * a sheet created late, a subject that started mid-year — and taking that empty
 * term as the baseline would silently say nothing about a student who has in
 * fact fallen since the last real mark.
 */
function baselineFor(
  priors: PriorTermGrade[],
  metric: AlertMetric
): { label: string; value: number } | null {
  for (let i = priors.length - 1; i >= 0; i--) {
    const value = priorValue(priors[i], metric);
    if (value != null) return { label: priors[i].term_label, value };
  }
  return null;
}

/**
 * How a fall should read.
 *
 * A letter-graded subject's stored number is a stand-in for a band, so only the
 * TERM GRADE carries a band — the written-work and exam percentages underneath
 * it are ordinary percentages even there, and converting those to letters would
 * invent a meaning the data does not have.
 */
function describe(
  prior: number,
  current: number,
  obs: AtRiskObservation,
  metric: AlertMetric
): AtRiskDrop['display'] {
  if (obs.isExaminable || metric !== 'quarterly') {
    return { prior: String(prior), current: String(current), kind: 'points' };
  }
  return {
    prior: numericToLetter(prior),
    current: numericToLetter(current),
    kind: 'band',
  };
}

/**
 * Students whose marks have fallen at least `GRADE_ALERT_THRESHOLD` points in
 * any subject, on any component, since their most recent marked term. Steepest
 * fall first.
 *
 * A student with no prior term, or no mark yet this term, produces nothing —
 * "we cannot tell" is not "at risk", and a list that flagged every late
 * enrollee is a list an adviser stops opening.
 */
export function rankAtRisk(input: AtRiskInput): AtRiskStudent[] {
  const byStudent = new Map<string, AtRiskDrop[]>();

  for (const obs of input.observations) {
    for (const { key: metric, label } of ALERT_METRICS) {
      const current = currentValue(obs.current, metric);
      if (current == null) continue;
      const baseline = baselineFor(obs.priors, metric);
      if (!baseline) continue;

      const diff = current - baseline.value;
      if (diff > -GRADE_ALERT_THRESHOLD) continue;

      const drops = byStudent.get(obs.sectionStudentId) ?? [];
      drops.push({
        subject: obs.subject,
        metric,
        metricLabel: label,
        priorTermLabel: baseline.label,
        prior: baseline.value,
        current,
        diff,
        display: describe(baseline.value, current, obs, metric),
      });
      byStudent.set(obs.sectionStudentId, drops);
    }
  }

  const out: AtRiskStudent[] = [];
  for (const student of input.students) {
    const drops = byStudent.get(student.sectionStudentId);
    if (!drops || drops.length === 0) continue;
    drops.sort((a, b) => a.diff - b.diff);
    out.push({ ...student, drops, worstDiff: drops[0].diff });
  }

  // Steepest first; ties keep roster order, so the list is stable between
  // refreshes and an adviser can work down it.
  out.sort((a, b) => a.worstDiff - b.worstDiff);
  return out;
}

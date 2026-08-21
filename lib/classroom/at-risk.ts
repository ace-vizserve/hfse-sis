import {
  ALERT_METRICS,
  GRADE_ALERT_THRESHOLD,
  type AlertMetric,
} from '@/lib/markbook/alert-threshold';
import { numericToLetter } from '@/lib/compute/letter-grade';
import { fmtGrade } from '@/lib/markbook/format-grade';
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
  /** This term's marks per component — what the percentages are percentages of. */
  currentMarks?: Partial<
    Record<'ww' | 'pt' | 'qa', { scored: number | null; max: number | null }>
  >;
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
  /** Names the last column of every term history. "Term 2", not "T2". */
  currentTermLabel: string;
};

/**
 * One subject's whole year for one student — every term side by side.
 *
 * The list answers "who fell"; this answers "what has this child been doing all
 * year", which is the question an adviser actually has once a name is in front
 * of them. Mr Ace, 2026-08-21: "why not just show the same data in look up
 * student when a selected student is clicked?" The values are already loaded
 * to compute the drops; this stops throwing them away.
 */
/** Marks scored out of marks available. Either half may be unknown. */
export type Marks = { scored: number | null; max: number | null };

export type SubjectTermHistory = {
  subject: string;
  isExaminable: boolean;
  /** Ascending by term. The term being looked at is last. */
  terms: {
    label: string;
    quarterly: number | null;
    ww: number | null;
    pt: number | null;
    qa: number | null;
    /**
     * What each percentage is a percentage OF, per component.
     *
     * Raw numbers rather than a joined "44 / 50" string: the table gives Score
     * and Out of their own columns, and a total that changed between terms has
     * to be detected by comparing the numbers.
     */
    marks?: Partial<Record<'ww' | 'pt' | 'qa', Marks>>;
  }[];
  /** Whether any component fell far enough to flag. Drives what opens. */
  fell: boolean;
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
  /** Steepest first. Empty for a student who has not fallen anywhere. */
  drops: AtRiskDrop[];
  /** The steepest single fall, or null when nothing fell. */
  worstDiff: number | null;
  /** Every subject the class takes, whether or not it fell. */
  subjects: SubjectTermHistory[];
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
    return {
      prior: fmtGrade(prior),
      current: fmtGrade(current),
      kind: 'points',
    };
  }
  return {
    prior: numericToLetter(prior),
    current: numericToLetter(current),
    kind: 'band',
  };
}

/**
 * THE WHOLE ROSTER, with each student's falls attached.
 *
 * This used to return the flagged subset and drop everyone else on the floor,
 * which made the adviser's panel a triage list and nothing else — a steady
 * class rendered as an empty screen, and there was no way to look a particular
 * child up. Mr Ace, 2026-08-21: "list all students sorted by index numbers and
 * a filter dropdown to show only flagged students or all." The filtering is the
 * reader's to do now, so this hands over everything it knows.
 *
 * A fall is at least `GRADE_ALERT_THRESHOLD` points on any component of any
 * subject, measured from that metric's most recent marked term. A student with
 * no prior term, or no mark yet this term, has no drops — "we cannot tell" is
 * not "at risk", and a filter that caught every late enrollee is a filter an
 * adviser stops using.
 *
 * Order: steepest fall first, then everyone else in roster order. Ties keep
 * roster order, so the list is stable between refreshes.
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

  // Every subject's whole year, per student — built from the same observations
  // the drops came from, so the table and the flag can never disagree.
  const subjectsByStudent = new Map<string, SubjectTermHistory[]>();
  for (const obs of input.observations) {
    const list = subjectsByStudent.get(obs.sectionStudentId) ?? [];
    list.push({
      subject: obs.subject,
      isExaminable: obs.isExaminable,
      terms: [
        ...obs.priors.map((p) => ({
          label: p.term_label,
          quarterly: p.quarterly_grade,
          ww: p.ww_ps,
          pt: p.pt_ps,
          qa: p.qa_ps,
          marks: {
            ww: { scored: p.ww_scored ?? null, max: p.ww_max ?? null },
            pt: { scored: p.pt_scored ?? null, max: p.pt_max ?? null },
            qa: { scored: p.qa_scored ?? null, max: p.qa_max ?? null },
          },
        })),
        {
          label: input.currentTermLabel,
          quarterly: obs.current.quarterly,
          ww: obs.current.ww,
          pt: obs.current.pt,
          qa: obs.current.qa,
          marks: {
            ww: obs.currentMarks?.ww ?? { scored: null, max: null },
            pt: obs.currentMarks?.pt ?? { scored: null, max: null },
            qa: obs.currentMarks?.qa ?? { scored: null, max: null },
          },
        },
      ],
      fell: (byStudent.get(obs.sectionStudentId) ?? []).some(
        (d) => d.subject === obs.subject
      ),
    });
    subjectsByStudent.set(obs.sectionStudentId, list);
  }

  const out: AtRiskStudent[] = [];
  for (const student of input.students) {
    const drops = (byStudent.get(student.sectionStudentId) ?? []).slice();
    drops.sort((a, b) => a.diff - b.diff);
    out.push({
      ...student,
      drops,
      worstDiff: drops.length > 0 ? drops[0].diff : null,
      subjects: subjectsByStudent.get(student.sectionStudentId) ?? [],
    });
  }

  // Steepest first, then the students who have not fallen, each group in
  // roster order. The panel re-sorts by index number for the list itself; this
  // order is what any other reader of the payload gets.
  out.sort((a, b) => {
    if (a.worstDiff == null && b.worstDiff == null) return 0;
    if (a.worstDiff == null) return 1;
    if (b.worstDiff == null) return -1;
    return a.worstDiff - b.worstDiff;
  });
  return out;
}

/**
 * The form adviser's at-risk ranking — Ms Koh's ask (2026-07-31, 55:10):
 * "flag out students who are scoring at risk... then the subject teacher OR
 * THE FCA got to contact the parents."
 *
 * The subject-teacher half shipped as a lookup on the grading sheet (KD #179),
 * where every number was already on screen. An adviser has no grading sheet,
 * so this compares every subject the class takes, for one term, and ranks the
 * students by how far they have fallen.
 *
 * WHAT IS DELIBERATELY NOT HERE: individual slots. `ww_scores[0]` in Term 1
 * and Term 2 are unrelated assessments — the arrays are resized per sheet and
 * the labels are free text — so a per-slot cross-term diff is noise wearing a
 * signal's clothes. Components are percentages of their own total and compare
 * honestly (`lib/markbook/alert-threshold.ts`).
 */

import { describe, it, expect } from 'vitest';

import { rankAtRisk, type AtRiskInput } from '@/lib/classroom/at-risk';

const STUDENTS = [
  {
    sectionStudentId: 'ss-1',
    studentNumber: 'H1',
    studentName: 'Alvarez, Ana',
    indexNumber: 1,
  },
  {
    sectionStudentId: 'ss-2',
    studentNumber: 'H2',
    studentName: 'Bautista, Ben',
    indexNumber: 2,
  },
];

function input(over: Partial<AtRiskInput> = {}): AtRiskInput {
  return { students: STUDENTS, observations: [], ...over };
}

describe('who gets flagged', () => {
  it('flags nobody when nothing has moved', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 88, ww: 90, pt: 87, qa: 86 },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 88,
                ww_ps: 90,
                pt_ps: 87,
                qa_ps: 86,
              },
            ],
          },
        ],
      })
    );
    expect(out).toEqual([]);
  });

  it('flags a term-grade fall past the threshold', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 78, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 91,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].studentName).toBe('Alvarez, Ana');
    expect(out[0].drops).toEqual([
      {
        subject: 'Mathematics',
        metric: 'quarterly',
        metricLabel: 'Term grade',
        priorTermLabel: 'Term 1',
        prior: 91,
        current: 78,
        diff: -13,
        display: { prior: '91', current: '78', kind: 'points' },
      },
    ]);
    expect(out[0].worstDiff).toBe(-13);
  });

  it('ignores a fall smaller than the threshold', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 87, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toEqual([]);
  });

  it('never flags an improvement', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 95, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 70,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toEqual([]);
  });
});

describe('a term grade can hold still while a component collapses', () => {
  it('flags written work even when the term grade is flat', () => {
    // The case that made the training ask worth widening: written work falls
    // and the exam rises to cover it, so the term grade says nothing is wrong.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Science',
            isExaminable: true,
            current: { quarterly: 85, ww: 70, pt: 85, qa: 96 },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 85,
                ww_ps: 88,
                pt_ps: 85,
                qa_ps: 84,
              },
            ],
          },
        ],
      })
    );
    expect(out[0].drops.map((d) => d.metric)).toEqual(['ww']);
    expect(out[0].drops[0].diff).toBe(-18);
  });
});

describe('ranking and grouping', () => {
  it('puts the biggest fall first', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 84, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
          {
            sectionStudentId: 'ss-2',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 60, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out.map((s) => s.studentName)).toEqual([
      'Bautista, Ben',
      'Alvarez, Ana',
    ]);
  });

  it('gathers one student’s subjects into a single row', () => {
    // An adviser rings the parents once, about the child — not once per
    // subject. So the student is the unit, and the subjects are the detail.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 78, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 91,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
          {
            sectionStudentId: 'ss-1',
            subject: 'Science',
            isExaminable: true,
            current: { quarterly: 74, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 82,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].drops.map((d) => d.subject)).toEqual([
      'Mathematics',
      'Science',
    ]);
    // Steepest first within the student, too — it is what the call is about.
    expect(out[0].drops[0].diff).toBe(-13);
    expect(out[0].worstDiff).toBe(-13);
  });
});

describe('missing data is not a signal', () => {
  it('says nothing about a student with no prior term', () => {
    // A late enrollee has no Term 1. Comparing against nothing and calling it
    // a fall would put every new child on the adviser's list.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 40, ww: null, pt: null, qa: null },
            priors: [],
          },
        ],
      })
    );
    expect(out).toEqual([]);
  });

  it('says nothing when this term is not marked yet', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: null, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 91,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toEqual([]);
  });

  it('compares against the most recent term that HAS a mark', () => {
    // Term 2 was never marked for this subject; Term 1 is the honest baseline
    // rather than a reason to say nothing.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'Mathematics',
            isExaminable: true,
            current: { quarterly: 70, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
              {
                term_number: 2,
                term_label: 'Term 2',
                quarterly_grade: null,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out[0].drops[0].priorTermLabel).toBe('Term 1');
    expect(out[0].drops[0].diff).toBe(-20);
  });

  it('omits a student who is on the roster but has no marks at all', () => {
    expect(rankAtRisk(input())).toEqual([]);
  });
});

describe('a letter-graded subject reads as a band, not as points', () => {
  // MAPEH and friends store a band-representative integer standing in for a
  // letter (KD #104). "87 → 82 · −5" is not false, but it is not what
  // happened either, and an adviser ringing a parent about a five-point fall
  // in a subject that is graded A/B/C/IP has been misled by the screen.
  it('shows the bands for the term grade', () => {
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'MAPEH',
            isExaminable: false,
            current: { quarterly: 82, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out[0].drops[0].display).toEqual({
      prior: 'A',
      current: 'C',
      kind: 'band',
    });
    // The underlying numbers are still carried — the ranking needs them, and
    // hiding them would make the row unauditable.
    expect(out[0].drops[0].prior).toBe(90);
    expect(out[0].drops[0].diff).toBe(-8);
  });

  it('leaves the components underneath as percentages', () => {
    // Only the TERM GRADE is a band. Written work inside a letter subject is
    // an ordinary percentage, and converting it would invent a meaning.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'MAPEH',
            isExaminable: false,
            current: { quarterly: null, ww: 70, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: null,
                ww_ps: 88,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out[0].drops[0].display).toEqual({
      prior: '88',
      current: '70',
      kind: 'points',
    });
  });

  it('still flags the student, so the two surfaces agree on WHO', () => {
    // The grading sheet's own lookup flags letter subjects numerically. If
    // this list quietly dropped them, a teacher and their adviser would
    // disagree about who is at risk, which is worse than an odd-reading row.
    const out = rankAtRisk(
      input({
        observations: [
          {
            sectionStudentId: 'ss-1',
            subject: 'MAPEH',
            isExaminable: false,
            current: { quarterly: 82, ww: null, pt: null, qa: null },
            priors: [
              {
                term_number: 1,
                term_label: 'Term 1',
                quarterly_grade: 90,
                ww_ps: null,
                pt_ps: null,
                qa_ps: null,
              },
            ],
          },
        ],
      })
    );
    expect(out).toHaveLength(1);
  });
});

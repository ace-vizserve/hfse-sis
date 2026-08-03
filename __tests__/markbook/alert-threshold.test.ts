/**
 * The grading sheet's at-risk signals, extended after the 2026-07-31 training.
 *
 * Koh described a student scoring 90 in Term 1 and dropping in Term 2; asked
 * to be precise, Hermilita added "not only for the quizzes, but also for exam,
 * for overall". The alert only ever compared the TERM GRADE, which is the one
 * of those three that can hide the other two.
 */

import { describe, it, expect } from 'vitest';
import {
  ALERT_METRICS,
  GRADE_ALERT_THRESHOLD,
  outlierSlotIndices,
  outlierSlots,
  priorValueFor,
} from '@/lib/markbook/alert-threshold';

const prior = {
  term_number: 1,
  term_label: 'Term 1',
  quarterly_grade: 90,
  ww_ps: 92,
  pt_ps: 88,
  qa_ps: 85,
};

describe('alert metrics', () => {
  it('covers the term grade plus the three components', () => {
    // "the quizzes... and also for exam, for overall" — written work, the
    // quarterly assessment, and the term grade, plus performance tasks which
    // are the third component of the same formula.
    expect(ALERT_METRICS.map((m) => m.key)).toEqual([
      'quarterly',
      'ww',
      'pt',
      'qa',
    ]);
  });

  it('reads each metric off a prior term', () => {
    expect(priorValueFor(prior, 'quarterly')).toBe(90);
    expect(priorValueFor(prior, 'ww')).toBe(92);
    expect(priorValueFor(prior, 'pt')).toBe(88);
    expect(priorValueFor(prior, 'qa')).toBe(85);
  });

  it('the threshold is one constant, not four literals', () => {
    // It was previously repeated in the comparison, the chip label and three
    // lines of dialog copy, which could disagree after any single edit.
    expect(GRADE_ALERT_THRESHOLD).toBe(5);
  });

  it('a component with no prior value yields nothing to compare', () => {
    expect(priorValueFor({ ...prior, qa_ps: null }, 'qa')).toBeNull();
  });
});

describe('outlierSlotIndices — the mid-term signal', () => {
  // Cross-term comparison cannot answer "she bombed last week's quiz": it
  // happens long before a term grade exists. This compares a slot against the
  // student's own other slots on the same sheet, so it needs no slot identity
  // across terms — which the schema does not have.

  it('flags a slot far below the student’s own average', () => {
    // 90%, 95%, 40% — the third is the story.
    const flagged = outlierSlotIndices([9, 19, 4], [10, 20, 10]);
    expect(flagged).toEqual([2]);
  });

  it('leaves a consistently performing student alone', () => {
    expect(outlierSlotIndices([9, 18, 9], [10, 20, 10])).toEqual([]);
  });

  it('says nothing with fewer than three scored slots', () => {
    // With two points "below average" just means "the lower one", which would
    // flag half of every sheet on day one.
    expect(outlierSlotIndices([9, 3], [10, 10])).toEqual([]);
  });

  it('ignores unscored slots rather than treating them as zero', () => {
    // Hard Rule #3 — a blank is "not taken", not a mark of nothing.
    expect(outlierSlotIndices([9, null, 10, 9], [10, 10, 10, 10])).toEqual([]);
  });

  it('normalises by each slot’s own maximum', () => {
    // 8/10 and 80/100 are the same performance; a raw comparison would call
    // the first one a catastrophe.
    expect(outlierSlotIndices([8, 80, 8], [10, 100, 10])).toEqual([]);
  });

  it('handles a zero score as a real mark', () => {
    expect(outlierSlotIndices([10, 10, 0], [10, 10, 10])).toEqual([2]);
  });
});

describe('outlierSlots — what the Alerts dialog reads', () => {
  // The indices alone tint the right cells. Naming the assessment and saying
  // how far below it sits is what makes the Alerts column usable in Term 1,
  // where there is no prior term and this is the only signal that exists.

  it('reports the slot, its percentage, and the average it fell short of', () => {
    const [flagged] = outlierSlots([9, 19, 4], [10, 20, 10]);
    expect(flagged.index).toBe(2);
    expect(flagged.pct).toBe(40);
    // 90% and 95% — the student's own other work, not the class average.
    expect(flagged.othersMeanPct).toBeCloseTo(92.5);
  });

  it('agrees with outlierSlotIndices on every case', () => {
    // The two must never disagree: one tints the cells, the other fills the
    // dialog, and a mismatch would highlight one assessment while explaining
    // a different one.
    const cases: Array<[(number | null)[], number[]]> = [
      [
        [9, 19, 4],
        [10, 20, 10],
      ],
      [
        [9, 18, 9],
        [10, 20, 10],
      ],
      [
        [9, 3],
        [10, 10],
      ],
      [
        [9, null, 10, 9],
        [10, 10, 10, 10],
      ],
      [
        [10, 10, 0],
        [10, 10, 10],
      ],
    ];
    for (const [scores, totals] of cases) {
      expect(outlierSlots(scores, totals).map((o) => o.index)).toEqual(
        outlierSlotIndices(scores, totals)
      );
    }
  });
});

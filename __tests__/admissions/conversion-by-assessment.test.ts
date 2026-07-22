/**
 * Tests for `computeConversionByAssessment` — does entrance assessment
 * performance predict enrollment? Unlike `getAssessmentOutcomes` (which
 * excludes Cancelled/Withdrawn from its pass/fail volume counts), this
 * function counts ALL applicants for a true conversion rate, matching
 * `computeReferralConversion`'s established convention on this exact
 * question shape.
 */

import { describe, expect, it } from 'vitest';

import { computeConversionByAssessment } from '@/lib/admissions/dashboard';

describe('computeConversionByAssessment', () => {
  it('buckets by subject × outcome and computes conversion per bucket', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        assessmentGradeMath: '75',
        assessmentGradeEnglish: '80',
      },
      {
        applicationStatus: 'Submitted',
        assessmentGradeMath: '72',
        assessmentGradeEnglish: '45',
      },
      {
        applicationStatus: 'Cancelled',
        assessmentGradeMath: '30',
        assessmentGradeEnglish: '85',
      },
    ];
    const result = computeConversionByAssessment(rows);

    const mathPass = result.find(
      (r) => r.subject === 'Math' && r.outcome === 'Pass'
    );
    expect(mathPass).toEqual({
      subject: 'Math',
      outcome: 'Pass',
      applied: 2,
      enrolled: 1,
      conversionPct: 50,
    });

    const mathFail = result.find(
      (r) => r.subject === 'Math' && r.outcome === 'Fail'
    );
    expect(mathFail).toEqual({
      subject: 'Math',
      outcome: 'Fail',
      applied: 1,
      enrolled: 0,
      conversionPct: 0,
    });

    const engFail = result.find(
      (r) => r.subject === 'English' && r.outcome === 'Fail'
    );
    expect(engFail?.applied).toBe(1); // the 45 (Submitted) row
  });

  it('includes Cancelled/Withdrawn in the denominator (unlike getAssessmentOutcomes)', () => {
    const rows = [
      {
        applicationStatus: 'Cancelled',
        assessmentGradeMath: '90',
        assessmentGradeEnglish: null,
      },
    ];
    const result = computeConversionByAssessment(rows);
    const mathPass = result.find(
      (r) => r.subject === 'Math' && r.outcome === 'Pass'
    );
    expect(mathPass?.applied).toBe(1);
    expect(mathPass?.enrolled).toBe(0);
  });

  it('"Enrolled (Conditional)" counts as enrolled', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled (Conditional)',
        assessmentGradeMath: '65',
        assessmentGradeEnglish: '65',
      },
    ];
    const result = computeConversionByAssessment(rows);
    const mathPass = result.find(
      (r) => r.subject === 'Math' && r.outcome === 'Pass'
    );
    expect(mathPass?.enrolled).toBe(1);
    expect(mathPass?.conversionPct).toBe(100);
  });

  it('un-assessed rows bucket as "Not assessed", not silently dropped', () => {
    const rows = [
      {
        applicationStatus: 'Submitted',
        assessmentGradeMath: null,
        assessmentGradeEnglish: '',
      },
    ];
    const result = computeConversionByAssessment(rows);
    const mathUnassessed = result.find(
      (r) => r.subject === 'Math' && r.outcome === 'Not assessed'
    );
    const engUnassessed = result.find(
      (r) => r.subject === 'English' && r.outcome === 'Not assessed'
    );
    expect(mathUnassessed?.applied).toBe(1);
    expect(engUnassessed?.applied).toBe(1);
  });

  it('letter grades classify via the A/B/C pass, D/F fail convention', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        assessmentGradeMath: 'B+',
        assessmentGradeEnglish: 'F',
      },
    ];
    const result = computeConversionByAssessment(rows);
    expect(
      result.find((r) => r.subject === 'Math' && r.outcome === 'Pass')?.applied
    ).toBe(1);
    expect(
      result.find((r) => r.subject === 'English' && r.outcome === 'Fail')
        ?.applied
    ).toBe(1);
  });

  it('empty input returns an empty array', () => {
    expect(computeConversionByAssessment([])).toEqual([]);
  });
});

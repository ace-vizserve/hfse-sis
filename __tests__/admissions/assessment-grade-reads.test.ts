import { describe, expect, it } from 'vitest';

import {
  ASSESSMENT_PASS_MARK,
  classifyAssessmentGrade,
  formatAssessmentGrade,
} from '@/lib/admissions/assessment-grade';
import { computeConversionByAssessment } from '@/lib/admissions/dashboard';
import { combinedAssessmentOutcome } from '@/lib/admissions/drill';

// Every read of assessmentGradeMath / assessmentGradeEnglish goes through
// parseAssessmentGrade. Until 2026-09-28 the classifiers did Number(raw), so
// every Directus `<p>`-wrapped value fell to "unknown".

describe('formatAssessmentGrade — what the screen and the CSV show', () => {
  it('score and max known → "percent% (score/max)"', () => {
    expect(formatAssessmentGrade('<p>93.55% (29/31)</p>')).toBe(
      '93.55% (29/31)'
    );
    expect(formatAssessmentGrade('<p>23/31 - 74.19%</p>')).toBe(
      '74.19% (23/31)'
    );
    // What the SIS form now stores.
    expect(formatAssessmentGrade('29/31')).toBe('93.55% (29/31)');
  });

  it('percent only → "77%"', () => {
    expect(formatAssessmentGrade('77%')).toBe('77%');
    expect(formatAssessmentGrade('<p>90</p>')).toBe('90%');
    expect(formatAssessmentGrade(85)).toBe('85%');
  });

  it('unparseable → the words, HTML stripped', () => {
    expect(formatAssessmentGrade('<p>did not <b>complete</b></p>')).toBe(
      'did not complete'
    );
    expect(formatAssessmentGrade('na')).toBe('na');
  });

  it('never shows a tag, and blank is null', () => {
    for (const raw of [
      '<p>93.55% (29/31)</p>',
      '<p>77%</p>',
      '<p>absent</p>',
      '<p>B+</p>',
    ]) {
      expect(formatAssessmentGrade(raw)).not.toMatch(/[<>]/);
    }
    expect(formatAssessmentGrade(null)).toBeNull();
    expect(formatAssessmentGrade(undefined)).toBeNull();
    expect(formatAssessmentGrade('<p></p>')).toBeNull();
    expect(formatAssessmentGrade('   ')).toBeNull();
  });
});

describe('classifyAssessmentGrade — 60% pass mark', () => {
  it('uses 60 as the pass mark', () => {
    expect(ASSESSMENT_PASS_MARK).toBe(60);
    expect(classifyAssessmentGrade('60')).toBe('pass');
    expect(classifyAssessmentGrade('59.99%')).toBe('fail');
  });

  it('an HTML-wrapped value now classifies (it used to be "unknown")', () => {
    expect(classifyAssessmentGrade('<p>93.55% (29/31)</p>')).toBe('pass');
    expect(classifyAssessmentGrade('<p>6.98%</p>')).toBe('fail');
    expect(classifyAssessmentGrade('<p>23/31 - 74.19%</p>')).toBe('pass');
    expect(classifyAssessmentGrade('<p>10/31</p>')).toBe('fail');
  });

  it('numbers and the new score/max shape', () => {
    expect(classifyAssessmentGrade(72)).toBe('pass');
    expect(classifyAssessmentGrade(40)).toBe('fail');
    expect(classifyAssessmentGrade('29/31')).toBe('pass');
    expect(classifyAssessmentGrade('18/31')).toBe('fail');
  });

  it('a bare letter keeps the A/B/C pass, D/F fail rule', () => {
    expect(classifyAssessmentGrade('A')).toBe('pass');
    expect(classifyAssessmentGrade('<p>B+</p>')).toBe('pass');
    expect(classifyAssessmentGrade('c-')).toBe('pass');
    expect(classifyAssessmentGrade('D')).toBe('fail');
    expect(classifyAssessmentGrade('F')).toBe('fail');
  });

  it('words are unknown — a first letter is not a grade', () => {
    // The old rule read "absent" as an A (pass) and "did not complete" as a D.
    expect(classifyAssessmentGrade('absent')).toBe('unknown');
    expect(classifyAssessmentGrade('did not complete')).toBe('unknown');
    expect(classifyAssessmentGrade('na')).toBe('unknown');
    expect(classifyAssessmentGrade('E')).toBe('unknown');
    expect(classifyAssessmentGrade('')).toBe('unknown');
    expect(classifyAssessmentGrade(null)).toBe('unknown');
  });
});

describe('the dashboard and its drill read the same way', () => {
  it('computeConversionByAssessment buckets HTML-wrapped grades as Pass/Fail', () => {
    const rows = computeConversionByAssessment([
      {
        applicationStatus: 'Enrolled',
        assessmentGradeMath: '<p>93.55% (29/31)</p>',
        assessmentGradeEnglish: '<p>6.98%</p>',
      },
    ]);
    const bucket = (subject: string) =>
      rows.find((r) => r.subject === subject)?.outcome;
    expect(bucket('Math')).toBe('Pass');
    expect(bucket('English')).toBe('Fail');
  });

  it('combinedAssessmentOutcome reads the HTML too', () => {
    expect(
      combinedAssessmentOutcome('<p>93.55% (29/31)</p>', '<p>80%</p>')
    ).toBe('pass');
    expect(
      combinedAssessmentOutcome('<p>93.55% (29/31)</p>', '<p>5%</p>')
    ).toBe('fail');
    expect(combinedAssessmentOutcome('<p>na</p>', null)).toBe('unknown');
  });
});

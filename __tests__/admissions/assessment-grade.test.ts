import { describe, expect, it } from 'vitest';

import {
  cleanAssessmentText,
  parseAssessmentGrade,
} from '@/lib/admissions/assessment-grade';

const NONE = { percent: null, score: null, max: null };

describe('cleanAssessmentText', () => {
  it('strips tags, decodes entities and collapses whitespace', () => {
    expect(cleanAssessmentText('<p>93.55%&nbsp;(29/31)</p>')).toBe(
      '93.55% (29/31)'
    );
    expect(cleanAssessmentText('<p><strong>90</strong></p>\n<p></p>')).toBe(
      '90'
    );
    expect(cleanAssessmentText('29&#47;31 &amp; 93&#x25;')).toBe('29/31 & 93%');
  });
});

describe('parseAssessmentGrade — real Directus shapes', () => {
  it('percent then fraction in brackets', () => {
    expect(parseAssessmentGrade('<p>93.55% (29/31)</p>')).toEqual({
      percent: 93.55,
      score: 29,
      max: 31,
    });
  });

  it('fraction then percent, dash-separated', () => {
    expect(parseAssessmentGrade('<p>23/31 - 74.19%</p>')).toEqual({
      percent: 74.19,
      score: 23,
      max: 31,
    });
  });

  it('percent then fraction, no brackets', () => {
    expect(parseAssessmentGrade('<p>90.32% 28/31</p>')).toEqual({
      percent: 90.32,
      score: 28,
      max: 31,
    });
  });

  it('percent only', () => {
    expect(parseAssessmentGrade('<p>6.98%</p>')).toEqual({
      percent: 6.98,
      score: null,
      max: null,
    });
  });

  it('bare number string is a percent', () => {
    expect(parseAssessmentGrade('90')).toEqual({
      percent: 90,
      score: null,
      max: null,
    });
    expect(parseAssessmentGrade(' <p>72.5</p> ')).toEqual({
      percent: 72.5,
      score: null,
      max: null,
    });
  });

  it('fraction only computes the percent (2 decimals)', () => {
    expect(parseAssessmentGrade('<p>29/31</p>')).toEqual({
      percent: 93.55,
      score: 29,
      max: 31,
    });
    expect(parseAssessmentGrade('23 / 31')).toEqual({
      percent: 74.19,
      score: 23,
      max: 31,
    });
    expect(parseAssessmentGrade('0/31')).toEqual({
      percent: 0,
      score: 0,
      max: 31,
    });
    expect(parseAssessmentGrade('31/31')).toEqual({
      percent: 100,
      score: 31,
      max: 31,
    });
  });

  it('handles entities and nbsp between the parts', () => {
    expect(parseAssessmentGrade('<p>93.55&nbsp;%&nbsp;(29/31)</p>')).toEqual({
      percent: 93.55,
      score: 29,
      max: 31,
    });
  });

  it('keeps the typed percent even when it disagrees with the fraction', () => {
    expect(parseAssessmentGrade('80% (29/31)')).toEqual({
      percent: 80,
      score: 29,
      max: 31,
    });
  });

  it('a repeated identical percent is not ambiguous', () => {
    expect(parseAssessmentGrade('<p>90%</p><p>90%</p>')).toEqual({
      percent: 90,
      score: null,
      max: null,
    });
  });

  it('rounds to 2 decimals', () => {
    expect(parseAssessmentGrade('93.555%').percent).toBe(93.56);
    expect(parseAssessmentGrade('1/3').percent).toBe(33.33);
    expect(parseAssessmentGrade(66.666).percent).toBe(66.67);
  });

  it('accepts the 0 and 100 bounds', () => {
    expect(parseAssessmentGrade('0').percent).toBe(0);
    expect(parseAssessmentGrade('100%').percent).toBe(100);
    expect(parseAssessmentGrade(100).percent).toBe(100);
  });
});

describe('parseAssessmentGrade — numbers', () => {
  it('reads a finite number in range as a percent', () => {
    expect(parseAssessmentGrade(85)).toEqual({
      percent: 85,
      score: null,
      max: null,
    });
  });

  it('rejects out-of-range and non-finite numbers', () => {
    expect(parseAssessmentGrade(-1)).toEqual(NONE);
    expect(parseAssessmentGrade(100.01)).toEqual(NONE);
    expect(parseAssessmentGrade(Number.NaN)).toEqual(NONE);
    expect(parseAssessmentGrade(Number.POSITIVE_INFINITY)).toEqual(NONE);
  });
});

describe('parseAssessmentGrade — blank and garbage', () => {
  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['<p></p>'],
    ['<p>&nbsp;</p>'],
    [{}],
    [[]],
    [true],
  ])('returns all null for blank / non-string %j', (raw) => {
    expect(parseAssessmentGrade(raw)).toEqual(NONE);
  });

  it.each([
    ['B+'],
    ['F'],
    ['Passed'],
    ['<p>absent</p>'],
    ['N/A'],
    ['n/a'],
    ['TBA'],
    ['90 pts'],
    ['ninety'],
    ['93,55'], // comma decimal is not guessed at
  ])('returns all null for unparseable text %j', (raw) => {
    expect(parseAssessmentGrade(raw)).toEqual(NONE);
  });

  it('rejects an explicit percent outside 0–100', () => {
    expect(parseAssessmentGrade('150%')).toEqual(NONE);
    expect(parseAssessmentGrade('-5%')).toEqual(NONE);
    expect(parseAssessmentGrade('150% (29/31)')).toEqual(NONE);
  });

  it('rejects a bare number outside 0–100', () => {
    expect(parseAssessmentGrade('101')).toEqual(NONE);
    expect(parseAssessmentGrade('-3')).toEqual(NONE);
  });

  it('rejects an impossible fraction when there is no percent', () => {
    expect(parseAssessmentGrade('32/31')).toEqual(NONE);
    expect(parseAssessmentGrade('5/0')).toEqual(NONE);
    expect(parseAssessmentGrade('-5/31')).toEqual(NONE);
    expect(parseAssessmentGrade('12/05/2026')).toEqual(NONE);
  });

  it('keeps the percent but drops an impossible fraction beside it', () => {
    expect(parseAssessmentGrade('90% (32/31)')).toEqual({
      percent: 90,
      score: null,
      max: null,
    });
  });

  it('returns all null when two different percents or fractions appear', () => {
    expect(parseAssessmentGrade('90% then 85%')).toEqual(NONE);
    expect(parseAssessmentGrade('29/31 and 20/31')).toEqual(NONE);
  });

  it('does not treat a number with trailing prose as bare', () => {
    expect(parseAssessmentGrade('90 (retake)')).toEqual(NONE);
  });

  it('reads the percent after a dash glued to the fraction', () => {
    expect(parseAssessmentGrade('23/31-74.19%')).toEqual({
      percent: 74.19,
      score: 23,
      max: 31,
    });
  });
});

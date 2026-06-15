import { describe, it, expect } from 'vitest';
import {
  isEnrolledForTerm,
  dateInCoverage,
  termEnrolment,
  type EnrolmentInterval,
} from '@/lib/report-card/enrolment-coverage';

const T1 = { start_date: '2026-01-05', end_date: '2026-03-13' };
const T3 = { start_date: '2026-06-29', end_date: '2026-09-04' };
const T3_DATES = ['2026-06-29', '2026-06-30', '2026-07-01']; // sample teaching days

describe('isEnrolledForTerm', () => {
  it('normal student (null/null) is enrolled for every term', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });

  it('late enrollee (joins T3) is NOT enrolled for T1, IS for T3', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-06-29', end: null }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(false);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });

  it('withdrawal (ends in T1) is enrolled for T1, NOT for T3', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: '2026-03-13' }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(false);
  });

  it('transfer (two abutting intervals) stays continuously enrolled', () => {
    const cov: EnrolmentInterval[] = [
      { start: '2026-01-05', end: '2026-04-15' },
      { start: '2026-04-15', end: null },
    ];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });
});

describe('dateInCoverage', () => {
  const cov: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
  it('excludes dates before the start, includes on/after', () => {
    expect(dateInCoverage('2026-06-30', cov)).toBe(false);
    expect(dateInCoverage('2026-07-01', cov)).toBe(true);
    expect(dateInCoverage('2026-07-02', cov)).toBe(true);
  });
});

describe('termEnrolment', () => {
  it('not-enrolled term → enrolled false, 0 school days', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-06-29', end: null }];
    expect(termEnrolment(cov, T1, ['2026-01-06', '2026-01-07'])).toEqual({
      enrolled: false,
      enrolledSchoolDays: 0,
    });
  });

  it('full term → enrolled true, all calendar days counted', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(termEnrolment(cov, T3, T3_DATES)).toEqual({
      enrolled: true,
      enrolledSchoolDays: 3,
    });
  });

  it('join term → enrolled true, denominator clamped to days from join date', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
    expect(termEnrolment(cov, T3, T3_DATES)).toEqual({
      enrolled: true,
      enrolledSchoolDays: 1, // only 2026-07-01
    });
  });

  it('enrolled but empty calendar → enrolled true, 0 (caller falls back)', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(termEnrolment(cov, T3, [])).toEqual({
      enrolled: true,
      enrolledSchoolDays: 0,
    });
  });
});

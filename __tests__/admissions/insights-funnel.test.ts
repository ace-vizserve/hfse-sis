import { describe, it, expect } from 'vitest';
import {
  computeConversionByLevel,
  computeReferralConversion,
  computeEnroleeTypeConversion,
} from '@/lib/admissions/insights-funnel';

// NOTE: the deep stage-date funnel (buildDeepFunnel / DEEP_FUNNEL_STAGE_KEYS /
// getDeepFunnelStats) was removed — those columns are 0/490 populated in prod,
// so the funnel was hollow. The Admissions Insights funnel is now built from the
// real `applicationStatus` pipeline via getConversionFunnel (covered elsewhere).
// The conversion-breakdown helpers below are unchanged and still drive the page.

// ──────────────────────────────────────────────────────────────────────────
// computeConversionByLevel
// ──────────────────────────────────────────────────────────────────────────
describe('computeConversionByLevel', () => {
  it('excludes cancelled/withdrawn from applied count', () => {
    const rows = [
      { levelApplied: 'P1', applicationStatus: 'Enrolled' },
      { levelApplied: 'P1', applicationStatus: 'Processing' },
      { levelApplied: 'P1', applicationStatus: 'Cancelled' },
      { levelApplied: 'P1', applicationStatus: 'Withdrawn' },
    ];
    const result = computeConversionByLevel(rows);
    const p1 = result.find((r) => r.level === 'P1');
    expect(p1?.applied).toBe(2); // Enrolled + Processing, not Cancelled/Withdrawn
    expect(p1?.enrolled).toBe(1);
  });

  it('counts Enrolled (Conditional) as enrolled', () => {
    const rows = [
      { levelApplied: 'S1', applicationStatus: 'Enrolled (Conditional)' },
      { levelApplied: 'S1', applicationStatus: 'Processing' },
    ];
    const result = computeConversionByLevel(rows);
    const s1 = result.find((r) => r.level === 'S1');
    expect(s1?.enrolled).toBe(1);
  });

  it('defaults null levelApplied to Unknown, sorted last', () => {
    const rows = [
      { levelApplied: 'P1', applicationStatus: 'Enrolled' },
      { levelApplied: null, applicationStatus: 'Processing' },
      { levelApplied: '   ', applicationStatus: 'Processing' },
    ];
    const result = computeConversionByLevel(rows);
    expect(result[result.length - 1].level).toBe('Unknown');
  });

  it('sorts canonical levels P1..S4 before unknown, Unknown last', () => {
    const rows = [
      { levelApplied: 'S1', applicationStatus: 'Enrolled' },
      { levelApplied: 'P3', applicationStatus: 'Enrolled' },
      { levelApplied: null, applicationStatus: 'Enrolled' },
      { levelApplied: 'P1', applicationStatus: 'Enrolled' },
    ];
    const result = computeConversionByLevel(rows);
    expect(result.map((r) => r.level)).toEqual(['P1', 'P3', 'S1', 'Unknown']);
  });

  it('computes conversionPct correctly', () => {
    const rows = [
      { levelApplied: 'P2', applicationStatus: 'Enrolled' },
      { levelApplied: 'P2', applicationStatus: 'Enrolled' },
      { levelApplied: 'P2', applicationStatus: 'Processing' },
      { levelApplied: 'P2', applicationStatus: 'Processing' },
    ];
    const result = computeConversionByLevel(rows);
    const p2 = result.find((r) => r.level === 'P2');
    expect(p2?.applied).toBe(4);
    expect(p2?.enrolled).toBe(2);
    expect(p2?.conversionPct).toBe(50);
  });

  it('returns empty array for empty input', () => {
    expect(computeConversionByLevel([])).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeReferralConversion
// ──────────────────────────────────────────────────────────────────────────
describe('computeReferralConversion', () => {
  it('counts all applicants (including terminal) in applied', () => {
    const rows = [
      { howDidYouKnowAboutHFSEIS: 'Facebook', applicationStatus: 'Enrolled' },
      { howDidYouKnowAboutHFSEIS: 'Facebook', applicationStatus: 'Cancelled' },
      {
        howDidYouKnowAboutHFSEIS: 'Facebook',
        applicationStatus: 'Processing',
      },
    ];
    const result = computeReferralConversion(rows);
    const fb = result.find((r) => r.source === 'Facebook');
    expect(fb?.applied).toBe(3); // all included
    expect(fb?.enrolled).toBe(1);
    expect(fb?.conversionPct).toBe(33); // round(1/3 * 100) = 33
  });

  it('defaults null source to "Not specified"', () => {
    const rows = [
      { howDidYouKnowAboutHFSEIS: null, applicationStatus: 'Processing' },
      { howDidYouKnowAboutHFSEIS: '', applicationStatus: 'Processing' },
    ];
    const result = computeReferralConversion(rows);
    const ns = result.find((r) => r.source === 'Not specified');
    expect(ns?.applied).toBe(2);
  });

  it('folds sources beyond top 8 into "Other"', () => {
    const sources = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const rows = sources.flatMap((s, i) =>
      Array.from({ length: i + 1 }, () => ({
        howDidYouKnowAboutHFSEIS: s,
        applicationStatus: 'Processing',
      }))
    );
    // J=10, I=9, H=8 ... A=1. Top 8 = J,I,H,G,F,E,D,C → Other = B+A = 2+1 = 3
    const result = computeReferralConversion(rows);
    expect(result).toHaveLength(9); // 8 + Other
    const other = result.find((r) => r.source === 'Other');
    expect(other?.applied).toBe(3); // B(2)+A(1)
  });

  it('sorts by applied desc', () => {
    const rows = [
      { howDidYouKnowAboutHFSEIS: 'X', applicationStatus: 'Processing' },
      { howDidYouKnowAboutHFSEIS: 'Y', applicationStatus: 'Processing' },
      { howDidYouKnowAboutHFSEIS: 'Y', applicationStatus: 'Processing' },
    ];
    const result = computeReferralConversion(rows);
    expect(result[0].source).toBe('Y');
  });

  it('returns empty array for empty input', () => {
    expect(computeReferralConversion([])).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeEnroleeTypeConversion
// ──────────────────────────────────────────────────────────────────────────
describe('computeEnroleeTypeConversion', () => {
  it('excludes terminal statuses from applied', () => {
    const rows = [
      { enroleeType: 'New', applicationStatus: 'Enrolled' },
      { enroleeType: 'New', applicationStatus: 'Cancelled' },
      { enroleeType: 'Current', applicationStatus: 'Processing' },
    ];
    const result = computeEnroleeTypeConversion(rows);
    const newRow = result.find((r) => r.type === 'New');
    expect(newRow?.applied).toBe(1); // Cancelled excluded
    expect(newRow?.enrolled).toBe(1);
    const curRow = result.find((r) => r.type === 'Current');
    expect(curRow?.applied).toBe(1);
    expect(curRow?.enrolled).toBe(0);
  });

  it('sorts by canonical order: New, Current, VizSchool New, VizSchool Current', () => {
    const rows = [
      { enroleeType: 'VizSchool Current', applicationStatus: 'Processing' },
      { enroleeType: 'Current', applicationStatus: 'Processing' },
      { enroleeType: 'New', applicationStatus: 'Processing' },
      { enroleeType: 'VizSchool New', applicationStatus: 'Processing' },
    ];
    const result = computeEnroleeTypeConversion(rows);
    expect(result.map((r) => r.type)).toEqual([
      'New',
      'Current',
      'VizSchool New',
      'VizSchool Current',
    ]);
  });

  it('defaults null enroleeType to "Unspecified"', () => {
    const rows = [{ enroleeType: null, applicationStatus: 'Processing' }];
    const result = computeEnroleeTypeConversion(rows);
    expect(result[0].type).toBe('Unspecified');
  });

  it('computes conversionPct correctly', () => {
    const rows = [
      { enroleeType: 'New', applicationStatus: 'Enrolled' },
      { enroleeType: 'New', applicationStatus: 'Enrolled (Conditional)' },
      { enroleeType: 'New', applicationStatus: 'Processing' },
      { enroleeType: 'New', applicationStatus: 'Processing' },
    ];
    const result = computeEnroleeTypeConversion(rows);
    const newRow = result.find((r) => r.type === 'New');
    expect(newRow?.applied).toBe(4);
    expect(newRow?.enrolled).toBe(2);
    expect(newRow?.conversionPct).toBe(50);
  });

  it('returns empty array for empty input', () => {
    expect(computeEnroleeTypeConversion([])).toEqual([]);
  });
});

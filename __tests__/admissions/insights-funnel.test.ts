import { describe, it, expect } from 'vitest';
import {
  buildDeepFunnel,
  computeConversionByLevel,
  computeReferralConversion,
  computeEnroleeTypeConversion,
  DEEP_FUNNEL_STAGE_KEYS,
} from '@/lib/admissions/insights-funnel';

// ──────────────────────────────────────────────────────────────────────────
// buildDeepFunnel
// ──────────────────────────────────────────────────────────────────────────
describe('buildDeepFunnel', () => {
  const stageKeys = DEEP_FUNNEL_STAGE_KEYS as unknown as readonly string[];

  it('returns empty array for zero pool', () => {
    const counts = new Map<string, number>();
    expect(buildDeepFunnel(counts, 0, stageKeys)).toEqual([]);
  });

  it('returns empty array for empty stageKeys', () => {
    const counts = new Map([['registration', 50]]);
    expect(buildDeepFunnel(counts, 100, [])).toEqual([]);
  });

  it('computes drop-off and marks the biggest leak', () => {
    // pool=100, registration=80 (-20%), documents=70 (-12.5%), assessment=50 (-28%)
    // => assessment is biggest leak
    const counts = new Map([
      ['registration', 80],
      ['documents', 70],
      ['assessment', 50],
      ['contract', 45],
      ['fees', 40],
      ['class', 38],
    ]);
    const stages = buildDeepFunnel(counts, 100, stageKeys);

    expect(stages).toHaveLength(6);

    const reg = stages[0];
    expect(reg.key).toBe('registration');
    expect(reg.count).toBe(80);
    expect(reg.dropOffFromPrev).toBe(20); // 100 - 80
    expect(reg.dropOffPct).toBe(20); // 20/100 = 20%
    expect(reg.isBiggestLeak).toBe(false);

    const doc = stages[1];
    expect(doc.key).toBe('documents');
    expect(doc.count).toBe(70);
    expect(doc.dropOffFromPrev).toBe(10); // 80 - 70
    expect(doc.dropOffPct).toBe(13); // round(10/80*100) = 13%

    const assess = stages[2];
    expect(assess.key).toBe('assessment');
    expect(assess.count).toBe(50);
    expect(assess.dropOffFromPrev).toBe(20); // 70 - 50
    expect(assess.dropOffPct).toBe(29); // round(20/70*100) = 29%
    expect(assess.isBiggestLeak).toBe(true);
  });

  it('handles missing stage counts as zero', () => {
    const counts = new Map([['registration', 50]]);
    const stages = buildDeepFunnel(counts, 100, ['registration', 'documents']);
    expect(stages[1].count).toBe(0); // documents missing from map → 0
    expect(stages[1].dropOffFromPrev).toBe(50);
    expect(stages[1].dropOffPct).toBe(100);
    expect(stages[1].isBiggestLeak).toBe(true);
  });

  it('marks no stage as biggest leak when all drop-offs are 0', () => {
    const counts = new Map([
      ['registration', 100],
      ['documents', 100],
    ]);
    const stages = buildDeepFunnel(counts, 100, ['registration', 'documents']);
    expect(stages.every((s) => !s.isBiggestLeak)).toBe(true);
  });

  it('dropOffPct is 0 for the first stage when pool == stage count', () => {
    const counts = new Map([['registration', 100]]);
    const stages = buildDeepFunnel(counts, 100, ['registration']);
    expect(stages[0].dropOffPct).toBe(0);
    expect(stages[0].dropOffFromPrev).toBe(0);
  });
});

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

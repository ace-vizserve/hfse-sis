import { describe, expect, it } from 'vitest';
import {
  weightBucketForSubjectCode,
  defaultWeightPercentsForSubjectCode,
} from '@/lib/sis/subjects/weight-defaults';

describe('weightBucketForSubjectCode (fractions)', () => {
  it('Math/Science-bucket subject codes get 40/40/20', () => {
    expect(weightBucketForSubjectCode('MATH')).toEqual({
      ww: 0.4,
      pt: 0.4,
      qa: 0.2,
    });
    expect(weightBucketForSubjectCode('SCI')).toEqual({
      ww: 0.4,
      pt: 0.4,
      qa: 0.2,
    });
  });

  it('MAPEH-family subject codes get 20/60/20', () => {
    // Migration 081 retired MUSIC/ARTS/PE/HE (4 separate letter-graded
    // subjects) in favor of one combined numeric-graded MAPEH. PESTD
    // ("Physical Education", Regular-track twin of PEH, migration 082)
    // shares the same real 20/60/20 header — confirmed during the
    // PE/PEH import-confusion correction.
    const mapehCodes = ['MAPEH', 'CL', 'CA', 'PEH', 'PMPD', 'PESTD'];
    for (const code of mapehCodes) {
      expect(weightBucketForSubjectCode(code)).toEqual({
        ww: 0.2,
        pt: 0.6,
        qa: 0.2,
      });
    }
  });

  it('Languages / everything else (e.g. English) falls into the default 30/50/20 bucket', () => {
    const languageCodes = [
      'ENG',
      'FIL',
      'MANDARIN',
      'SS',
      'HIST',
      'LIT',
      'HUM',
      'ECON',
      'CCA',
    ];
    for (const code of languageCodes) {
      expect(weightBucketForSubjectCode(code)).toEqual({
        ww: 0.3,
        pt: 0.5,
        qa: 0.2,
      });
    }
  });

  it('unknown/unrecognized codes fall back to the default bucket, never throw', () => {
    expect(weightBucketForSubjectCode('NONSENSE')).toEqual({
      ww: 0.3,
      pt: 0.5,
      qa: 0.2,
    });
  });

  it('every bucket sums to 1', () => {
    for (const code of ['MATH', 'MAPEH', 'ENG']) {
      const bucket = weightBucketForSubjectCode(code);
      expect(bucket.ww + bucket.pt + bucket.qa).toBeCloseTo(1);
    }
  });
});

describe('defaultWeightPercentsForSubjectCode (UI integer percents)', () => {
  it('converts each bucket to clean integers summing to 100', () => {
    expect(defaultWeightPercentsForSubjectCode('MATH')).toEqual({
      ww: 40,
      pt: 40,
      qa: 20,
    });
    expect(defaultWeightPercentsForSubjectCode('MAPEH')).toEqual({
      ww: 20,
      pt: 60,
      qa: 20,
    });
    expect(defaultWeightPercentsForSubjectCode('ENG')).toEqual({
      ww: 30,
      pt: 50,
      qa: 20,
    });
    expect(defaultWeightPercentsForSubjectCode('NONSENSE')).toEqual({
      ww: 30,
      pt: 50,
      qa: 20,
    });
  });

  it('every default sums to exactly 100 — the Save-enabled-on-open invariant', () => {
    for (const code of ['MATH', 'SCI', 'MAPEH', 'CL', 'ENG', 'ZZZ']) {
      const p = defaultWeightPercentsForSubjectCode(code);
      expect(p.ww + p.pt + p.qa).toBe(100);
    }
  });
});

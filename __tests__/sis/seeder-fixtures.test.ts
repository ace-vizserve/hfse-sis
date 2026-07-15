import { describe, expect, it } from 'vitest';
import { weightBucketForSubjectCode } from '@/lib/sis/seeder/fixtures';

describe('weightBucketForSubjectCode', () => {
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
    // subjects) in favor of one combined numeric-graded MAPEH.
    const mapehCodes = ['MAPEH', 'CL', 'CA', 'PEH', 'PMPD'];
    for (const code of mapehCodes) {
      expect(weightBucketForSubjectCode(code)).toEqual({
        ww: 0.2,
        pt: 0.6,
        qa: 0.2,
      });
    }
  });

  it('everything else (e.g. English) falls into the default 30/50/20 bucket', () => {
    expect(weightBucketForSubjectCode('ENG')).toEqual({
      ww: 0.3,
      pt: 0.5,
      qa: 0.2,
    });
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

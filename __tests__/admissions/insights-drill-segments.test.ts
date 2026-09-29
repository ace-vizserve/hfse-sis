import { describe, expect, it } from 'vitest';

import {
  assessmentSegment,
  levelReasonsSegment,
  nationalitySegment,
  ratingSegmentFromCategory,
  reasonSegmentForSlice,
  referralSegmentForSlice,
  resolveSeriesAy,
} from '@/lib/admissions/insights-drill-segments';
import {
  decodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

const AYS = { selectedAy: 'AY2026', compareAy: 'AY2025' };

describe('resolveSeriesAy', () => {
  it('sends a comparison click to the comparison year', () => {
    expect(resolveSeriesAy('comparison', AYS)).toBe('AY2025');
    expect(resolveSeriesAy('compare', AYS)).toBe('AY2025');
    expect(resolveSeriesAy('AY2025', AYS)).toBe('AY2025');
  });
  it('sends everything else to the selected year', () => {
    expect(resolveSeriesAy('current', AYS)).toBe('AY2026');
    expect(resolveSeriesAy(undefined, AYS)).toBe('AY2026');
    expect(
      resolveSeriesAy('comparison', { selectedAy: 'AY2026', compareAy: null })
    ).toBe('AY2026');
  });
});

describe('ratingSegmentFromCategory', () => {
  it('reads the star count off the bar label', () => {
    expect(ratingSegmentFromCategory('4★')).toBe('4');
    expect(ratingSegmentFromCategory('★')).toBeNull();
  });
});

describe('assessmentSegment', () => {
  it('maps subject + series key to the target segment', () => {
    expect(assessmentSegment('Math', 'pass')).toBe('math:pass');
    expect(assessmentSegment('English', 'notAssessed')).toBe('eng:notAssessed');
    expect(assessmentSegment('Science', 'pass')).toBeNull();
    expect(assessmentSegment('Math', undefined)).toBeNull();
  });
});

describe('reasonSegmentForSlice', () => {
  const bars = [
    { key: 'financial', label: 'Financial reasons' },
    { key: 'other_reasons', label: 'Other reasons' },
  ];
  it('opens a named reason by its code', () => {
    expect(
      decodePairSegment(reasonSegmentForSlice('Financial reasons', bars)!)
    ).toEqual({
      first: '',
      second: 'financial',
    });
  });
  it('opens the overflow slice as the overflow bucket', () => {
    expect(
      decodePairSegment(reasonSegmentForSlice('Other reasons', bars)!)
    ).toEqual({
      first: '',
      second: OVERFLOW_SEGMENT,
    });
  });
  it('ignores a slice it does not know', () => {
    expect(reasonSegmentForSlice('Nope', bars)).toBeNull();
  });
});

describe('referralSegmentForSlice', () => {
  it('opens the folded Other as the overflow bucket', () => {
    const rows = [
      { source: 'Facebook' },
      { source: 'Other', folded: true as const },
    ];
    expect(referralSegmentForSlice('Other', rows)).toBe(OVERFLOW_SEGMENT);
    expect(referralSegmentForSlice('Facebook', rows)).toBe('Facebook');
  });
  it('keeps a real source named Other when nothing was folded', () => {
    expect(referralSegmentForSlice('Other', [{ source: 'Other' }])).toBe(
      'Other'
    );
  });
});

describe('pair helpers', () => {
  it('build the nationality and level-reasons segments', () => {
    expect(decodePairSegment(nationalitySegment('Singapore'))).toEqual({
      first: '',
      second: 'Singapore',
    });
    expect(
      decodePairSegment(
        nationalitySegment('Other', 'Youngstarters | Little Stars')
      )
    ).toEqual({ first: 'Youngstarters | Little Stars', second: 'Other' });
    expect(decodePairSegment(levelReasonsSegment('P1'))).toEqual({
      first: 'P1',
      second: '',
    });
  });
});

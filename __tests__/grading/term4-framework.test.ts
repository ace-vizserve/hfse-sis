import { describe, expect, it } from 'vitest';
import { computeQuarterly } from '@/lib/compute/quarterly';
import {
  TERM4_FRAMEWORK_SHAPE,
  isTerm4Framework,
  parseSheetType,
} from '@/lib/grading/term4-framework';

describe('Term 4 framework', () => {
  it('worked example: best 86, rec 24/30, task 70/100 -> 80 -> 87', () => {
    const s = TERM4_FRAMEWORK_SHAPE;
    const out = computeQuarterly({
      ww_scores: [86],
      ww_totals: [...s.ww_totals],
      pt_scores: [24],
      pt_totals: [...s.pt_totals],
      qa_score: 70,
      qa_total: s.qa_total,
      ww_weight: s.ww_weight,
      pt_weight: s.pt_weight,
      qa_weight: s.qa_weight,
    });
    expect(out.initial_grade).toBeCloseTo(80, 6);
    expect(out.quarterly_grade).toBe(87);
  });

  it('parses the sheet type', () => {
    expect(parseSheetType(undefined)).toBe('standard');
    expect(parseSheetType(null)).toBe('standard');
    expect(parseSheetType('term4_framework')).toBe('term4_framework');
    expect(parseSheetType('holistic')).toBeNull();
    expect(parseSheetType(4)).toBeNull();
  });

  it('recognises the type', () => {
    expect(isTerm4Framework('term4_framework')).toBe(true);
    expect(isTerm4Framework('standard')).toBe(false);
    expect(isTerm4Framework(null)).toBe(false);
  });
});

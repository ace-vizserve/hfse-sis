import { describe, expect, it } from 'vitest';
import { computeIndexStatus } from '@/lib/sis/section-index-status';

describe('computeIndexStatus', () => {
  it('mint "complete" when every active student has an index number', () => {
    expect(computeIndexStatus(21, 0)).toEqual({
      label: 'Index #1–21 complete',
      tone: 'mint',
    });
  });

  it('amber "N unnumbered" when some students are missing one', () => {
    expect(computeIndexStatus(20, 1)).toEqual({
      label: '1 student unnumbered',
      tone: 'amber',
    });
  });

  it('pluralizes correctly for multiple unnumbered students', () => {
    expect(computeIndexStatus(18, 3)).toEqual({
      label: '3 students unnumbered',
      tone: 'amber',
    });
  });

  it('an empty section (0 active) reads as complete, not amber', () => {
    expect(computeIndexStatus(0, 0)).toEqual({
      label: 'Index #1–0 complete',
      tone: 'mint',
    });
  });
});

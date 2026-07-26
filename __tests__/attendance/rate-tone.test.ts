import { describe, expect, it } from 'vitest';
import { rateTone } from '@/lib/attendance/rate-tone';

describe('rateTone', () => {
  it('bands >= 95 as Excellent (mint)', () => {
    expect(rateTone(95)).toEqual({
      text: 'text-brand-mint',
      stroke: 'stroke-brand-mint',
      label: 'Excellent',
    });
    expect(rateTone(100)).toMatchObject({ label: 'Excellent' });
  });

  it('bands 85-94.9 as Watch (amber)', () => {
    expect(rateTone(85)).toEqual({
      text: 'text-brand-amber',
      stroke: 'stroke-brand-amber',
      label: 'Watch',
    });
    expect(rateTone(94.9)).toMatchObject({ label: 'Watch' });
  });

  it('bands below 85 as At risk (destructive)', () => {
    expect(rateTone(84.9)).toEqual({
      text: 'text-destructive',
      stroke: 'stroke-destructive',
      label: 'At risk',
    });
    expect(rateTone(0)).toMatchObject({ label: 'At risk' });
  });
});

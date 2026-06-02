import { describe, expect, it } from 'vitest';

import { computeEarlyBirdClosures, type AyFlagRow } from '@/lib/sis/early-bird';

const rows: AyFlagRow[] = [
  { ay_code: 'AY2026', is_current: true, accepting_applications: true },
  { ay_code: 'AY2027', is_current: false, accepting_applications: true },
  { ay_code: 'AY2028', is_current: false, accepting_applications: false },
];

describe('computeEarlyBirdClosures', () => {
  it('opening a different upcoming AY closes the currently-open upcoming AY', () => {
    expect(computeEarlyBirdClosures('AY2028', rows)).toEqual(['AY2027']);
  });

  it('opening the already-open upcoming AY closes nothing', () => {
    expect(computeEarlyBirdClosures('AY2027', rows)).toEqual([]);
  });

  it('never closes the current AY', () => {
    expect(computeEarlyBirdClosures('AY2028', rows)).not.toContain('AY2026');
  });

  it('opening the current AY is not a single-select op (no closures)', () => {
    expect(computeEarlyBirdClosures('AY2026', rows)).toEqual([]);
  });

  it('unknown target closes nothing', () => {
    expect(computeEarlyBirdClosures('AY2099', rows)).toEqual([]);
  });
});

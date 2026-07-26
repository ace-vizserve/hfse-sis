import { describe, expect, it } from 'vitest';
import { presentOnlyCount } from '@/lib/attendance/queries';

describe('presentOnlyCount', () => {
  it('subtracts late and excused from the inclusive daysPresent count', () => {
    // daysPresent from the rollup is P+L+EX combined (see migration 068) —
    // present-only P = daysPresent − daysLate − daysExcused.
    expect(
      presentOnlyCount({ daysPresent: 14, daysLate: 1, daysExcused: 2 })
    ).toBe(11);
  });

  it('floors at zero instead of going negative', () => {
    expect(
      presentOnlyCount({ daysPresent: 0, daysLate: 1, daysExcused: 0 })
    ).toBe(0);
  });
});

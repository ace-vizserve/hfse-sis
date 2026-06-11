import { describe, it, expect } from 'vitest';

import { scoreSection } from '@/lib/sis/class-assignment';

// classType both-null contributes a fixed +3 baseline (see scoreSection), so a
// schedule hit reads as 8 and a miss as 3 in these cases.
const app = (preferredSchedule: string | null) => ({
  levelApplied: 'Primary One',
  classType: null,
  preferredSchedule,
});
const sec = (schedule: string | null, name = 'Obedience') => ({
  name,
  class_type: null as string | null,
  schedule,
});

describe('scoreSection — structured schedule', () => {
  it('exact match (normalized) adds 5', () => {
    expect(scoreSection(sec('morning'), app('Morning'))).toBe(8);
    expect(scoreSection(sec('whole_day'), app('Whole Day'))).toBe(8);
  });

  it('no match adds 0', () => {
    expect(scoreSection(sec('afternoon'), app('Morning'))).toBe(3);
  });

  it('whole_day section matches ANY preference (no AM/PM split)', () => {
    expect(scoreSection(sec('whole_day'), app('Morning'))).toBe(8);
    expect(scoreSection(sec('whole_day'), app('Afternoon'))).toBe(8);
  });

  it('blank preference contributes nothing', () => {
    expect(scoreSection(sec('morning'), app(null))).toBe(3);
    expect(scoreSection(sec('morning'), app(''))).toBe(3);
  });

  it('null schedule falls back to the section-name grep (legacy AYs)', () => {
    // schedule column not set, but the old name encodes it → still matches.
    expect(scoreSection(sec(null, 'Obedience | Morning'), app('Morning'))).toBe(
      8
    );
    // 'Whole Day' (space) must match a name carrying "Whole Day".
    expect(
      scoreSection(sec(null, 'Discipline | Whole Day'), app('Whole Day'))
    ).toBe(8);
    // no hint in the name → no schedule credit.
    expect(scoreSection(sec(null, 'Obedience'), app('Morning'))).toBe(3);
  });
});

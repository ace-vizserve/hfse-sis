import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';

// listAssignableSections/validateSectionChoice are DB-backed — manual
// verification only, consistent with every other DB-backed function in
// this repo (no live-DB test harness exists here). This suite covers what
// is pure/testable: the shared capacity constant.
describe('class-assignment constants', () => {
  it('MAX_ACTIVE_PER_SECTION matches Hard Rule #5', () => {
    expect(MAX_ACTIVE_PER_SECTION).toBe(50);
  });
});

/**
 * The profile edit sheet used to render all 5 sibling sections and all 3
 * discount inputs on every student. It now draws only the slots that hold
 * data, plus any the registrar reveals with "Add".
 *
 * The rule that matters is that visibility is keyed on the SLOT, never on a
 * count. Production has AY2026 rows where a discount sits in slot 2 with slot
 * 1 empty; "draw the first N" would hide a real value inside a form that still
 * submits it — data present, invisible, and silently re-saved. These tests
 * pin the slot-keyed behaviour so that can't regress into a count.
 */

import { describe, it, expect } from 'vitest';
import { filledSlots } from '@/components/sis/edit-profile-sheet';
import type { ProfileUpdateInput } from '@/lib/schemas/sis';

const siblingKey = (n: number) =>
  `siblingFullName${n}` as keyof ProfileUpdateInput;
const discountKey = (n: number) => `discount${n}` as keyof ProfileUpdateInput;

function profile(v: Record<string, unknown>): Partial<ProfileUpdateInput> {
  return v as Partial<ProfileUpdateInput>;
}

describe('filledSlots — sparse rows keep their real slot', () => {
  it('reports slot 2 when slot 1 is empty (the production case)', () => {
    const row = profile({ discount1: null, discount2: 'EARLYBIRD' });
    expect(filledSlots(row, 3, discountKey)).toEqual([2]);
  });

  it('keeps a gap intact rather than compacting it', () => {
    const row = profile({
      siblingFullName1: 'Ana Cruz',
      siblingFullName2: null,
      siblingFullName3: 'Ben Cruz',
    });
    // NOT [1, 2] — slot 3 holds the data and must be the one drawn.
    expect(filledSlots(row, 5, siblingKey)).toEqual([1, 3]);
  });
});

describe('filledSlots — what counts as filled', () => {
  it('returns nothing for a student with no siblings', () => {
    expect(filledSlots(profile({}), 5, siblingKey)).toEqual([]);
  });

  it('treats null, undefined, empty and whitespace as empty', () => {
    const row = profile({
      siblingFullName1: null,
      siblingFullName2: undefined,
      siblingFullName3: '',
      siblingFullName4: '   ',
      siblingFullName5: 'Real Name',
    });
    expect(filledSlots(row, 5, siblingKey)).toEqual([5]);
  });

  it('never reports a slot beyond the maximum', () => {
    // Guards the sibling/discount maxima being different (5 vs 3): a stray
    // discount4 column must not be surfaced by the discount call.
    const row = profile({ discount1: 'A', discount2: 'B', discount3: 'C' });
    const out = filledSlots(row, 3, discountKey);
    expect(out).toEqual([1, 2, 3]);
    expect(Math.max(...out)).toBeLessThanOrEqual(3);
  });

  it('reports every filled slot, so nothing is hidden behind a cap', () => {
    const row = profile({
      siblingFullName1: 'A',
      siblingFullName2: 'B',
      siblingFullName3: 'C',
      siblingFullName4: 'D',
      siblingFullName5: 'E',
    });
    expect(filledSlots(row, 5, siblingKey)).toEqual([1, 2, 3, 4, 5]);
  });
});

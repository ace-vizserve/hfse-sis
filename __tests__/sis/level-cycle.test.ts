import { describe, expect, it } from 'vitest';
import {
  isCoreLabelChangeBlocked,
  walksBackTo,
} from '@/app/api/sis/admin/levels/[id]/route';
import type { LevelRow } from '@/lib/sis/levels';

// Local factory mirroring the LevelRow shape — only id + nextLevelId matter
// to the cycle walk; the rest are filler.
function lvl(id: string, nextLevelId: string | null): LevelRow {
  return {
    id,
    code: id.toUpperCase(),
    label: `Level ${id}`,
    levelType: 'primary',
    sortOrder: 1,
    nextLevelId,
    isCore: false,
  };
}

describe('walksBackTo — progression cycle detection', () => {
  it('detects the direct self-reference (start === edited)', () => {
    const rows = [lvl('a', null)];
    // Proposing a→a: the walk starts at "a" which IS the edited level.
    expect(walksBackTo(rows, 'a', 'a')).toBe(true);
  });

  it('detects a 2-hop cycle (A→B while B→A)', () => {
    // B already points at A; proposing A.next = B closes A→B→A.
    const rows = [lvl('a', null), lvl('b', 'a')];
    expect(walksBackTo(rows, 'a', 'b')).toBe(true);
  });

  it('detects a 3-hop cycle (A→B→C→A)', () => {
    // B→C and C→A exist; proposing A.next = B closes the triangle.
    const rows = [lvl('a', null), lvl('b', 'c'), lvl('c', 'a')];
    expect(walksBackTo(rows, 'a', 'b')).toBe(true);
  });

  it('accepts a legitimate non-cycle chain', () => {
    // B→C→D→null; proposing A.next = B never returns to A.
    const rows = [lvl('a', null), lvl('b', 'c'), lvl('c', 'd'), lvl('d', null)];
    expect(walksBackTo(rows, 'a', 'b')).toBe(false);
  });

  it('accepts when the edited level sits UPSTREAM of the target (re-pointing forward)', () => {
    // Existing chain A→B→C; proposing A.next = C (skipping B) is fine —
    // walking from C goes C→null, never back to A.
    const rows = [lvl('a', 'b'), lvl('b', 'c'), lvl('c', null)];
    expect(walksBackTo(rows, 'a', 'c')).toBe(false);
  });

  it('treats a dangling/unknown pointer as non-cycle (false)', () => {
    // B points at an id that is not in rows — the walk stops there.
    const rows = [lvl('a', null), lvl('b', 'ghost')];
    expect(walksBackTo(rows, 'a', 'b')).toBe(false);
  });

  it('is bounded by rows.length hops — a pre-existing loop not containing the edited level terminates as false', () => {
    // B→C→B is already a loop that never reaches A. Without the hop bound
    // the walk would spin forever; with it, it exits false after
    // rows.length iterations.
    const rows = [lvl('a', null), lvl('b', 'c'), lvl('c', 'b')];
    expect(walksBackTo(rows, 'a', 'b')).toBe(false);
  });

  it('returns false on an empty rows array (zero hops allowed)', () => {
    expect(walksBackTo([], 'a', 'b')).toBe(false);
  });
});

describe('isCoreLabelChangeBlocked — core level name protection', () => {
  it('blocks an actual label change on a core level', () => {
    expect(
      isCoreLabelChangeBlocked(
        { isCore: true, label: 'Primary One' },
        'Primary 1'
      )
    ).toBe(true);
  });

  it('allows a same-value resubmit on a core level (not a real change)', () => {
    expect(
      isCoreLabelChangeBlocked(
        { isCore: true, label: 'Primary One' },
        'Primary One'
      )
    ).toBe(false);
  });

  it('allows label omitted (sortOrder/nextLevelId-only PATCH) on a core level', () => {
    expect(
      isCoreLabelChangeBlocked(
        { isCore: true, label: 'Primary One' },
        undefined
      )
    ).toBe(false);
  });

  it('allows any label change on a volatile level', () => {
    expect(
      isCoreLabelChangeBlocked(
        { isCore: false, label: 'Cambridge Secondary One (Year 8)' },
        'CS1 renamed'
      )
    ).toBe(false);
  });
});

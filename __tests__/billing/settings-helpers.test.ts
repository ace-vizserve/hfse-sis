import { describe, expect, it } from 'vitest';

import {
  firstDuplicate,
  groupChanges,
  isRealDate,
  TILES_SKIPPED_MESSAGE,
  tilesSweepBlocker,
  yearAfterReclassify,
} from '@/lib/billing/settings-helpers';
import type { BillingMaps, StageChoice } from '@/lib/billing/classify';

const maps = (
  accounts: Array<[string, StageChoice]>,
  items: Array<[string, StageChoice]>,
  ranges: BillingMaps['ranges']
): BillingMaps => ({
  accounts: new Map(accounts),
  items: new Map(items),
  ranges,
});
const AY = [{ ayCode: 'AY2027', startsOn: '2026-01-01', endsOn: '2026-12-31' }];

describe('yearAfterReclassify', () => {
  it('a KD #231 row (enrolee number set) keeps its stored year', () => {
    expect(yearAfterReclassify('E1', 'AY2026', null)).toBe('AY2026');
    expect(yearAfterReclassify('E1', 'AY2026', 'AY2027')).toBe('AY2026');
  });
  it('any other row takes the classified year', () => {
    expect(yearAfterReclassify(null, 'AY2026', 'AY2027')).toBe('AY2027');
    expect(yearAfterReclassify(undefined, 'AY2026', null)).toBeNull();
  });
});

describe('tilesSweepBlocker', () => {
  it('blocks with no year range', () => {
    expect(tilesSweepBlocker(maps([['a', 'fees']], [], []))).toBe(
      TILES_SKIPPED_MESSAGE
    );
  });
  it('blocks with no Registration or Fees mapping', () => {
    expect(tilesSweepBlocker(maps([], [], AY))).toBe(TILES_SKIPPED_MESSAGE);
    expect(tilesSweepBlocker(maps([['a', 'none']], [['i', 'none']], AY))).toBe(
      TILES_SKIPPED_MESSAGE
    );
  });
  it('allows a range plus one account or one item mapping', () => {
    expect(tilesSweepBlocker(maps([['a', 'registration']], [], AY))).toBeNull();
    expect(tilesSweepBlocker(maps([], [['i', 'fees']], AY))).toBeNull();
  });
});

describe('firstDuplicate', () => {
  it('finds the repeated key', () => {
    expect(firstDuplicate(['a', 'b', 'a'])).toBe('a');
  });
  it('null when all distinct', () => {
    expect(firstDuplicate(['a', 'b'])).toBeNull();
    expect(firstDuplicate([])).toBeNull();
  });
});

describe('isRealDate', () => {
  it('accepts real dates incl. leap day', () => {
    expect(isRealDate('2026-05-31')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
  });
  it('refuses impossible dates', () => {
    expect(isRealDate('2026-13-45')).toBe(false);
    expect(isRealDate('2027-02-29')).toBe(false);
    expect(isRealDate('2026-4-1')).toBe(false);
  });
});

describe('groupChanges', () => {
  it('groups identical outcomes and chunks ids', () => {
    const rows = [
      { id: '1', ayCode: 'AY2027', stageKeys: ['fees'] },
      { id: '2', ayCode: 'AY2027', stageKeys: ['fees'] },
      { id: '3', ayCode: null, stageKeys: [] },
      { id: '4', ayCode: 'AY2027', stageKeys: ['fees'] },
    ];
    const g = groupChanges(rows, 2);
    expect(g).toEqual([
      { ayCode: 'AY2027', stageKeys: ['fees'], ids: ['1', '2'] },
      { ayCode: 'AY2027', stageKeys: ['fees'], ids: ['4'] },
      { ayCode: null, stageKeys: [], ids: ['3'] },
    ]);
  });
});

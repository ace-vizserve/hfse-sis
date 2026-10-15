import { describe, expect, it } from 'vitest';

import {
  firstDuplicate,
  groupChanges,
  isRealDate,
} from '@/lib/billing/settings-helpers';

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

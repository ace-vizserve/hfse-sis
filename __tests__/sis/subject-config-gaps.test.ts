/**
 * findEmptyLevels() — the warning banner's data source on
 * /sis/admin/subjects (also feeds the readiness pill's subject-weights
 * step and the Hub attention feed — all three MUST call this one function).
 *
 * Post migration 089 (Structure Defaults template removed): there is no
 * "what SHOULD be configured" reference left to compare against, so the
 * check narrowed to "does this level have at least one subject attached at
 * all" — a pure presence check over live subject_level_offerings rows, no
 * comparison source needed.
 */

import { describe, expect, it } from 'vitest';
import { findEmptyLevels } from '@/lib/sis/subject-config-gaps';

const LEVELS = [
  { id: 'lvl-p3', label: 'Primary 3' },
  { id: 'lvl-s1', label: 'Secondary 1' },
  { id: 'lvl-s2', label: 'Secondary 2' },
];

describe('findEmptyLevels', () => {
  it('returns no gaps when every level has at least one subject attached', () => {
    const gaps = findEmptyLevels(LEVELS, [
      { level_id: 'lvl-p3', subject_id: 'sub-math' },
      { level_id: 'lvl-s1', subject_id: 'sub-sci' },
      { level_id: 'lvl-s2', subject_id: 'sub-arts' },
    ]);
    expect(gaps).toEqual([]);
  });

  it('reports a level with zero subject offerings anywhere in the input', () => {
    const gaps = findEmptyLevels(LEVELS, [
      { level_id: 'lvl-p3', subject_id: 'sub-math' },
      { level_id: 'lvl-s1', subject_id: 'sub-sci' },
      // lvl-s2 never appears in actualOfferings
    ]);
    expect(gaps).toEqual([{ levelId: 'lvl-s2', levelLabel: 'Secondary 2' }]);
  });

  it('a level is still counted empty even if other levels have many subjects', () => {
    const gaps = findEmptyLevels(LEVELS, [
      { level_id: 'lvl-p3', subject_id: 'sub-math' },
      { level_id: 'lvl-p3', subject_id: 'sub-sci' },
      { level_id: 'lvl-p3', subject_id: 'sub-arts' },
    ]);
    expect(gaps.map((g) => g.levelId).sort()).toEqual(['lvl-s1', 'lvl-s2']);
  });

  it('covers multiple empty levels, sorted by level label', () => {
    const gaps = findEmptyLevels(LEVELS, []);
    expect(gaps.map((g) => g.levelLabel)).toEqual([
      'Primary 3',
      'Secondary 1',
      'Secondary 2',
    ]);
  });

  it('an offering row for an unknown level id is silently ignored, never crashes', () => {
    const gaps = findEmptyLevels(LEVELS, [
      { level_id: 'lvl-unknown', subject_id: 'sub-math' },
    ]);
    expect(gaps.map((g) => g.levelId).sort()).toEqual([
      'lvl-p3',
      'lvl-s1',
      'lvl-s2',
    ]);
  });
});

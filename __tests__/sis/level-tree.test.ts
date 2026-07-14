import { describe, expect, it } from 'vitest';
import { computeLevelTree } from '@/lib/sis/level-tree';
import type { LevelRow } from '@/lib/sis/levels';
import type { LevelTransitionRow } from '@/lib/sis/level-transitions';

function level(
  id: string,
  sortOrder: number,
  isCore: boolean,
  overrides: Partial<LevelRow> = {}
): LevelRow {
  return {
    id,
    code: id.toUpperCase(),
    label: id,
    levelType: 'primary',
    sortOrder,
    nextLevelId: null,
    isCore,
    ...overrides,
  };
}

describe('computeLevelTree', () => {
  it('builds one node per core level, ordered by sort_order', () => {
    const levels = [
      level('s1', 10, true),
      level('p6', 9, true),
      level('cs1', 14, false),
    ];
    const nodes = computeLevelTree(levels, []);
    expect(nodes.map((n) => n.level.id)).toEqual(['p6', 's1']);
  });

  it('attaches a branch to its real evidenced anchor over the sort_order fallback', () => {
    const levels = [
      level('p6', 9, true),
      level('s1', 10, true),
      // GEP track sits far away in sort_order (would fall back to s1's
      // neighbor by proximity) but real applications show it's actually
      // reached from p6 — evidence must win.
      level('gep8', 20, false),
    ];
    const transitionRows: LevelTransitionRow[] = [
      { fromLevelId: 'p6', toLabel: 'gep8', toLevelId: 'gep8', count: 5 },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    const p6Node = nodes.find((n) => n.level.id === 'p6')!;
    const s1Node = nodes.find((n) => n.level.id === 's1')!;
    expect(p6Node.branchesAfter.map((b) => b.level.id)).toEqual(['gep8']);
    expect(p6Node.branchesAfter[0].evidenced).toBe(true);
    expect(p6Node.branchesAfter[0].observedCount).toBe(5);
    expect(s1Node.branchesAfter).toHaveLength(0);
    expect(s1Node.branchesBefore).toHaveLength(0);
  });

  it('falls back to nearest sort_order neighbor with no real evidence', () => {
    const levels = [
      level('p1', 4, true),
      level('p2', 5, true),
      level('ys-s', 3, false), // just before p1
      level('cs1', 14, false), // after everything
      level('s4', 13, true),
    ];
    const nodes = computeLevelTree(levels, []);
    const p1Node = nodes.find((n) => n.level.id === 'p1')!;
    const s4Node = nodes.find((n) => n.level.id === 's4')!;
    expect(p1Node.branchesBefore.map((b) => b.level.id)).toEqual(['ys-s']);
    expect(p1Node.branchesBefore[0].evidenced).toBe(false);
    expect(s4Node.branchesAfter.map((b) => b.level.id)).toEqual(['cs1']);
    expect(s4Node.branchesAfter[0].evidenced).toBe(false);
  });

  it('ignores evidence whose origin is itself a non-spine (branch) level', () => {
    // A branch-to-branch transition shouldn't anchor anything — only
    // spine-originated evidence counts (branches attach to the spine, not
    // to each other).
    const levels = [
      level('p6', 9, true),
      level('cs1', 14, false),
      level('cs2', 15, false),
    ];
    const transitionRows: LevelTransitionRow[] = [
      { fromLevelId: 'cs1', toLabel: 'cs2', toLevelId: 'cs2', count: 3 },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    const p6Node = nodes.find((n) => n.level.id === 'p6')!;
    // cs2 falls back to nearest spine neighbor (p6, the only spine level).
    expect(p6Node.branchesAfter.map((b) => b.level.id).sort()).toEqual([
      'cs1',
      'cs2',
    ]);
    expect(p6Node.branchesAfter.every((b) => !b.evidenced)).toBe(true);
  });

  it('returns an empty tree with no spine levels at all', () => {
    const nodes = computeLevelTree([level('cs1', 14, false)], []);
    expect(nodes).toEqual([]);
  });
});

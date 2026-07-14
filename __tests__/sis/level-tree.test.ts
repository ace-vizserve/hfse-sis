import { describe, expect, it } from 'vitest';
import { computeLevelTree, flattenLevelTree } from '@/lib/sis/level-tree';
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
  it('builds one root node per core level, ordered by sort_order', () => {
    const levels = [level('s1', 10, true), level('p6', 9, true)];
    const nodes = computeLevelTree(levels, []);
    expect(nodes.map((n) => n.level.id)).toEqual(['p6', 's1']);
  });

  it('attaches a branch to its real evidenced anchor over the sort_order fallback', () => {
    const levels = [
      level('p6', 9, true),
      level('s1', 10, true),
      level('gep8', 20, false),
    ];
    const transitionRows: LevelTransitionRow[] = [
      { fromLevelId: 'p6', toLabel: 'gep8', toLevelId: 'gep8', count: 5 },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    const p6Node = nodes.find((n) => n.level.id === 'p6')!;
    expect(p6Node.childrenAfter.map((c) => c.level.id)).toEqual(['gep8']);
    expect(p6Node.childrenAfter[0].evidenced).toBe(true);
    expect(p6Node.childrenAfter[0].observedCount).toBe(5);
  });

  it('falls back to nearest sort_order neighbor with no real evidence', () => {
    const levels = [
      level('p1', 4, true),
      level('ys-s', 3, false),
      level('cs1', 14, false),
      level('s4', 13, true),
    ];
    const nodes = computeLevelTree(levels, []);
    const p1Node = nodes.find((n) => n.level.id === 'p1')!;
    const s4Node = nodes.find((n) => n.level.id === 's4')!;
    expect(p1Node.childrenBefore.map((c) => c.level.id)).toEqual(['ys-s']);
    expect(p1Node.childrenBefore[0].evidenced).toBe(false);
    expect(s4Node.childrenAfter.map((c) => c.level.id)).toEqual(['cs1']);
  });

  it('lets a NON-core level branch to multiple destinations — the real YS-J case', () => {
    // "Youngstarters | Junior Stars" (non-core) branches to BOTH "Primary
    // One" (mainstream, core) and an HFSE Global Education Programme
    // equivalent (non-core) — a branch with its own branches, not just a
    // spine node.
    const levels = [
      level('p1', 4, true),
      level('ys-j', 2, false),
      level('gep-y2', 30, false, { label: 'GEP Year 2' }),
    ];
    const transitionRows: LevelTransitionRow[] = [
      // ys-j is a non-spine origin here — must still count as evidence.
      { fromLevelId: 'ys-j', toLabel: 'p1', toLevelId: 'p1', count: 40 },
      {
        fromLevelId: 'ys-j',
        toLabel: 'gep-y2',
        toLevelId: 'gep-y2',
        count: 6,
      },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    // ys-j falls back to the spine (nearest = p1) since nothing points TO
    // ys-j itself, so it hangs off p1 as a "before" branch (sortOrder 2 < 4).
    const p1Node = nodes.find((n) => n.level.id === 'p1')!;
    const ysjNode = p1Node.childrenBefore.find((c) => c.level.id === 'ys-j');
    expect(ysjNode).toBeDefined();
    // gep-y2 is evidenced FROM ys-j (a non-spine origin) — it must nest
    // under ys-j, not get silently dropped or reattached to the spine.
    expect(ysjNode!.childrenAfter.map((c) => c.level.id)).toEqual(['gep-y2']);
    expect(ysjNode!.childrenAfter[0].evidenced).toBe(true);
    expect(ysjNode!.childrenAfter[0].observedCount).toBe(6);
  });

  it('breaks a two-level attachment cycle instead of looping or dropping nodes', () => {
    const levels = [
      level('p1', 4, true),
      level('a', 20, false),
      level('b', 21, false),
    ];
    const transitionRows: LevelTransitionRow[] = [
      { fromLevelId: 'a', toLabel: 'b', toLevelId: 'b', count: 3 },
      { fromLevelId: 'b', toLabel: 'a', toLevelId: 'a', count: 3 },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    const flat = flattenLevelTree(nodes);
    // Both a and b must still appear exactly once, somewhere in the tree.
    expect(flat.filter((n) => n.level.id === 'a')).toHaveLength(1);
    expect(flat.filter((n) => n.level.id === 'b')).toHaveLength(1);
  });

  it('returns an empty tree with no spine levels at all', () => {
    const nodes = computeLevelTree([level('cs1', 14, false)], []);
    expect(nodes).toEqual([]);
  });
});

describe('flattenLevelTree', () => {
  it('flattens a nested tree depth-first', () => {
    const levels = [
      level('p1', 4, true),
      level('ys-j', 2, false),
      level('gep-y2', 30, false),
    ];
    const transitionRows: LevelTransitionRow[] = [
      { fromLevelId: 'ys-j', toLabel: 'gep-y2', toLevelId: 'gep-y2', count: 6 },
    ];
    const nodes = computeLevelTree(levels, transitionRows);
    const flat = flattenLevelTree(nodes);
    expect(flat.map((n) => n.level.id).sort()).toEqual([
      'gep-y2',
      'p1',
      'ys-j',
    ]);
  });
});

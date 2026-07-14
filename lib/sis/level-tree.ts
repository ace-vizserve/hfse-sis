// Pure tree-shape computation for the Grade Levels catalog view. No new
// schema — the hierarchy is derived entirely from data already loaded, and
// it is genuinely recursive: ANY level can have its own branches, not just
// the permanent core spine. Real example that forced this: "Youngstarters
// | Junior Stars" (non-core) itself branches to two destinations —
// "Primary One" and an HFSE Global Education Programme equivalent — so a
// branch can have branches of its own, just like a spine level can.
//
// SPINE = the permanent core levels (is_core=true, P1..S4), ordered by
// sort_order. Always the tree's roots — guaranteed to exist, never
// deleted (KD #153).
//
// Every other level attaches to a PARENT — resolved in priority order:
//   1. Real evidence: lib/sis/level-transitions.ts's computeLevelTransitions
//      tells us which level's students actually applied to this one. When
//      that data exists, attach there — it's ground truth, not a guess.
//      The origin can be a spine level OR another branch (this is what
//      makes the tree recursive — a branch can itself be evidence-anchored
//      to another branch).
//   2. Fallback: nearest SPINE neighbor by sort_order, for levels with no
//      observed-application data yet.
//
// Cycle guard: evidence is real-world data, so in principle two levels
// could each show up as the other's best-evidenced origin (e.g. a data
// anomaly, or transfers going both directions in different years). Any
// level whose parent chain doesn't terminate at a spine root is forced
// back onto its nearest-spine fallback, breaking the loop — never dropped,
// never an infinite tree.

import type { LevelRow } from '@/lib/sis/levels';
import type { LevelTransitionRow } from '@/lib/sis/level-transitions';

export type LevelTreeNode = {
  level: LevelRow;
  evidenced: boolean;
  observedCount: number | null;
  childrenBefore: LevelTreeNode[];
  childrenAfter: LevelTreeNode[];
};

function nearestLevel(
  target: LevelRow,
  candidates: LevelRow[]
): LevelRow | null {
  let nearest: LevelRow | null = null;
  let nearestDist = Infinity;
  for (const c of candidates) {
    if (c.id === target.id) continue;
    const dist = Math.abs(c.sortOrder - target.sortOrder);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = c;
    }
  }
  return nearest;
}

type Attachment = {
  parentId: string;
  evidenced: boolean;
  observedCount: number | null;
};

export function computeLevelTree(
  levels: LevelRow[],
  transitionRows: LevelTransitionRow[]
): LevelTreeNode[] {
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const spine = levels
    .filter((l) => l.isCore)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const spineIds = new Set(spine.map((s) => s.id));

  // Best evidence per destination level, from ANY origin — a branch can be
  // anchored to another branch, not only to the spine.
  const evidenceByLevel = new Map<
    string,
    { fromLevelId: string; count: number }
  >();
  for (const row of transitionRows) {
    if (!row.toLevelId) continue;
    if (row.toLevelId === row.fromLevelId) continue; // guard against a nonsensical self-loop
    const existing = evidenceByLevel.get(row.toLevelId);
    if (!existing || row.count > existing.count) {
      evidenceByLevel.set(row.toLevelId, {
        fromLevelId: row.fromLevelId,
        count: row.count,
      });
    }
  }

  const attachmentByLevel = new Map<string, Attachment>();
  for (const level of levels) {
    if (level.isCore) continue;
    const evidence = evidenceByLevel.get(level.id);
    if (evidence && levelById.has(evidence.fromLevelId)) {
      attachmentByLevel.set(level.id, {
        parentId: evidence.fromLevelId,
        evidenced: true,
        observedCount: evidence.count,
      });
    } else {
      const nearestSpine = nearestLevel(level, spine);
      attachmentByLevel.set(level.id, {
        parentId: nearestSpine?.id ?? '',
        evidenced: false,
        observedCount: null,
      });
    }
  }

  // Cycle guard — see file header. Re-anchors anything that doesn't reach
  // a spine root within a bounded number of hops.
  function resolvesToSpine(startId: string): boolean {
    let current = startId;
    const seen = new Set<string>();
    for (let i = 0; i <= levels.length; i++) {
      if (spineIds.has(current)) return true;
      if (seen.has(current)) return false; // cycle
      seen.add(current);
      const attachment = attachmentByLevel.get(current);
      if (!attachment || !attachment.parentId) return false;
      current = attachment.parentId;
    }
    return false;
  }
  for (const level of levels) {
    if (level.isCore) continue;
    if (!resolvesToSpine(level.id)) {
      const nearestSpine = nearestLevel(level, spine);
      attachmentByLevel.set(level.id, {
        parentId: nearestSpine?.id ?? '',
        evidenced: false,
        observedCount: null,
      });
    }
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [levelId, attachment] of attachmentByLevel) {
    if (!attachment.parentId) continue;
    const arr = childrenByParent.get(attachment.parentId) ?? [];
    arr.push(levelId);
    childrenByParent.set(attachment.parentId, arr);
  }

  function buildNode(
    level: LevelRow,
    evidenced: boolean,
    observedCount: number | null
  ): LevelTreeNode {
    const childIds = childrenByParent.get(level.id) ?? [];
    const before: LevelTreeNode[] = [];
    const after: LevelTreeNode[] = [];
    for (const childId of childIds) {
      const child = levelById.get(childId);
      if (!child) continue;
      const attachment = attachmentByLevel.get(childId)!;
      const childNode = buildNode(
        child,
        attachment.evidenced,
        attachment.observedCount
      );
      if (child.sortOrder <= level.sortOrder) before.push(childNode);
      else after.push(childNode);
    }
    before.sort((a, b) => a.level.sortOrder - b.level.sortOrder);
    after.sort((a, b) => a.level.sortOrder - b.level.sortOrder);
    return {
      level,
      evidenced,
      observedCount,
      childrenBefore: before,
      childrenAfter: after,
    };
  }

  return spine.map((s) => buildNode(s, true, null));
}

// Flattens a tree back into a plain list (depth-first) — used by the
// drag-and-drop layer to find "every node currently in the tree" without
// re-walking computeLevelTree's internals.
export function flattenLevelTree(nodes: LevelTreeNode[]): LevelTreeNode[] {
  const out: LevelTreeNode[] = [];
  function walk(list: LevelTreeNode[]) {
    for (const node of list) {
      walk(node.childrenBefore);
      out.push(node);
      walk(node.childrenAfter);
    }
  }
  walk(nodes);
  return out;
}

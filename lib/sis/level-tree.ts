// Pure tree-shape computation for the Grade Levels catalog view. No new
// schema — the "hierarchy" is derived entirely from data already loaded:
//
// SPINE = the permanent core levels (is_core=true, P1..S4), ordered by
// sort_order. Guaranteed to exist, never deleted (KD #153).
//
// BRANCH = every other (volatile) level. Each branch needs an attachment
// point on the spine — resolved in priority order:
//   1. Real evidence: lib/sis/level-transitions.ts's computeLevelTransitions
//      already tells us which core level's students actually applied to
//      this branch level (e.g. Primary Six -> an HFSE Global Education
//      Programme track). When that data exists, attach there — it's ground
//      truth, not a guess.
//   2. Fallback: nearest spine neighbor by sort_order, for levels with no
//      observed-application data yet (freshly synced, or genuinely no
//      applicants this cycle).
//
// `evidenced` on each branch tells the UI which kind of attachment it is —
// the tree view renders evidenced branches with a solid connector and
// fallback branches with a dashed one, so "is this real or a structural
// guess" is visible at a glance, not just implied.

import type { LevelRow } from '@/lib/sis/levels';
import type { LevelTransitionRow } from '@/lib/sis/level-transitions';

export type LevelTreeBranch = {
  level: LevelRow;
  attachedToLevelId: string;
  evidenced: boolean;
  observedCount: number | null;
};

export type LevelTreeNode = {
  level: LevelRow;
  branchesBefore: LevelTreeBranch[];
  branchesAfter: LevelTreeBranch[];
};

export function computeLevelTree(
  levels: LevelRow[],
  transitionRows: LevelTransitionRow[]
): LevelTreeNode[] {
  const spine = levels
    .filter((l) => l.isCore)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const branchLevels = levels.filter((l) => !l.isCore);

  const spineIds = new Set(spine.map((s) => s.id));
  // toLevelId -> the highest-count spine level real applicants came from.
  const evidenceByBranchLevel = new Map<
    string,
    { fromLevelId: string; count: number }
  >();
  for (const row of transitionRows) {
    if (!row.toLevelId) continue;
    if (!spineIds.has(row.fromLevelId)) continue; // only spine-originated evidence anchors a branch
    const existing = evidenceByBranchLevel.get(row.toLevelId);
    if (!existing || row.count > existing.count) {
      evidenceByBranchLevel.set(row.toLevelId, {
        fromLevelId: row.fromLevelId,
        count: row.count,
      });
    }
  }

  const nodes: LevelTreeNode[] = spine.map((level) => ({
    level,
    branchesBefore: [],
    branchesAfter: [],
  }));
  const nodeByLevelId = new Map(nodes.map((n) => [n.level.id, n]));

  for (const branch of branchLevels) {
    const evidence = evidenceByBranchLevel.get(branch.id);

    let anchorId: string | undefined;
    let evidenced = false;
    let observedCount: number | null = null;

    if (evidence) {
      anchorId = evidence.fromLevelId;
      evidenced = true;
      observedCount = evidence.count;
    } else if (spine.length > 0) {
      let nearest = spine[0];
      let nearestDist = Math.abs(spine[0].sortOrder - branch.sortOrder);
      for (const s of spine) {
        const dist = Math.abs(s.sortOrder - branch.sortOrder);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = s;
        }
      }
      anchorId = nearest.id;
    }

    if (!anchorId) continue; // no spine at all — nothing to attach to
    const node = nodeByLevelId.get(anchorId);
    if (!node) continue;

    const branchEntry: LevelTreeBranch = {
      level: branch,
      attachedToLevelId: anchorId,
      evidenced,
      observedCount,
    };
    if (branch.sortOrder <= node.level.sortOrder) {
      node.branchesBefore.push(branchEntry);
    } else {
      node.branchesAfter.push(branchEntry);
    }
  }

  // Stable, readable ordering within each bucket.
  for (const node of nodes) {
    node.branchesBefore.sort((a, b) => a.level.sortOrder - b.level.sortOrder);
    node.branchesAfter.sort((a, b) => a.level.sortOrder - b.level.sortOrder);
  }

  return nodes;
}

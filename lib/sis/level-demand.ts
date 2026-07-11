// Pure demand-signal helper for the Levels & Grade Progression admin page.
// Counts applicants per canonicalized level label and flags whether that
// level is currently offered — no I/O, no Supabase, safe to unit-test in
// isolation. Callers (an RSC loader) supply the applications, the level
// catalog (`LevelRow[]`, from `getLevelRows`), and the offered-id set (from
// `getOfferedLevelIds`).

import { canonicalizeLevelLabel } from '@/lib/sis/levels';
import type { LevelRow } from '@/lib/sis/levels';

export type LevelDemandRow = {
  label: string;
  levelId: string | null;
  count: number;
  offered: boolean;
};

export function computeLevelDemand(
  applications: Array<{ levelApplied: string | null }>,
  levels: LevelRow[],
  offeredIds: Set<string>
): LevelDemandRow[] {
  const levelByLabel = new Map(levels.map((l) => [l.label, l]));
  const counts = new Map<string, number>();

  for (const app of applications) {
    const label = canonicalizeLevelLabel(app.levelApplied);
    if (!label) continue; // skips null / empty / whitespace-only
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([label, count]) => {
    const level = levelByLabel.get(label);
    const levelId = level?.id ?? null;
    const offered = levelId !== null && offeredIds.has(levelId);
    return { label, levelId, count, offered };
  });
}

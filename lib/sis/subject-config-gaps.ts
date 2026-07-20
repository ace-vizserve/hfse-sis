// Pure check: which levels have literally zero subjects attached this AY?
// A level with no subjects silently produces no grading sheets AND nothing
// on the report card for that level (build-report-card.ts scopes subjects
// by subject_configs — no error, no visible signal anywhere) — this is the
// computation that surfaces the gap on /sis/admin/subjects.
//
// Post migration 089 (Structure Defaults template removed): there is no
// longer a "what SHOULD be configured" reference to compare against — the
// old per-subject comparison against template_subject_level_offerings is
// gone. This narrows to the simplest signal computable purely from an AY's
// own live data: does a level have at least one subject_level_offerings row
// at all. Strictly narrower than the old check (fewer false positives, no
// per-subject-code detail), by design — see the Structure Defaults removal
// design doc.
//
// Same underlying check as lib/sis/readiness.ts's fetchSubjectWeights step
// — that one aggregates to a fraction for the readiness pill, this one
// produces the named list of empty levels for the warning banner. Kept as
// two call sites reading the same shape rather than one shared aggregator
// because their outputs serve different shapes (fraction vs. named list) —
// but both MUST call this same function so the two surfaces (and the Hub
// attention feed, a third caller) can never drift out of sync with each
// other (KD #124/#128's "count == drill" principle, applied here).

export type EmptyLevelGap = {
  levelId: string;
  levelLabel: string;
};

export function findEmptyLevels(
  levels: Array<{ id: string; label: string }>,
  // Source: subject_level_offerings (scoped to the AY) — which levels this
  // AY actually has at least one subject attached to.
  actualOfferings: Array<{ level_id: string; subject_id: string }>
): EmptyLevelGap[] {
  const levelIdsWithOfferings = new Set(actualOfferings.map((o) => o.level_id));

  const gaps: EmptyLevelGap[] = [];
  for (const level of levels) {
    if (!levelIdsWithOfferings.has(level.id)) {
      gaps.push({ levelId: level.id, levelLabel: level.label });
    }
  }

  return gaps.sort((a, b) => a.levelLabel.localeCompare(b.levelLabel));
}

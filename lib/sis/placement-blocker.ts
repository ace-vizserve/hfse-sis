import { normalizeLevelLabel } from '@/lib/sync/level-normalizer';
import { normalizeSectionName } from '@/lib/sync/section-normalizer';

// ──────────────────────────────────────────────────────────────────────────
// Why a class filled in OUTSIDE the SIS cannot be placed.
//
// Directus and the old enrolment link let admissions type any class they like
// — "Year 8", "Discipline-1", a class nobody set up for that year. The SIS
// never saw those values until the nightly auto-sync tried to place the child,
// and then the sync refused and the only trace was an `errors` string inside
// an audit row nobody reads. The queue kept saying "Not yet synced to
// grading", which reads as "wait for tonight" — and tonight fails the same way.
//
// This predicts that refusal BEFORE the sync runs, in words a school admin can
// act on. It deliberately walks the same steps as `buildSyncPlan` in
// `lib/sync/students.ts`, with the same two normalizers and the same EXACT
// lookups (`levels.label`, then `${level_id}::${name}`), so the queue and the
// sync cannot disagree: if this returns null the sync will find the class, and
// if it returns a sentence the sync would have failed for that reason.
//
// ⚠ Class size is NOT checked here. A full class is also a reason placement
// fails, but seats also count children assigned a class and not yet enrolled,
// and a second copy of that count here would drift
// from the one the class dialogs and the cap use.
// ──────────────────────────────────────────────────────────────────────────

export type PlacementLookup = {
  levels: ReadonlyArray<{ id: string; label: string }>;
  sections: ReadonlyArray<{ level_id: string; name: string }>;
};

export function describePlacementBlocker(
  row: {
    ayCode: string;
    classLevel: string | null;
    classSection: string | null;
  },
  lookup: PlacementLookup
): string | null {
  const levelLabel = normalizeLevelLabel(row.classLevel);
  if (!levelLabel) {
    return 'No level was filled in with the class, so they cannot be placed. Use Assign section to pick their class.';
  }

  const level = lookup.levels.find((l) => l.label === levelLabel);
  if (!level) {
    return `"${row.classLevel?.trim()}" is not a level the school uses, so they cannot be placed. Use Assign section to pick their class.`;
  }

  const sectionName = normalizeSectionName(row.classSection);
  if (!sectionName) {
    return 'No class was filled in, so they cannot be placed. Use Assign section to pick their class.';
  }

  const exists = lookup.sections.some(
    (s) => s.level_id === level.id && s.name === sectionName
  );
  if (!exists) {
    return `There is no class called "${row.classSection?.trim()}" in ${level.label} for ${row.ayCode}. Use Assign section to pick a class that exists.`;
  }

  return null;
}

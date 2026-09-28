// lib/sis/backfill/house/section-name-match.ts
//
// Name matching WITHIN ONE CLASS, and the house sheet's section spellings.
// Shared by the two house-assignment scripts:
//
//   scripts/backfill/apply-house-assignments.ts            (superseded — do not re-run)
//   scripts/backfill/apply-house-assignments-class-tabs.ts (the correction)
//
// Extracted verbatim from the first so both match names the same way. Kept
// identical to apply-masterlist-alignment.ts's copy (that script still holds
// its own; it is not touched here).
//
// Three tiers, each requiring a UNIQUE hit: exact (accents stripped), same
// tokens REORDERED, then one name's tokens a SUBSET of the other's. An
// ambiguous match returns null — the failure it guards against puts a child in
// their classmate's house. Pure: no database, no file reads.

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function tokens(name: string): string[] {
  return stripDiacritics(name)
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export const nameKey = (name: string) => tokens(name).join(' ').trim();

export type NameMatchTier = 'exact' | 'reordered' | 'subset';

/**
 * Finds `name` among `candidates` (keyed by `nameKey`). Returns null when
 * nothing matches OR when a tier has more than one hit.
 */
export function matchName<T>(
  name: string,
  candidates: Map<string, T>
): { row: T; via: NameMatchTier } | null {
  const exact = candidates.get(nameKey(name));
  if (exact !== undefined) return { row: exact, via: 'exact' };

  const mine = tokens(name);
  const sortedMine = [...mine].sort().join(' ');

  const reordered = [...candidates.entries()].filter(
    ([k]) => k.split(' ').sort().join(' ') === sortedMine
  );
  if (reordered.length === 1) return { row: reordered[0][1], via: 'reordered' };

  const mineSet = new Set(mine);
  const subset = [...candidates.entries()].filter(([k]) => {
    const theirs = k.split(' ');
    const theirSet = new Set(theirs);
    return (
      mine.every((t) => theirSet.has(t)) || theirs.every((t) => mineSet.has(t))
    );
  });
  if (subset.length === 1) return { row: subset[0][1], via: 'subset' };

  return null;
}

/**
 * Why `matchName` returned null: 'ambiguous' when some tier had more than one
 * hit (two classmates fit equally well), 'none' when nothing fit at all. The
 * two need different answers from a human, so callers report them apart.
 */
export function whyNoMatch<T>(
  name: string,
  candidates: Map<string, T>
): 'ambiguous' | 'none' {
  const mine = tokens(name);
  const sortedMine = [...mine].sort().join(' ');
  const mineSet = new Set(mine);
  let reordered = 0;
  let subset = 0;
  for (const k of candidates.keys()) {
    const theirs = k.split(' ');
    if ([...theirs].sort().join(' ') === sortedMine) reordered += 1;
    const theirSet = new Set(theirs);
    if (
      mine.every((t) => theirSet.has(t)) ||
      theirs.every((t) => mineSet.has(t))
    )
      subset += 1;
  }
  return reordered > 1 || subset > 1 ? 'ambiguous' : 'none';
}

/**
 * The house sheet writes section names its own way, including two
 * misspellings, and the CSV export and the workbook tabs space the secondary
 * codes differently ("SEC 1 D1" vs "SEC 1D1"). Explicit aliases rather than
 * fuzzy matching: a section that fails to match is SILENT — it reports no
 * problems, which reads exactly like being correct. Any unmapped section is
 * reported by the callers.
 */
const SECTION_ALIASES: Record<string, string> = {
  'P2 HUMILTY': 'P2 HUMILITY', // sic
  'P3 RESONSIBILITY': 'P3 RESPONSIBILITY', // sic
  'SEC 1 D1': 'S1 DISCIPLINE 1',
  'SEC 1 D2': 'S1 DISCIPLINE 2',
  'SEC 2 I1': 'S2 INTEGRITY 1',
  'SEC 2 I2': 'S2 INTEGRITY 2',
  // The workbook tabs' own spelling.
  'SEC 1D1': 'S1 DISCIPLINE 1',
  'SEC 1D2': 'S1 DISCIPLINE 2',
  'SEC 2I1': 'S2 INTEGRITY 1',
  'SEC 2I2': 'S2 INTEGRITY 2',
  'SEC 3': 'S3 CONSISTENCY',
  'SEC 4': 'S4 EXCELLENCE',
};

export function normaliseSection(title: string): string {
  const key = title.replace(/\s+/g, ' ').trim().toUpperCase();
  return SECTION_ALIASES[key] ?? key;
}

export const LEVEL_TO_PREFIX: Record<string, string> = {
  'Primary One': 'P1',
  'Primary Two': 'P2',
  'Primary Three': 'P3',
  'Primary Four': 'P4',
  'Primary Five': 'P5',
  'Primary Six': 'P6',
  'Secondary One': 'S1',
  'Secondary Two': 'S2',
  'Secondary Three': 'S3',
  'Secondary Four': 'S4',
};

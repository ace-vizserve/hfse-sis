// Derives a clean (KD #144-style) level code + section name from a T1
// attendance workbook sheet tab name. "YS" is flagged distinctly rather
// than silently included or silently dropped — the level catalog for
// Youngstarters is being reworked concurrently (see the design doc), so
// this import excludes it and the caller surfaces that in the review
// report instead of guessing.

export type SectionIdentity =
  | { kind: 'core'; levelCode: string; cleanName: string }
  | { kind: 'ys' }
  | { kind: 'unrecognized'; rawSheetName: string };

const CORE_LEVEL_RE = /^(P[1-6]|S[1-4])\s+(.+)$/;

export function deriveSectionIdentity(sheetName: string): SectionIdentity {
  const trimmed = sheetName.trim();
  if (trimmed === 'YS') return { kind: 'ys' };

  // Drop a trailing parenthetical annotation like "(G)" or "(AM Global)",
  // with or without a leading space.
  const stripped = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const match = stripped.match(CORE_LEVEL_RE);
  if (match) {
    return { kind: 'core', levelCode: match[1], cleanName: match[2].trim() };
  }
  return { kind: 'unrecognized', rawSheetName: sheetName };
}

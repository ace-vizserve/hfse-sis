// HFSE level labels — canonical storage is word form ('Youngstarters', 'Primary One',
// 'Secondary Four') after migration 029.
// This module defends against legacy digit-form inputs (e.g. cached parent-portal
// payloads, half-migrated test fixtures) by canonicalizing them on read.
const DIGIT_TO_WORD: Record<string, string> = {
  'Primary 1': 'Primary One',
  'Primary 2': 'Primary Two',
  'Primary 3': 'Primary Three',
  'Primary 4': 'Primary Four',
  'Primary 5': 'Primary Five',
  'Primary 6': 'Primary Six',
  'Secondary 1': 'Secondary One',
  'Secondary 2': 'Secondary Two',
  'Secondary 3': 'Secondary Three',
  'Secondary 4': 'Secondary Four',
};

export function normalizeLevelLabel(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return DIGIT_TO_WORD[trimmed] ?? trimmed;
}

/**
 * The SIS level a class's level name points at. The name itself first (legacy
 * digit forms canonicalised), else what the enrolment form options map it to —
 * the `level_aliases` rows. Admissions files a child under the programme's own
 * year names: Year 8 is Secondary One, Year 9 Secondary Two, Year 10 Secondary
 * Three. Matching the SIS label alone told admissions "Year 8" was "not a level
 * the school uses". Null when the name is blank or maps to nothing.
 *
 * Pure. The sync, the unsynced queue's blocker, the seat count and the Enrolled
 * check all use it, so none of them can disagree about which level a class is.
 */
export function findClassLevel<L extends { id: string; label: string }>(
  raw: string | null | undefined,
  levels: readonly L[],
  aliases: ReadonlyArray<{ raw_label: string; level_id: string }> = []
): L | null {
  const label = normalizeLevelLabel(raw);
  if (!label) return null;
  const direct = levels.find((l) => l.label === label);
  if (direct) return direct;
  const alias = aliases.find((a) => a.raw_label === label);
  return alias ? (levels.find((l) => l.id === alias.level_id) ?? null) : null;
}

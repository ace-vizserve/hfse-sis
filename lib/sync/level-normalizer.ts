// HFSE level labels — canonical storage is word form ('Primary One', 'Secondary Four',
// 'Youngstarters | Little Stars', 'Cambridge Secondary One (Year 8)') after migration 029.
// This module defends against legacy digit-form inputs (e.g. cached parent-portal
// payloads, half-migrated test fixtures) by canonicalizing them on read.
const DIGIT_TO_WORD: Record<string, string> = {
  'Primary 1':   'Primary One',
  'Primary 2':   'Primary Two',
  'Primary 3':   'Primary Three',
  'Primary 4':   'Primary Four',
  'Primary 5':   'Primary Five',
  'Primary 6':   'Primary Six',
  'Secondary 1': 'Secondary One',
  'Secondary 2': 'Secondary Two',
  'Secondary 3': 'Secondary Three',
  'Secondary 4': 'Secondary Four',
};

export function normalizeLevelLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return DIGIT_TO_WORD[trimmed] ?? trimmed;
}

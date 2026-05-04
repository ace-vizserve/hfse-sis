// Canonical level codes (short internal identifiers used in levels.code FK).
export const LEVEL_CODES = [
  'YS-L', 'YS-J', 'YS-S',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'S1', 'S2', 'S3', 'S4',
  'CS1', 'CS2',
] as const;
export type LevelCode = (typeof LEVEL_CODES)[number];

// Canonical level labels (the word form, stored in levels.label and used as
// classLevel/levelApplied in admissions tables after migration 029).
export const LEVEL_LABELS = {
  'YS-L': 'Youngstarters | Little Stars',
  'YS-J': 'Youngstarters | Junior Stars',
  'YS-S': 'Youngstarters | Senior Stars',
  'P1':  'Primary One',
  'P2':  'Primary Two',
  'P3':  'Primary Three',
  'P4':  'Primary Four',
  'P5':  'Primary Five',
  'P6':  'Primary Six',
  'S1':  'Secondary One',
  'S2':  'Secondary Two',
  'S3':  'Secondary Three',
  'S4':  'Secondary Four',
  'CS1': 'Cambridge Secondary One (Year 8)',
  'CS2': 'Cambridge Secondary Two (Year 9)',
} as const satisfies Record<LevelCode, string>;
export type LevelLabel = (typeof LEVEL_LABELS)[LevelCode];

// All canonical labels in display order. Useful for sort orders, dropdowns,
// chart axes, etc.
export const LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_CODES.map(
  (c) => LEVEL_LABELS[c],
);

// Mapping from level type to the codes belonging to it.
export const LEVEL_TYPE_BY_CODE: Record<LevelCode, 'preschool' | 'primary' | 'secondary'> = {
  'YS-L': 'preschool', 'YS-J': 'preschool', 'YS-S': 'preschool',
  'P1': 'primary', 'P2': 'primary', 'P3': 'primary', 'P4': 'primary', 'P5': 'primary', 'P6': 'primary',
  'S1': 'secondary', 'S2': 'secondary', 'S3': 'secondary', 'S4': 'secondary',
  'CS1': 'secondary', 'CS2': 'secondary',
};

// Calendar audience values. Mirrors the school_calendar.audience CHECK
// (migration 037). Preschool falls through to 'all' (deferred — no
// preschool-specific overrides yet).
export const CALENDAR_AUDIENCE_VALUES = ['all', 'primary', 'secondary'] as const;
export type CalendarAudience = (typeof CALENDAR_AUDIENCE_VALUES)[number];

// For an attendance writer or grid reader, return the audience value to
// match against `school_calendar.audience` for the section's level.
// Preschool returns null — caller should match only audience='all' rows.
// Primary / Secondary return the matching audience.
//
// Used by app/api/attendance/daily/route.ts to scope the day-type lookup
// (audience IN ('all', $level_type) with audience=$level_type winning).
export function levelTypeForAudienceLookup(
  levelOrCode: string | null | undefined,
): 'primary' | 'secondary' | null {
  if (!levelOrCode) return null;
  const code = (levelOrCode in LEVEL_LABELS
    ? (levelOrCode as LevelCode)
    : LEVEL_CODE_BY_LABEL[canonicalizeLevelLabel(levelOrCode) ?? '']) as LevelCode | undefined;
  if (!code) return null;
  const t = LEVEL_TYPE_BY_CODE[code];
  if (t === 'primary' || t === 'secondary') return t;
  return null;
}

// Inverse lookup — label -> code.
export const LEVEL_CODE_BY_LABEL: Record<string, LevelCode> = Object.fromEntries(
  LEVEL_CODES.map((c) => [LEVEL_LABELS[c], c]),
);

// Markbook-eligible level labels (preschool excluded — Youngstarters does not
// have subject_configs / report cards yet). Use this for any code path that
// iterates levels for grading sheets, subject weights, report-card groupings,
// etc.
export const MARKBOOK_LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_LABELS_ORDERED.filter(
  (label) => LEVEL_TYPE_BY_CODE[LEVEL_CODE_BY_LABEL[label]] !== 'preschool',
);

// Primary-only level labels in display order.
export const PRIMARY_LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_LABELS_ORDERED.filter(
  (label) => LEVEL_TYPE_BY_CODE[LEVEL_CODE_BY_LABEL[label]] === 'primary',
);

// Secondary-only level labels in display order (includes Cambridge Secondary).
export const SECONDARY_LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_LABELS_ORDERED.filter(
  (label) => LEVEL_TYPE_BY_CODE[LEVEL_CODE_BY_LABEL[label]] === 'secondary',
);

// Legacy digit→word map. Used to backfill any legacy data that leaks through
// without the SQL migration (e.g. cached payloads, half-replicated fixtures).
// Defensive — should be a no-op against properly-migrated DB rows.
const LEGACY_DIGIT_LABELS: Record<string, LevelLabel> = {
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

// Canonicalize an arbitrary level string to the word form. Already-word
// inputs pass through unchanged. Unknown values pass through unchanged so
// "Other" / typos surface to the admin.
export function canonicalizeLevelLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed in LEGACY_DIGIT_LABELS) return LEGACY_DIGIT_LABELS[trimmed];
  return trimmed;
}

// Sort comparator — orders any two level labels by their canonical position.
// Unknown labels sort to the end.
export function compareLevelLabels(a: string | null | undefined, b: string | null | undefined): number {
  const ai = a ? LEVEL_LABELS_ORDERED.indexOf(canonicalizeLevelLabel(a) as LevelLabel) : -1;
  const bi = b ? LEVEL_LABELS_ORDERED.indexOf(canonicalizeLevelLabel(b) as LevelLabel) : -1;
  if (ai === -1 && bi === -1) return (a ?? '').localeCompare(b ?? '');
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

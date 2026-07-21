// NOTE: this module is imported by both server code (RSC loaders, API
// routes) and 'use client' components (e.g. records-drill-sheet.tsx, for
// compareLevelLabels) — never add a top-level `import 'server-only'` guard
// here. The DB-backed loaders below import `unstable_cache` from
// `next/cache`, which is safe to include in a client bundle (Next ships it
// as a plain function that only throws if actually *called* outside a
// server context, not on import) — client components here only ever import
// the pure label helpers above and never call `getLevelRows`/
// `getOfferedLevelIds`, so the unreachable branch never executes. Same
// pattern as lib/sis/dashboard.ts. Note there is no `createServiceClient`
// (or any Supabase client construction) in this file at all — every loader
// below takes an already-constructed client as a parameter.
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

// Canonical level codes (short internal identifiers used in levels.code FK).
// Fixed set — Primary One through Secondary Four only (migration 086 removed
// the volatile Youngstarters/Cambridge Secondary levels: real grading and
// attendance data confirmed HFSE never used them, and curriculum
// differentiation like a Cambridge-style class is a SECTION concern —
// class_type + per-section subject attachment — not a separate level).
export const LEVEL_CODES = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'S1',
  'S2',
  'S3',
  'S4',
] as const;
export type LevelCode = (typeof LEVEL_CODES)[number];

// Canonical level labels (the word form, stored in levels.label and used as
// classLevel/levelApplied in admissions tables after migration 029).
export const LEVEL_LABELS = {
  P1: 'Primary One',
  P2: 'Primary Two',
  P3: 'Primary Three',
  P4: 'Primary Four',
  P5: 'Primary Five',
  P6: 'Primary Six',
  S1: 'Secondary One',
  S2: 'Secondary Two',
  S3: 'Secondary Three',
  S4: 'Secondary Four',
} as const satisfies Record<LevelCode, string>;
export type LevelLabel = (typeof LEVEL_LABELS)[LevelCode];

// All canonical labels in display order. Useful for sort orders, dropdowns,
// chart axes, etc.
const LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_CODES.map(
  (c) => LEVEL_LABELS[c]
);

// Mapping from level type to the codes belonging to it. No 'preschool'
// member remains — see the LEVEL_CODES removal note above.
export const LEVEL_TYPE_BY_CODE: Record<LevelCode, 'primary' | 'secondary'> = {
  P1: 'primary',
  P2: 'primary',
  P3: 'primary',
  P4: 'primary',
  P5: 'primary',
  P6: 'primary',
  S1: 'secondary',
  S2: 'secondary',
  S3: 'secondary',
  S4: 'secondary',
};

// For an attendance writer or grid reader, return the audience value to
// match against `school_calendar.audience` for the section's level.
// An unmatched/unknown label returns null — caller should match only
// audience='all' rows in that case.
//
// Used by app/api/attendance/daily/route.ts to scope the day-type lookup
// (audience IN ('all', $level_type) with audience=$level_type winning).
export function levelTypeForAudienceLookup(
  levelOrCode: string | null | undefined
): 'primary' | 'secondary' | null {
  if (!levelOrCode) return null;
  const code = (
    levelOrCode in LEVEL_LABELS
      ? (levelOrCode as LevelCode)
      : LEVEL_CODE_BY_LABEL[canonicalizeLevelLabel(levelOrCode) ?? '']
  ) as LevelCode | undefined;
  return code ? LEVEL_TYPE_BY_CODE[code] : null;
}

// Inverse lookup — label -> code.
const LEVEL_CODE_BY_LABEL: Record<string, LevelCode> = Object.fromEntries(
  LEVEL_CODES.map((c) => [LEVEL_LABELS[c], c])
);

// Legacy digit→word map. Used to backfill any legacy data that leaks through
// without the SQL migration (e.g. cached payloads, half-replicated fixtures).
// Defensive — should be a no-op against properly-migrated DB rows.
const LEGACY_DIGIT_LABELS: Record<string, LevelLabel> = {
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

// Canonicalize an arbitrary level string to the word form. Already-word
// inputs pass through unchanged. Unknown values pass through unchanged so
// "Other" / typos surface to the admin.
export function canonicalizeLevelLabel(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed in LEGACY_DIGIT_LABELS) return LEGACY_DIGIT_LABELS[trimmed];
  return trimmed;
}

// Sort comparator — orders any two level labels by their canonical position.
// Unknown labels sort to the end.
export function compareLevelLabels(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const ai = a
    ? LEVEL_LABELS_ORDERED.indexOf(canonicalizeLevelLabel(a) as LevelLabel)
    : -1;
  const bi = b
    ? LEVEL_LABELS_ORDERED.indexOf(canonicalizeLevelLabel(b) as LevelLabel)
    : -1;
  if (ai === -1 && bi === -1) return (a ?? '').localeCompare(b ?? '');
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export type LevelAliasRow = { raw_label: string; level_id: string };

/**
 * Resolves a raw observed level label to a `levels.id`. Pure — no DB
 * access, unit-testable directly. Order: (1) exact match against
 * `knownLevels[].label`, (2) `canonicalizeLevelLabel`'s legacy digit-form
 * fallback re-checked against `knownLevels[].label`, (3) exact match
 * against `aliases[].raw_label`. Returns null when nothing matches —
 * callers treat that as "needs reconciliation," never guess.
 */
export function resolveLevelIdFromCatalog(
  rawLabel: string | null | undefined,
  knownLevels: LevelRow[],
  aliases: LevelAliasRow[]
): string | null {
  if (rawLabel == null) return null;
  const trimmed = rawLabel.trim();
  if (!trimmed) return null;

  const direct = knownLevels.find((l) => l.label === trimmed);
  if (direct) return direct.id;

  const canonical = canonicalizeLevelLabel(trimmed);
  if (canonical && canonical !== trimmed) {
    const viaLegacy = knownLevels.find((l) => l.label === canonical);
    if (viaLegacy) return viaLegacy.id;
  }

  const viaAlias = aliases.find((a) => a.raw_label === trimmed);
  return viaAlias ? viaAlias.level_id : null;
}

/**
 * DB-backed wrapper around `resolveLevelIdFromCatalog`. Fetches the
 * current levels catalog + the full alias table and resolves once.
 */
export async function resolveLevelId(
  service: SupabaseClient,
  rawLabel: string | null | undefined
): Promise<string | null> {
  if (rawLabel == null || !rawLabel.trim()) return null;

  const [levels, aliasRes] = await Promise.all([
    getLevelRows(service),
    service.from('level_aliases').select('raw_label, level_id'),
  ]);
  if (aliasRes.error) throw aliasRes.error;

  return resolveLevelIdFromCatalog(
    rawLabel,
    levels,
    (aliasRes.data ?? []) as LevelAliasRow[]
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DB-backed level rows. `levels` is a small, fixed, AY-agnostic managed
// table: `sort_order` drives display order. Migration 086 removed the
// volatile-level / per-AY-offering concept (KD #153) — every remaining
// level is core (P1-P6, S1-S4) and always offered, so there is no more
// "which levels are offered this AY" question to answer; `getOfferedLevelIds`
// and the `ay_level_offerings` table it read no longer exist. `is_core`/
// `next_level_id` stay on the row (is_core is now trivially true for every
// row; next_level_id was already dormant per KD #153's own note) rather than
// narrowing the schema further, which wasn't required for this removal.
//
// Follows the hoisted-uncached + per-call unstable_cache idiom (KD #46; see
// lib/sis/readiness.ts) — the service client is captured via closure so it
// is never passed as an argument into the cached function invocation itself
// (unstable_cache would otherwise try to fold a non-serializable Supabase
// client into its cache key).
// ─────────────────────────────────────────────────────────────────────────

export type LevelRow = {
  id: string;
  code: string;
  label: string;
  levelType: 'primary' | 'secondary';
  sortOrder: number;
  nextLevelId: string | null;
  isCore: boolean;
};

type LevelRowDb = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
  sort_order: number;
  next_level_id: string | null;
  is_core: boolean;
};

async function getLevelRowsUncached(
  service: SupabaseClient
): Promise<LevelRow[]> {
  const { data, error } = await service
    .from('levels')
    .select('id, code, label, level_type, sort_order, next_level_id, is_core')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as LevelRowDb[]).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    levelType: row.level_type,
    sortOrder: row.sort_order,
    nextLevelId: row.next_level_id,
    isCore: row.is_core,
  }));
}

// All levels, ordered by sort_order. Cached 60s under the shared 'levels'
// tag — any write path that mutates `levels` should `revalidateTag('levels')`.
export function getLevelRows(service: SupabaseClient): Promise<LevelRow[]> {
  return unstable_cache(
    () => getLevelRowsUncached(service),
    ['sis-levels-rows'],
    {
      revalidate: 60,
      tags: ['levels'],
    }
  )();
}

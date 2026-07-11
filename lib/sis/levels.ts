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
export const LEVEL_CODES = [
  'YS-L',
  'YS-J',
  'YS-S',
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
  'CS1',
  'CS2',
] as const;
export type LevelCode = (typeof LEVEL_CODES)[number];

// Canonical level labels (the word form, stored in levels.label and used as
// classLevel/levelApplied in admissions tables after migration 029).
export const LEVEL_LABELS = {
  'YS-L': 'Youngstarters | Little Stars',
  'YS-J': 'Youngstarters | Junior Stars',
  'YS-S': 'Youngstarters | Senior Stars',
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
  CS1: 'Cambridge Secondary One (Year 8)',
  CS2: 'Cambridge Secondary Two (Year 9)',
} as const satisfies Record<LevelCode, string>;
export type LevelLabel = (typeof LEVEL_LABELS)[LevelCode];

// All canonical labels in display order. Useful for sort orders, dropdowns,
// chart axes, etc.
const LEVEL_LABELS_ORDERED: readonly LevelLabel[] = LEVEL_CODES.map(
  (c) => LEVEL_LABELS[c]
);

// Mapping from level type to the codes belonging to it.
export const LEVEL_TYPE_BY_CODE: Record<
  LevelCode,
  'preschool' | 'primary' | 'secondary'
> = {
  'YS-L': 'preschool',
  'YS-J': 'preschool',
  'YS-S': 'preschool',
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
  CS1: 'secondary',
  CS2: 'secondary',
};

// For an attendance writer or grid reader, return the audience value to
// match against `school_calendar.audience` for the section's level.
// Preschool returns null — caller should match only audience='all' rows.
// Primary / Secondary return the matching audience.
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
  if (!code) return null;
  const t = LEVEL_TYPE_BY_CODE[code];
  if (t === 'primary' || t === 'secondary') return t;
  return null;
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

// ─────────────────────────────────────────────────────────────────────────
// DB-backed level rows + per-AY offerings (migration 078 — Levels & Grade
// Progression, Phase 2). `levels` is a small, AY-agnostic managed table:
// `sort_order` drives display order, `next_level_id` is the progression
// pointer, `is_core` marks P1-P6/S1-S4 (permanent, always offered). Volatile
// (non-core) levels are offered in a given AY only when an `ay_level_offerings`
// row exists for that (academic_year_id, level_id) pair.
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
  levelType: 'preschool' | 'primary' | 'secondary';
  sortOrder: number;
  nextLevelId: string | null;
  isCore: boolean;
};

type LevelRowDb = {
  id: string;
  code: string;
  label: string;
  level_type: 'preschool' | 'primary' | 'secondary';
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

// Returns a plain array (not a Set) — unstable_cache persists its return
// value (e.g. to the filesystem cache handler in production), which requires
// JSON-serializable data; `JSON.stringify(new Set(...))` collapses to `{}`,
// silently losing every id. The public `getOfferedLevelIds` wrapper below
// converts to a Set only after the cached call returns.
async function getOfferedLevelIdsUncached(
  service: SupabaseClient,
  academicYearId: string
): Promise<string[]> {
  const [
    { data: coreRows, error: coreError },
    { data: offeringRows, error: offeringError },
  ] = await Promise.all([
    service.from('levels').select('id').eq('is_core', true),
    service
      .from('ay_level_offerings')
      .select('level_id')
      .eq('academic_year_id', academicYearId),
  ]);

  if (coreError) throw coreError;
  if (offeringError) throw offeringError;

  const ids = new Set<string>(
    ((coreRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  for (const row of (offeringRows ?? []) as Array<{ level_id: string }>) {
    ids.add(row.level_id);
  }
  return Array.from(ids);
}

// Level ids offered in a given AY: every core level id (always offered) plus
// any volatile level id with an `ay_level_offerings` row for that AY.
export async function getOfferedLevelIds(
  service: SupabaseClient,
  academicYearId: string
): Promise<Set<string>> {
  const ids = await unstable_cache(
    () => getOfferedLevelIdsUncached(service, academicYearId),
    ['sis-offered-level-ids', academicYearId],
    { revalidate: 60, tags: ['levels'] }
  )();
  return new Set(ids);
}

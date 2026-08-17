import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { COUNTRY_NAME_SET } from '@/lib/data/countries';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { compareLevelLabels } from '@/lib/sis/levels';

// ──────────────────────────────────────────────────────────────────────────
// Conversion breakdowns for the Admissions Insights page — by level and by
// referral source. All driven by `applicationStatus` (populated 490/490 in
// prod) + `levelApplied` / `howDidYouKnowAboutHFSEIS`, never the per-stage
// `*UpdatedDate` columns (unstamped in prod — the deep stage-date funnel was
// hollow and was removed). The enrolee-type conversion breakdown was removed
// with the 2026-07 Insights simplification (returning students re-enrol
// ~100% structurally — nobody acts on it).
//
// Cache tag: `admissions-dashboard:${ayCode}` — same invalidation as the
// operational dashboard so any write that flushes admissions data also
// refreshes these.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 60;

// ──────────────────────────────────────────────────────────────────────────
// Internal row shapes fetched from the DB
// ──────────────────────────────────────────────────────────────────────────

type StatusFunnelRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
};

type AppFunnelRow = {
  enroleeNumber: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
  nationality: string | null;
};

type JoinedFunnelRow = {
  enroleeNumber: string;
  applicationStatus: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
  nationality: string | null;
};

// ──────────────────────────────────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────────────────────────────────

async function loadFunnelRowsUncached(
  ayCode: string
): Promise<JoinedFunnelRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;

  let statusRows: StatusFunnelRow[];
  let appRows: AppFunnelRow[];

  try {
    [statusRows, appRows] = await Promise.all([
      fetchAllPages<StatusFunnelRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_status`)
            .select('enroleeNumber, applicationStatus')
            .range(from, to) as unknown as P<StatusFunnelRow>
      ),
      fetchAllPages<AppFunnelRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_applications`)
            .select(
              'enroleeNumber, levelApplied, howDidYouKnowAboutHFSEIS, category, nationality'
            )
            .range(from, to) as unknown as P<AppFunnelRow>
      ),
    ]);
  } catch (err) {
    console.error('[admissions-funnel] fetch failed:', err);
    return [];
  }

  const appByEnrolee = new Map<string, AppFunnelRow>();
  for (const a of appRows) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const out: JoinedFunnelRow[] = [];
  for (const s of statusRows) {
    if (!s.enroleeNumber) continue;
    const app = appByEnrolee.get(s.enroleeNumber);
    out.push({
      enroleeNumber: s.enroleeNumber,
      applicationStatus: s.applicationStatus ?? null,
      levelApplied: app?.levelApplied ?? null,
      howDidYouKnowAboutHFSEIS: app?.howDidYouKnowAboutHFSEIS ?? null,
      category: app?.category ?? null,
      nationality: app?.nationality ?? null,
    });
  }
  return out;
}

function loadFunnelRows(ayCode: string): Promise<JoinedFunnelRow[]> {
  return unstable_cache(
    () => loadFunnelRowsUncached(ayCode),
    // The suffix is a payload VERSION, not decoration. Adding a column to the
    // select above does not invalidate entries already cached under the old
    // key — they keep serving the old row shape until they expire, so the new
    // field reads as null everywhere while the row counts look perfectly
    // correct. Bump this whenever JoinedFunnelRow gains or loses a field.
    // (v2: added `nationality`, 2026-08-17.)
    ['admissions-funnel-v2', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['admissions-dashboard', `admissions-dashboard:${ayCode}`],
    }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Pure functions (exported for unit tests)
// ──────────────────────────────────────────────────────────────────────────

// Terminal statuses excluded from "applied" counts in conversion metrics.
const TERMINAL_STATUSES = new Set(['Cancelled', 'Withdrawn']);
const ENROLLED_STATUSES = new Set(['Enrolled', 'Enrolled (Conditional)']);

// ──────────────────────────────────────────────────────────────────────────
// Conversion by level
// ──────────────────────────────────────────────────────────────────────────

export type LevelConversionRow = {
  level: string;
  applied: number;
  enrolled: number;
  conversionPct: number; // 0-100
};

type SimpleRow = {
  levelApplied: string | null;
  statusLevel?: string | null;
  applicationStatus: string | null;
};

const CANONICAL_LEVELS = [
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
const CANONICAL_LEVEL_INDEX: Record<string, number> = Object.fromEntries(
  CANONICAL_LEVELS.map((l, i) => [l, i])
);

function compareLevels(a: string, b: string): number {
  if (a === 'Unknown' && b === 'Unknown') return 0;
  if (a === 'Unknown') return 1;
  if (b === 'Unknown') return -1;
  const ai = CANONICAL_LEVEL_INDEX[a];
  const bi = CANONICAL_LEVEL_INDEX[b];
  if (ai !== undefined && bi !== undefined) return ai - bi;
  if (ai !== undefined) return -1;
  if (bi !== undefined) return 1;
  return a.localeCompare(b);
}

/** Count applications and enrolments by level, excluding terminal statuses. */
export function computeConversionByLevel(
  rows: SimpleRow[]
): LevelConversionRow[] {
  const applied = new Map<string, number>();
  const enrolled = new Map<string, number>();

  for (const r of rows) {
    if (TERMINAL_STATUSES.has(r.applicationStatus ?? '')) continue;
    const raw = (r.statusLevel ?? r.levelApplied ?? '').trim();
    const level = raw || 'Unknown';

    applied.set(level, (applied.get(level) ?? 0) + 1);
    if (ENROLLED_STATUSES.has(r.applicationStatus ?? '')) {
      enrolled.set(level, (enrolled.get(level) ?? 0) + 1);
    }
  }

  const out: LevelConversionRow[] = Array.from(applied.entries()).map(
    ([level, app]) => {
      const enr = enrolled.get(level) ?? 0;
      return {
        level,
        applied: app,
        enrolled: enr,
        conversionPct: app > 0 ? Math.round((enr / app) * 100) : 0,
      };
    }
  );

  out.sort((a, b) => {
    // Sort by canonical level order, Unknown last.
    return compareLevels(a.level, b.level);
  });

  return out;
}

/**
 * Sort level-conversion rows worst-converter-first (ascending conversionPct)
 * so the Insights bar list reads scannable without needing the callout below
 * it. Stable on ties, so rows with equal conversionPct keep their input
 * order (canonical level order from `computeConversionByLevel`). Does not
 * mutate the input array.
 */
export function sortLevelsByConversionAsc(
  rows: LevelConversionRow[]
): LevelConversionRow[] {
  return [...rows].sort((a, b) => a.conversionPct - b.conversionPct);
}

// ──────────────────────────────────────────────────────────────────────────
// Withdrawn applications by level
// ──────────────────────────────────────────────────────────────────────────

export type LevelWithdrawnRow = {
  level: string;
  count: number;
};

type WithdrawnRow = {
  levelApplied: string | null;
  applicationStatus: string | null;
};

/**
 * Count WITHDRAWN applications per level — applicants who pulled out before
 * enrolling. Keyed on `applicationStatus === 'Withdrawn'` (populated 490/490
 * in prod), NOT `applicationTerminalReason` (unstamped in prod → hollow).
 *
 * Scope is deliberately pre-enrolment: on the admissions side, an enrolled
 * student who later leaves keeps `applicationStatus === 'Enrolled'` and only
 * flips `section_students.enrollment_status` (KD #150) — that's a Records
 * concern, not counted here. This is strictly "families who withdrew their
 * application."
 *
 * Distinct from `'Cancelled'` (a separate terminal status). Every withdrawn
 * applicant has exactly one level, so the output is a genuine partition of
 * the total-withdrawn count — the honest shape for a donut. Only levels with
 * ≥1 withdrawal appear; canonical level order (Unknown last).
 */
export function computeWithdrawnByLevel(
  rows: WithdrawnRow[]
): LevelWithdrawnRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.applicationStatus !== 'Withdrawn') continue;
    const level = (r.levelApplied ?? '').trim() || 'Unknown';
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => compareLevels(a.level, b.level));
}

// ──────────────────────────────────────────────────────────────────────────
// Referral conversion
// ──────────────────────────────────────────────────────────────────────────

export type ReferralConversionRow = {
  source: string;
  applied: number;
  enrolled: number;
  conversionPct: number;
};

type SimpleRow2 = {
  howDidYouKnowAboutHFSEIS: string | null;
  applicationStatus: string | null;
};

/** Count ALL applicants per referral source (not excluding terminal) for true
 *  conversion rate: "of everyone who heard via X, how many enrolled?" */
export function computeReferralConversion(
  rows: SimpleRow2[]
): ReferralConversionRow[] {
  const applied = new Map<string, number>();
  const enrolled = new Map<string, number>();

  for (const r of rows) {
    const raw = (r.howDidYouKnowAboutHFSEIS ?? '').trim();
    const source = raw || 'Not specified';

    applied.set(source, (applied.get(source) ?? 0) + 1);
    if (ENROLLED_STATUSES.has(r.applicationStatus ?? '')) {
      enrolled.set(source, (enrolled.get(source) ?? 0) + 1);
    }
  }

  const all: ReferralConversionRow[] = Array.from(applied.entries()).map(
    ([source, app]) => {
      const enr = enrolled.get(source) ?? 0;
      return {
        source,
        applied: app,
        enrolled: enr,
        conversionPct: app > 0 ? Math.round((enr / app) * 100) : 0,
      };
    }
  );

  all.sort((a, b) => b.applied - a.applied || a.source.localeCompare(b.source));

  // Cap at top 8; fold the rest into "Other".
  const TOP = 8;
  if (all.length <= TOP) return all;
  const top = all.slice(0, TOP);
  const rest = all.slice(TOP);
  const otherApplied = rest.reduce((s, r) => s + r.applied, 0);
  const otherEnrolled = rest.reduce((s, r) => s + r.enrolled, 0);
  top.push({
    source: 'Other',
    applied: otherApplied,
    enrolled: otherEnrolled,
    conversionPct:
      otherApplied > 0 ? Math.round((otherEnrolled / otherApplied) * 100) : 0,
  });
  return top;
}

// ──────────────────────────────────────────────────────────────────────────
// Category mix (New vs. Current vs. VizSchool variants)
// ──────────────────────────────────────────────────────────────────────────

export type CategoryMixRow = {
  category: string;
  count: number;
};

type CategoryRow = {
  category: string | null;
};

/**
 * Count ALL applications per enrolee category — deliberately NOT filtered by
 * applicationStatus (unlike computeConversionByLevel/computeReferralConversion's
 * "applied" counts, which still include cancelled/withdrawn but ARE paired
 * with an "enrolled" count for a rate). This is a pure demand-mix headcount:
 * "of everyone who applied, what's the New:Current split" — every row the
 * caller passes counts, full stop.
 *
 * All 4 real ENROLEE_CATEGORIES values always appear in the output, even at
 * count 0 — it's a fixed taxonomy the registrar expects to see every AY, not
 * a variable set like withdrawal reasons. A null, blank, or unrecognized
 * category value buckets into 'Unspecified', which is appended to the output
 * ONLY when its count is > 0 — a clean AY with every application correctly
 * categorized should never show a permanent empty 5th bar.
 */
export function computeCategoryMix(rows: CategoryRow[]): CategoryMixRow[] {
  const counts = new Map<string, number>(ENROLEE_CATEGORIES.map((c) => [c, 0]));
  let unspecified = 0;
  for (const r of rows) {
    const cat = (r.category ?? '').trim();
    if (cat && counts.has(cat)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } else {
      unspecified += 1;
    }
  }
  const out: CategoryMixRow[] = ENROLEE_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  if (unspecified > 0) {
    out.push({ category: 'Unspecified', count: unspecified });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Nationality mix
//
// `nationality` is `text null` with no CHECK and no FK. The strict
// country-name enum in lib/schemas/sis.ts binds only NEW SIS writes, and the
// field is PROFILE-gated, so untouched legacy rows keep whatever the parent
// portal stored. Everything below exists to stop that free text from
// silently splitting one country across two bars.
//
// MEASURED, NOT ASSUMED (probe run against production 2026-08-17, 1,557
// applications across AY2025/26/27 — scripts/probe-nationality-values.ts):
//   · zero blank values, and zero case/whitespace collisions;
//   · 23 / 18 / 10 distinct values per AY;
//   · exactly TWO values off COUNTRY_NAME_SET, both in AY2025 —
//     "Viet Nam" (3 rows) and "Sint Maarten (Dutch part)" (1 row).
//
// AY2025 holds BOTH "Viet Nam" (3) and "Vietnam" (1). Same country, two
// spellings, and without the alias below it draws as two separate bars —
// exactly the defect the probe was written to catch. "Sint Maarten (Dutch
// part)" is deliberately NOT aliased: it is a real place that `countries-list`
// simply names differently, and inventing a mapping for a single row would be
// guessing at the parent's meaning.
//
// Normalising is for GROUPING and display only. Nothing here is ever written
// back — this is the family's own data, not the school's to correct.
// ──────────────────────────────────────────────────────────────────────────

export type NationalityMixRow = {
  nationality: string;
  count: number;
  /**
   * Only on the folded 'Other' row: how many distinct nationalities it
   * stands for, so the UI can say "Other (12 nationalities)" instead of an
   * unexplained bar. `undefined` on every real row. KD #183 — a surface that
   * truncates must say so.
   */
  foldedCount?: number;
};

/** Spelling variants seen in production that `countries-list` names
 *  differently. Keyed lowercase; extend only from probe output, never from
 *  imagination. */
const NATIONALITY_ALIASES: Record<string, string> = {
  'viet nam': 'Vietnam',
};

/** lowercase country name → its canonical casing, built once. Catches future
 *  case variants ("philippines") that don't exist in the data today. */
const CANONICAL_BY_LOWER: Map<string, string> = new Map(
  Array.from(COUNTRY_NAME_SET, (name) => [name.toLowerCase(), name])
);

/**
 * Trim, collapse internal whitespace, apply a known alias, then snap to the
 * canonical country-name casing when we recognise it. An unrecognised value
 * is preserved exactly as the parent typed it — better a bar labelled with
 * their words than one silently dropped or renamed.
 *
 * Returns null for blank/null, which the caller buckets as 'Unspecified'.
 */
export function canonicaliseNationality(value: string | null): string | null {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const aliased = NATIONALITY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return CANONICAL_BY_LOWER.get(aliased.toLowerCase()) ?? aliased;
}

/**
 * Count applications per nationality, most common first.
 *
 * Unlike computeCategoryMix there is no fixed taxonomy to always render —
 * the domain is ~250 countries and only the ones present are meaningful, so
 * this returns a variable set rather than a stable one.
 *
 * Ordering is deliberate and load-bearing for reading: the top `limit` real
 * nationalities descending, then 'Other', then 'Unspecified'. The two
 * synthetic rows always sort last regardless of size — a large 'Unspecified'
 * bar sitting second would read as a nationality.
 */
export function computeNationalityMix(
  rows: { nationality: string | null }[],
  limit = 8
): NationalityMixRow[] {
  const counts = new Map<string, number>();
  let unspecified = 0;

  for (const r of rows) {
    const name = canonicaliseNationality(r.nationality);
    if (!name) {
      unspecified += 1;
      continue;
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const all = Array.from(counts.entries())
    .map(([nationality, count]) => ({ nationality, count }))
    .sort(
      (a, b) => b.count - a.count || a.nationality.localeCompare(b.nationality)
    );

  const out: NationalityMixRow[] = all.slice(0, Math.max(0, limit));
  const rest = all.slice(Math.max(0, limit));
  if (rest.length > 0) {
    out.push({
      nationality: 'Other',
      count: rest.reduce((s, r) => s + r.count, 0),
      foldedCount: rest.length,
    });
  }
  if (unspecified > 0) {
    out.push({ nationality: 'Unspecified', count: unspecified });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Nationality × level
//
// Is our diversity spread evenly, or does it sit in particular year groups?
// Lives here rather than in either page's own module so Admissions (by
// `levelApplied`) and Records (by the enrolled student's real section level)
// share one implementation and cannot drift apart.
//
// One shared legend across every level, and the top nationalities are chosen
// GLOBALLY, not per level — per-level top-N would silently relabel the
// segments from one bar to the next, so the same colour would mean different
// countries down the column.
// ──────────────────────────────────────────────────────────────────────────

export type NationalitySegment = { nationality: string; count: number };
export type NationalityLevelRow = {
  level: string;
  total: number;
  /** Ordered to match `legend`; omits nationalities absent from this level. */
  segments: NationalitySegment[];
};
export type NationalityByLevel = {
  legend: string[];
  rows: NationalityLevelRow[];
};

/**
 * Admissions' `levelApplied` is free text and drifts. Measured on production
 * 2026-08-17: AY2026 spells the same preschool programme four ways
 * ("Youngstarters | Little Stars" and "YoungStarter Little Star" among them),
 * and AY2025 leaves it blank on 79 of 822 rows.
 *
 * This folds the SPELLING variants together — casing, pluralisation and the
 * separator — and nothing else. It never merges two different year groups,
 * and an unrecognised value passes through untouched so a genuinely new level
 * shows up rather than hiding inside a bucket.
 *
 * Records does not need this: enrolled students take their level from the
 * managed `levels` table, which has exactly ten values and no drift.
 */
export function canonicaliseLevelApplied(raw: string | null): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Not specified';
  const flat = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (flat.startsWith('youngstarter')) {
    if (flat.includes('little')) return 'Youngstarters | Little Stars';
    if (flat.includes('junior')) return 'Youngstarters | Junior Stars';
    if (flat.includes('senior')) return 'Youngstarters | Senior Stars';
    return 'Youngstarters';
  }
  return trimmed;
}

export function computeNationalityByLevel(
  rows: { level: string | null; nationality: string | null }[],
  limit = 6
): NationalityByLevel {
  // Canonicalise once, up front, so the global ranking and the per-level
  // buckets can never disagree about what a country is called.
  const normalised = rows.map((r) => ({
    level: (r.level ?? '').trim() || 'Unknown',
    nationality: canonicaliseNationality(r.nationality),
  }));

  const globalCounts = new Map<string, number>();
  for (const r of normalised) {
    if (!r.nationality) continue;
    globalCounts.set(r.nationality, (globalCounts.get(r.nationality) ?? 0) + 1);
  }
  const ranked = [...globalCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  const top = new Set(ranked.slice(0, Math.max(0, limit)));

  const byLevel = new Map<string, Map<string, number>>();
  let sawOther = false;
  let sawUnspecified = false;
  for (const r of normalised) {
    const bucket = !r.nationality
      ? 'Unspecified'
      : top.has(r.nationality)
        ? r.nationality
        : 'Other';
    if (bucket === 'Other') sawOther = true;
    if (bucket === 'Unspecified') sawUnspecified = true;
    const level = byLevel.get(r.level) ?? new Map<string, number>();
    level.set(bucket, (level.get(bucket) ?? 0) + 1);
    byLevel.set(r.level, level);
  }

  const legend = [
    ...ranked.slice(0, Math.max(0, limit)),
    ...(sawOther ? ['Other'] : []),
    ...(sawUnspecified ? ['Unspecified'] : []),
  ];

  const out: NationalityLevelRow[] = [...byLevel.entries()]
    .map(([level, counts]) => ({
      level,
      total: [...counts.values()].reduce((s, c) => s + c, 0),
      segments: legend
        .filter((name) => (counts.get(name) ?? 0) > 0)
        .map((nationality) => ({
          nationality,
          count: counts.get(nationality) ?? 0,
        })),
    }))
    .sort((a, b) => compareLevelLabels(a.level, b.level));

  return { legend, rows: out };
}

// ──────────────────────────────────────────────────────────────────────────
// Cached public API
// ──────────────────────────────────────────────────────────────────────────

export async function getConversionByLevel(
  ayCode: string
): Promise<LevelConversionRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeConversionByLevel(
    rows.map((r) => ({
      levelApplied: r.levelApplied,
      statusLevel: null, // not available in this loader; levelApplied is the best we have
      applicationStatus: r.applicationStatus,
    }))
  );
}

export async function getWithdrawnByLevel(
  ayCode: string
): Promise<LevelWithdrawnRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeWithdrawnByLevel(
    rows.map((r) => ({
      levelApplied: r.levelApplied,
      applicationStatus: r.applicationStatus,
    }))
  );
}

export async function getReferralConversion(
  ayCode: string
): Promise<ReferralConversionRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeReferralConversion(rows);
}

export async function getCategoryMix(
  ayCode: string
): Promise<CategoryMixRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeCategoryMix(rows.map((r) => ({ category: r.category })));
}

export async function getNationalityMix(
  ayCode: string
): Promise<NationalityMixRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeNationalityMix(
    rows.map((r) => ({ nationality: r.nationality }))
  );
}

export async function getApplicantNationalityByLevel(
  ayCode: string
): Promise<NationalityByLevel> {
  const rows = await loadFunnelRows(ayCode);
  return computeNationalityByLevel(
    rows.map((r) => ({
      level: canonicaliseLevelApplied(r.levelApplied),
      nationality: r.nationality,
    }))
  );
}

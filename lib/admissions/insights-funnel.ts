import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { compareLevelLabels } from '@/lib/sis/levels';
import {
  canonicaliseLevelApplied,
  canonicaliseNationality,
  categoryMixKey,
  isEnrolledApplication,
  isWithdrawnApplication,
  levelAsAppliedKey,
  NATIONALITY_BY_LEVEL_LIMIT,
  NATIONALITY_MIX_LIMIT,
  rankKeys,
  REFERRAL_TOP_COUNT,
  referralSourceKey,
  UNSPECIFIED_CATEGORY,
} from '@/lib/admissions/insights-predicates';

// Moved to the client-safe predicates module (KD #229); re-exported so every
// existing import of these from here keeps working.
export { canonicaliseLevelApplied, canonicaliseNationality };

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

export type StatusFunnelRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
};

export type AppFunnelRow = {
  enroleeNumber: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
  nationality: string | null;
};

export type JoinedFunnelRow = {
  enroleeNumber: string;
  applicationStatus: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
  nationality: string | null;
};

/**
 * Application-first join — the same join the drill row set uses
 * (lib/admissions/drill.ts loadDrillRowsUncached): one row per application
 * with an applicant number, its LAST status row, nothing for a status row
 * with no application. Until KD #229 this loader iterated status rows, so an
 * orphan status row was counted and a duplicated one counted twice — numbers
 * no drill could list. Pure — exported for unit tests.
 */
export function joinFunnelRows(
  statusRows: StatusFunnelRow[],
  appRows: AppFunnelRow[]
): JoinedFunnelRow[] {
  const statusByEnrolee = new Map<string, StatusFunnelRow>();
  for (const s of statusRows) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }
  const out: JoinedFunnelRow[] = [];
  for (const a of appRows) {
    if (!a.enroleeNumber) continue;
    const s = statusByEnrolee.get(a.enroleeNumber);
    out.push({
      enroleeNumber: a.enroleeNumber,
      applicationStatus: s?.applicationStatus ?? null,
      levelApplied: a.levelApplied ?? null,
      howDidYouKnowAboutHFSEIS: a.howDidYouKnowAboutHFSEIS ?? null,
      category: a.category ?? null,
      nationality: a.nationality ?? null,
    });
  }
  return out;
}

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

  return joinFunnelRows(statusRows, appRows);
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
    // (v3: application-first join, KD #229, 2026-09-29.)
    ['admissions-funnel-v3', ayCode],
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
 * Since KD #220 this ALSO counts children who enrolled and later left (a
 * Records withdrawal now sets applicationStatus to Withdrawn). Pre-KD #220:
 * scope was deliberately pre-enrolment: on the admissions side, an enrolled
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
    if (!isWithdrawnApplication(r.applicationStatus)) continue;
    const level = levelAsAppliedKey(r.levelApplied);
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
  /** Only on the folded 'Other' row — the sources past the top eight. Lets
   *  the drill tell it from a source a parent literally named "Other". */
  folded?: true;
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
  const enrolled = new Map<string, number>();
  const keys: string[] = [];
  for (const r of rows) {
    const source = referralSourceKey(r.howDidYouKnowAboutHFSEIS);
    keys.push(source);
    if (isEnrolledApplication(r.applicationStatus)) {
      enrolled.set(source, (enrolled.get(source) ?? 0) + 1);
    }
  }

  // Shared ranking (count desc, then name) — the `referral-all` drill folds
  // with the same order, so its overflow is exactly this Other row.
  const all: ReferralConversionRow[] = rankKeys(keys).map(
    ({ key: source, count: app }) => {
      const enr = enrolled.get(source) ?? 0;
      return {
        source,
        applied: app,
        enrolled: enr,
        conversionPct: app > 0 ? Math.round((enr / app) * 100) : 0,
      };
    }
  );

  if (all.length <= REFERRAL_TOP_COUNT) return all;
  const top = all.slice(0, REFERRAL_TOP_COUNT);
  const rest = all.slice(REFERRAL_TOP_COUNT);
  const otherApplied = rest.reduce((s, r) => s + r.applied, 0);
  const otherEnrolled = rest.reduce((s, r) => s + r.enrolled, 0);
  top.push({
    source: 'Other',
    applied: otherApplied,
    enrolled: otherEnrolled,
    conversionPct:
      otherApplied > 0 ? Math.round((otherEnrolled / otherApplied) * 100) : 0,
    folded: true,
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
    const key = categoryMixKey(r.category);
    if (key === UNSPECIFIED_CATEGORY) {
      unspecified += 1;
    } else {
      counts.set(key, (counts.get(key) ?? 0) + 1);
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
  limit = NATIONALITY_MIX_LIMIT
): NationalityMixRow[] {
  const names: string[] = [];
  let unspecified = 0;

  for (const r of rows) {
    const name = canonicaliseNationality(r.nationality);
    if (!name) {
      unspecified += 1;
      continue;
    }
    names.push(name);
  }

  // Shared ranking (count desc, then name) — nationalityBucketer folds with
  // the same order, so the `nationality` drill's Other is this Other.
  const all = rankKeys(names).map(({ key, count }) => ({
    nationality: key,
    count,
  }));

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

export function computeNationalityByLevel(
  rows: { level: string | null; nationality: string | null }[],
  limit = NATIONALITY_BY_LEVEL_LIMIT
): NationalityByLevel {
  // Canonicalise once, up front, so the global ranking and the per-level
  // buckets can never disagree about what a country is called.
  const normalised = rows.map((r) => ({
    level: (r.level ?? '').trim() || 'Unknown',
    nationality: canonicaliseNationality(r.nationality),
  }));

  const ranked = rankKeys(
    normalised.flatMap((r) => (r.nationality ? [r.nationality] : []))
  ).map((r) => r.key);
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

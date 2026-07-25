import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';

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
};

type JoinedFunnelRow = {
  enroleeNumber: string;
  applicationStatus: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
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
              'enroleeNumber, levelApplied, howDidYouKnowAboutHFSEIS, category'
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
    });
  }
  return out;
}

function loadFunnelRows(ayCode: string): Promise<JoinedFunnelRow[]> {
  return unstable_cache(
    () => loadFunnelRowsUncached(ayCode),
    ['admissions-funnel', ayCode],
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

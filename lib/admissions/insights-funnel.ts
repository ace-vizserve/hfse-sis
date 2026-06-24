import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { STAGE_COLUMN_MAP, STAGE_LABELS } from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Deep funnel + conversion breakdowns for the Admissions Insights page.
//
// This module provides a PARALLEL loader that fetches stage-date columns +
// enroleeType from the status table (not available on dashboard.ts's
// loadJoinedRows). It does NOT modify dashboard.ts.
//
// Cache tag: `admissions-dashboard:${ayCode}` — same invalidation as the
// operational dashboard so any write that flushes admissions data also
// refreshes these.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 60;

// The 6 deep-funnel stages we display (registration → class assignment).
// Excludes application (= total pool), supplies + orientation (post-enrolment,
// no meaningful drop-off to show).
export const DEEP_FUNNEL_STAGE_KEYS = [
  'registration',
  'documents',
  'assessment',
  'contract',
  'fees',
  'class',
] as const;

export type DeepFunnelStageKey = (typeof DEEP_FUNNEL_STAGE_KEYS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Internal row shapes fetched from the DB
// ──────────────────────────────────────────────────────────────────────────

type StatusFunnelRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
  enroleeType: string | null;
  // Stage date columns — null means the applicant has NOT reached that stage.
  // Column names come directly from STAGE_COLUMN_MAP[key].updatedDateCol.
  registrationUpdateDate: string | null;
  documentUpdatedDate: string | null;
  assessmentUpdatedDate: string | null;
  contractUpdatedDate: string | null;
  feeUpdatedDate: string | null;
  classUpdatedDate: string | null;
};

type AppFunnelRow = {
  enroleeNumber: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
};

type JoinedFunnelRow = {
  enroleeNumber: string;
  applicationStatus: string | null;
  enroleeType: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  /** Which deep-funnel stages this row reached (non-null stage date). Array,
   *  not a Set — this crosses the unstable_cache JSON boundary (a Set
   *  serializes to {} and loses .has). */
  reachedStages: DeepFunnelStageKey[];
};

// Map each deep-funnel stage key to its actual DB column name.
const STAGE_DATE_COL: Record<DeepFunnelStageKey, keyof StatusFunnelRow> = {
  registration: 'registrationUpdateDate',
  documents: 'documentUpdatedDate',
  assessment: 'assessmentUpdatedDate',
  contract: 'contractUpdatedDate',
  fees: 'feeUpdatedDate',
  class: 'classUpdatedDate',
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
            .select(
              // Exact production column names from STAGE_COLUMN_MAP + DDL.
              // registrationUpdateDate — note: no "d" in "Updated" (production quirk).
              [
                'enroleeNumber',
                'applicationStatus',
                'enroleeType',
                STAGE_DATE_COL.registration,
                STAGE_DATE_COL.documents,
                STAGE_DATE_COL.assessment,
                STAGE_DATE_COL.contract,
                STAGE_DATE_COL.fees,
                STAGE_DATE_COL.class,
              ].join(', ')
            )
            .range(from, to) as unknown as P<StatusFunnelRow>
      ),
      fetchAllPages<AppFunnelRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_applications`)
            .select('enroleeNumber, levelApplied, howDidYouKnowAboutHFSEIS')
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

    const reachedStages: DeepFunnelStageKey[] = [];
    for (const key of DEEP_FUNNEL_STAGE_KEYS) {
      const col = STAGE_DATE_COL[key];
      if (s[col] !== null && s[col] !== undefined) {
        reachedStages.push(key);
      }
    }

    out.push({
      enroleeNumber: s.enroleeNumber,
      applicationStatus: s.applicationStatus ?? null,
      enroleeType: s.enroleeType ?? null,
      levelApplied: app?.levelApplied ?? null,
      howDidYouKnowAboutHFSEIS: app?.howDidYouKnowAboutHFSEIS ?? null,
      reachedStages,
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

export type DeepFunnelStage = {
  key: string;
  label: string;
  count: number;
  dropOffFromPrev: number; // absolute drop from previous
  dropOffPct: number; // % of previous stage that didn't reach this one
  isBiggestLeak: boolean;
};

/**
 * Build the deep funnel from a pre-computed stage count map.
 *
 * @param stageCounts  Map of stage key → # of rows that reached it.
 * @param totalPool    The total number of applications (all statuses).
 * @param stageKeys    Ordered stage keys to display (registration → class).
 */
export function buildDeepFunnel(
  stageCounts: Map<string, number>,
  totalPool: number,
  stageKeys: readonly string[]
): DeepFunnelStage[] {
  if (stageKeys.length === 0 || totalPool === 0) return [];

  const stages: Array<{ key: string; label: string; count: number }> = [
    { key: 'pool', label: 'Applications', count: totalPool },
    ...stageKeys.map((k) => ({
      key: k,
      label:
        (STAGE_LABELS as Record<string, string>)[k] ??
        k.charAt(0).toUpperCase() + k.slice(1),
      count: stageCounts.get(k) ?? 0,
    })),
  ];

  // First pass: compute dropOff for each displayed stage (skip the pool row).
  const withDrop = stages.slice(1).map((stage, i) => {
    const prevCount = stages[i].count; // stages[i] is the item before (pool or prior stage)
    const dropOff = Math.max(0, prevCount - stage.count);
    const dropOffPct =
      prevCount > 0 ? Math.round((dropOff / prevCount) * 100) : 0;
    return {
      key: stage.key,
      label: stage.label,
      count: stage.count,
      dropOffFromPrev: dropOff,
      dropOffPct,
      isBiggestLeak: false,
    };
  });

  // Second pass: mark the single biggest leak.
  let maxPct = 0;
  let maxIdx = -1;
  for (let i = 0; i < withDrop.length; i++) {
    if (withDrop[i].dropOffPct > maxPct) {
      maxPct = withDrop[i].dropOffPct;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0 && maxPct > 0) {
    withDrop[maxIdx] = { ...withDrop[maxIdx], isBiggestLeak: true };
  }

  return withDrop;
}

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
// Enrolee type conversion (New vs Current vs VizSchool)
// ──────────────────────────────────────────────────────────────────────────

export type EnroleeTypeRow = {
  type: string;
  applied: number;
  enrolled: number;
  conversionPct: number;
};

type SimpleRow3 = {
  enroleeType: string | null;
  applicationStatus: string | null;
};

const ENROLEE_TYPE_ORDER = [
  'New',
  'Current',
  'VizSchool New',
  'VizSchool Current',
];

/** Count applications and enrolments by enroleeType, excluding terminal statuses. */
export function computeEnroleeTypeConversion(
  rows: SimpleRow3[]
): EnroleeTypeRow[] {
  const applied = new Map<string, number>();
  const enrolled = new Map<string, number>();

  for (const r of rows) {
    if (TERMINAL_STATUSES.has(r.applicationStatus ?? '')) continue;
    const type = (r.enroleeType ?? '').trim() || 'Unspecified';

    applied.set(type, (applied.get(type) ?? 0) + 1);
    if (ENROLLED_STATUSES.has(r.applicationStatus ?? '')) {
      enrolled.set(type, (enrolled.get(type) ?? 0) + 1);
    }
  }

  const out: EnroleeTypeRow[] = Array.from(applied.entries()).map(
    ([type, app]) => {
      const enr = enrolled.get(type) ?? 0;
      return {
        type,
        applied: app,
        enrolled: enr,
        conversionPct: app > 0 ? Math.round((enr / app) * 100) : 0,
      };
    }
  );

  // Sort by canonical order, then alphabetically for unknowns.
  out.sort((a, b) => {
    const ai = ENROLEE_TYPE_ORDER.indexOf(a.type);
    const bi = ENROLEE_TYPE_ORDER.indexOf(b.type);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.type.localeCompare(b.type);
  });

  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Cached public API
// ──────────────────────────────────────────────────────────────────────────

export type DeepFunnelStats = {
  stages: DeepFunnelStage[];
  totalPool: number;
};

export async function getDeepFunnelStats(
  ayCode: string
): Promise<DeepFunnelStats> {
  const rows = await loadFunnelRows(ayCode);
  const totalPool = rows.length;

  // Count rows that reached each stage (have a non-null stage date).
  const stageCounts = new Map<string, number>();
  for (const key of DEEP_FUNNEL_STAGE_KEYS) {
    const count = rows.filter((r) => r.reachedStages.includes(key)).length;
    stageCounts.set(key, count);
  }

  const stages = buildDeepFunnel(
    stageCounts,
    totalPool,
    DEEP_FUNNEL_STAGE_KEYS
  );
  return { stages, totalPool };
}

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

export async function getReferralConversion(
  ayCode: string
): Promise<ReferralConversionRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeReferralConversion(rows);
}

export async function getEnroleeTypeConversion(
  ayCode: string
): Promise<EnroleeTypeRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeEnroleeTypeConversion(rows);
}

// Verify STAGE_COLUMN_MAP wiring is consistent (dev-time check).
// This will surface a type error at import if the column map changes.
const _stageDateColCheck: Record<DeepFunnelStageKey, string> = {
  registration: STAGE_COLUMN_MAP.registration.updatedDateCol,
  documents: STAGE_COLUMN_MAP.documents.updatedDateCol,
  assessment: STAGE_COLUMN_MAP.assessment.updatedDateCol,
  contract: STAGE_COLUMN_MAP.contract.updatedDateCol,
  fees: STAGE_COLUMN_MAP.fees.updatedDateCol,
  class: STAGE_COLUMN_MAP.class.updatedDateCol,
};
void _stageDateColCheck;

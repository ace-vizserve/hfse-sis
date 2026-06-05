import { unstable_cache } from 'next/cache';

import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';
import { prefixFor } from '@/lib/admissions/_shared';
import {
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  type StageKey,
} from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Drill-down primitives shared across every Admissions drill target.
//
// One unified `DrillRow` shape powers all 12 drill surfaces. Each target
// pre-filters the row set; the same shape is sent to the client component
// (which then filters/sorts/groups locally without further network calls).
//
// CSV export delegates to the same helpers, so the downloaded file matches
// what the user sees on screen.

const CACHE_TTL_SECONDS = 60;

function tags(ayCode: string): string[] {
  return ['admissions-drill', `admissions-drill:${ayCode}`];
}

// ---------------------------------------------------------------------------
// Types

export type DrillTarget =
  | 'applications'
  | 'enrolled'
  | 'conversion'
  | 'avg-time'
  | 'funnel-stage'
  | 'pipeline-stage'
  | 'referral'
  | 'assessment'
  | 'time-to-enroll-bucket'
  | 'applications-by-level'
  | 'doc-completion'
  | 'outdated';

export type DrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  status: string;
  level: string | null;
  stage: string | null;
  /**
   * Pipeline stage label derived from the rightmost-set `*UpdatedDate`
   * column on the status row — matches the bucket the
   * `getPipelineStageBreakdown` chart computes. The drill filter for
   * `pipeline-stage` uses this so segment clicks (e.g. "Assessment") align
   * with chart segments instead of relying on `applicationStatus` (which
   * the chart doesn't read).
   */
  pipelineStage: string;
  referralSource: string | null;
  assessmentMath: string | null;
  assessmentEnglish: string | null;
  assessmentMathOutcome: 'pass' | 'fail' | 'unknown';
  assessmentEnglishOutcome: 'pass' | 'fail' | 'unknown';
  assessmentOutcome: string | null; // pass | fail | unknown (combined)
  applicationDate: string | null; // ISO
  enrollmentDate: string | null; // ISO
  daysToEnroll: number | null;
  daysSinceUpdate: number | null;
  daysInPipeline: number;
  hasMissingDocs: boolean;
  documentsComplete: number; // count of present core docs
  documentsTotal: number; // count of core doc slots tracked
};

export type DrillRangeInput = {
  ayCode: string;
  /** When set, clamp by these dates. Both must be present. */
  from?: string;
  to?: string;
};

// ---------------------------------------------------------------------------
// Stage derivation
//
// Pipeline stage = rightmost timestamped step the application has reached.
// Mirrors the SIS records-tab stage logic but adapted for admissions. Status
// is the source of truth; stage is a UI grouping.

function deriveStage(status: string | null): string {
  const s = (status ?? '').trim();
  if (!s) return 'No status';
  return s;
}

function classifyAssessmentValue(
  raw: string | number | null
): 'pass' | 'fail' | 'unknown' {
  if (raw === null || raw === undefined) return 'unknown';
  if (typeof raw === 'number') return raw >= 60 ? 'pass' : 'fail';
  const s = String(raw).trim();
  if (!s) return 'unknown';
  const n = Number(s);
  if (!Number.isNaN(n)) return n >= 60 ? 'pass' : 'fail';
  const letter = s.toUpperCase()[0];
  if (['A', 'B', 'C'].includes(letter)) return 'pass';
  if (['D', 'F'].includes(letter)) return 'fail';
  return 'unknown';
}

function combinedAssessmentOutcome(
  math: string | number | null,
  eng: string | number | null
): 'pass' | 'fail' | 'unknown' {
  const m = classifyAssessmentValue(math);
  const e = classifyAssessmentValue(eng);
  if (m === 'unknown' && e === 'unknown') return 'unknown';
  if (m === 'fail' || e === 'fail') return 'fail';
  if (m === 'pass' && e === 'pass') return 'pass';
  // mixed pass/unknown — we surface as the better-known signal: pass if any
  // pass and no fail, otherwise unknown.
  if (m === 'pass' || e === 'pass') return 'pass';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Server-side fetch

const CORE_DOC_STATUS_COLUMNS = [
  'medicalStatus',
  'passportStatus',
  'birthCertStatus',
  'educCertStatus',
  'idPictureStatus',
] as const;

type DocRow = Record<
  (typeof CORE_DOC_STATUS_COLUMNS)[number] | 'enroleeNumber',
  string | null
>;

async function loadDrillRowsUncached(input: {
  ayCode: string;
}): Promise<DrillRow[]> {
  // Core rows fetch — no docs. Doc enrichment is layered on top via
  // `enrichWithDocs` for the targets that need it. Of 12 drill targets, only
  // 5 surface doc fields (applications, enrolled, outdated, doc-completion,
  // applications-by-level), so we skip the docs query for the rest.
  const prefix = prefixFor(input.ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  const supabase = createAdmissionsClient();

  type AppLite = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
    levelApplied: string | null;
    created_at: string | null;
    howDidYouKnowAboutHFSEIS: string | null;
  };
  type StatusLite = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    applicationUpdatedDate: string | null;
    classLevel: string | null;
    levelApplied: string | null;
    assessmentGradeMath: string | number | null;
    assessmentGradeEnglish: string | number | null;
  } & Record<string, string | null | number>;

  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;

  const statusCols = [
    'enroleeNumber',
    'applicationStatus',
    'applicationUpdatedDate',
    'classLevel',
    'levelApplied',
    'assessmentGradeMath',
    'assessmentGradeEnglish',
    ...STAGE_KEYS.map((k) => STAGE_COLUMN_MAP[k].updatedDateCol),
  ].join(', ');

  let apps: AppLite[];
  let statuses: StatusLite[];
  try {
    [apps, statuses] = await Promise.all([
      fetchAllPages<AppLite>(
        (from, to) =>
          supabase
            .from(appsTable)
            .select(
              'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at, howDidYouKnowAboutHFSEIS'
            )
            .range(from, to) as unknown as P<AppLite>
      ),
      // Cast via unknown — the dynamic SELECT (joined with per-stage updatedDate
      // columns) defeats supabase-js's row-shape inference.
      fetchAllPages<StatusLite>(
        (from, to) =>
          supabase
            .from(statusTable)
            .select(statusCols)
            .range(from, to) as unknown as P<StatusLite>
      ),
    ]);
  } catch (err) {
    console.error('[admissions-drill] fetch failed:', err);
    return [];
  }

  // Compute the pipeline stage label the same way `loadPipelineStageBreakdown`
  // does: rightmost stage in `STAGE_KEYS` whose `*UpdatedDate` is non-null.
  // No stages touched → 'Not started'. The chart and the drill must agree
  // on this value or segment clicks miss every row.
  function derivePipelineStage(s: StatusLite | undefined): string {
    if (!s) return 'Not started';
    let current: StageKey | null = null;
    for (const k of STAGE_KEYS) {
      const col = STAGE_COLUMN_MAP[k].updatedDateCol;
      if (s[col]) current = k;
    }
    return current ? STAGE_LABELS[current] : 'Not started';
  }

  const statusByEnrolee = new Map<string, StatusLite>();
  for (const s of statuses) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }

  const today = Date.now();
  const ENROLLED_STATUSES = new Set(['Enrolled', 'Enrolled (Conditional)']);
  const documentsTotal = CORE_DOC_STATUS_COLUMNS.length;

  const out: DrillRow[] = [];
  for (const a of apps) {
    if (!a.enroleeNumber) continue;
    const s = statusByEnrolee.get(a.enroleeNumber);

    const status = (s?.applicationStatus ?? '').trim();
    const updated = s?.applicationUpdatedDate ?? a.created_at ?? null;

    const createdMs = a.created_at ? Date.parse(a.created_at) : NaN;
    const updatedMs = updated ? Date.parse(updated) : NaN;

    const isEnrolled = ENROLLED_STATUSES.has(status);
    const enrollmentDate = isEnrolled ? updated : null;

    const daysToEnroll =
      isEnrolled &&
      !Number.isNaN(createdMs) &&
      !Number.isNaN(updatedMs) &&
      updatedMs >= createdMs
        ? Math.round((updatedMs - createdMs) / 86_400_000)
        : null;
    const daysSinceUpdate = !Number.isNaN(updatedMs)
      ? Math.floor((today - updatedMs) / 86_400_000)
      : null;
    const daysInPipeline = !Number.isNaN(createdMs)
      ? Math.floor((today - createdMs) / 86_400_000)
      : 0;

    out.push({
      enroleeNumber: a.enroleeNumber,
      studentNumber: a.studentNumber,
      fullName:
        (a.enroleeFullName ?? '').trim() ||
        `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() ||
        a.enroleeNumber,
      status: status || 'No status',
      // Level resolver mirrors the chart's `bucketByLevel` (see
      // dashboard.ts → resolveLevel): prefer status.classLevel, then
      // status.levelApplied, then apps.levelApplied; blank → 'Unknown'
      // (NOT null). Without the same precedence + Unknown fallback the
      // chart and drill key on different values and segment-clicks miss
      // every row whose source columns disagree (Investigation #1).
      level:
        (
          (s?.classLevel ?? s?.levelApplied ?? a.levelApplied ?? '') as string
        ).trim() || 'Unknown',
      stage: deriveStage(status),
      pipelineStage: derivePipelineStage(s),
      referralSource: (a.howDidYouKnowAboutHFSEIS ?? '').trim() || null,
      assessmentMath:
        s?.assessmentGradeMath != null ? String(s.assessmentGradeMath) : null,
      assessmentEnglish:
        s?.assessmentGradeEnglish != null
          ? String(s.assessmentGradeEnglish)
          : null,
      assessmentMathOutcome: classifyAssessmentValue(
        s?.assessmentGradeMath ?? null
      ),
      assessmentEnglishOutcome: classifyAssessmentValue(
        s?.assessmentGradeEnglish ?? null
      ),
      assessmentOutcome: combinedAssessmentOutcome(
        s?.assessmentGradeMath ?? null,
        s?.assessmentGradeEnglish ?? null
      ),
      applicationDate: a.created_at,
      enrollmentDate,
      daysToEnroll,
      daysSinceUpdate,
      daysInPipeline,
      // Doc fields default to all-missing; enrichWithDocs() upgrades them
      // for callers that need doc data.
      hasMissingDocs: true,
      documentsComplete: 0,
      documentsTotal,
    });
  }
  return out;
}

/**
 * Layers doc-completeness fields onto rows fetched by
 * loadDrillRowsUncached. Called only by callers that need the doc fields
 * (5 of 12 drill targets); other callers use the cheaper bare row set.
 */
async function enrichWithDocs(
  rows: DrillRow[],
  ayCode: string
): Promise<DrillRow[]> {
  if (rows.length === 0) return rows;
  const prefix = prefixFor(ayCode);
  const docsTable = `${prefix}_enrolment_documents`;
  const supabase = createAdmissionsClient();
  const { data, error } = await supabase
    .from(docsTable)
    .select(`enroleeNumber, ${CORE_DOC_STATUS_COLUMNS.join(', ')}`);
  if (error) {
    console.warn(
      '[admissions-drill] docs fetch failed (non-fatal):',
      error.message
    );
    return rows;
  }
  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of (data ?? []) as unknown as DocRow[]) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }
  return rows.map((r) => {
    const d = docsByEnrolee.get(r.enroleeNumber);
    if (!d) return r;
    let documentsComplete = 0;
    for (const col of CORE_DOC_STATUS_COLUMNS) {
      const v = d[col];
      if (
        v &&
        String(v).trim() !== '' &&
        String(v).toLowerCase() !== 'missing'
      ) {
        documentsComplete += 1;
      }
    }
    return {
      ...r,
      documentsComplete,
      hasMissingDocs: documentsComplete < r.documentsTotal,
    };
  });
}

function applyScopeFilter(
  rows: DrillRow[],
  input: DrillRangeInput,
  target?: DrillTarget
): DrillRow[] {
  // Different drill targets anchor the date range to different timestamps
  // — pick the anchor that matches the chart whose segment was clicked.
  //
  //   - 'enrolled' / 'avg-time': applicationDate (created_at). The KPI cards
  //     are app-anchored — both the enrolled COUNT and the avg-time sample
  //     set scope on created_at (applications received in range that are now
  //     enrolled), so conversion % stays bounded 0–100%. The drill must use
  //     the SAME anchor or the card count won't match the drill row count.
  //   - 'time-to-enroll-bucket': AY-wide (no date filter) — the chart's
  //     histogram is computed over the whole AY's enrolled cohort.
  //   - everything else: applicationDate (the canonical "which applications
  //     entered the funnel in this window" anchor).
  //
  // Without these per-target overrides the chart would show non-zero
  // counts but the drill would open empty when no row's applicationDate
  // happens to land in the picker window even though the chart's anchor
  // does.
  if (target === 'time-to-enroll-bucket') {
    // Chart is AY-wide. Drill mirrors that.
    return rows;
  }
  return applyDateRangeFilter(rows, input, (r) => r.applicationDate, {
    caller: 'admissions/drill',
    includeMissingDate: false,
  });
}

export async function buildDrillRows(
  input: DrillRangeInput,
  options?: { withDocs?: boolean; target?: DrillTarget }
): Promise<DrillRow[]> {
  // Cache the AY-wide row set once per AY; apply range filtering post-cache.
  // Cheap because applyScopeFilter is a single .filter() over the cached
  // array. We deliberately do NOT include from/to in the cache key — they
  // would fragment the cache without saving any DB work (the underlying
  // tables are the same regardless of date range).
  //
  // The cached row set has placeholder doc fields. Callers that need
  // doc-completeness data pass `withDocs: true` and get the docs table
  // queried + layered on. The 7 of 12 targets that don't surface doc
  // fields skip that query entirely.
  const cached = await unstable_cache(
    () => loadDrillRowsUncached({ ayCode: input.ayCode }),
    ['admissions-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) }
  )();
  const scoped = applyScopeFilter(cached, input, options?.target);
  return options?.withDocs ? enrichWithDocs(scoped, input.ayCode) : scoped;
}

// ---------------------------------------------------------------------------
// Per-target filter — narrows the unified row set to the rows the user
// expected to see when they clicked the surface.

// Practical-rule scope: when an admissions surface clicks into "applications",
// "applicants with missing docs", or any in-flight chase queue, the user
// expects to see funnel rows only — Enrolled and Enrolled (Conditional)
// belong to Records, Cancelled / Withdrawn live on the dedicated closed list.
// Analytical targets (conversion / time-to-enroll / referral / assessment /
// funnel-stage) intentionally return the full pipeline because the metrics
// they compute require seeing enrolled outcomes.
const ACTIVE_FUNNEL_STATUSES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

export function applyTargetFilter(
  rows: DrillRow[],
  target: DrillTarget,
  segment?: string | null
): DrillRow[] {
  switch (target) {
    case 'applications':
      // Time-based target: matches the card aggregator (rows where
      // applicationDate is in the range, regardless of current status —
      // a row submitted in January and enrolled in March still counts as
      // a January application). Funnel-only filtering would hide rows
      // that have since progressed to Enrolled / Cancelled / Withdrawn.
      // Funnel-shape targets (`pipeline-stage`, `doc-completion`, chase)
      // still narrow to ACTIVE_FUNNEL_STATUSES below.
      return rows;
    case 'enrolled':
      return rows.filter(
        (r) => r.status === 'Enrolled' || r.status === 'Enrolled (Conditional)'
      );
    case 'conversion':
      return rows;
    case 'avg-time':
      return rows.filter((r) => r.daysToEnroll !== null);
    case 'funnel-stage': {
      // Cumulative funnel — every later stage row counts toward earlier stages.
      const stages = [
        'Submitted',
        'Ongoing Verification',
        'Processing',
        'Enrolled',
      ];
      const idx = stages.indexOf(segment ?? '');
      if (idx === -1) return rows;
      const ENROLLED = ['Enrolled', 'Enrolled (Conditional)'];
      return rows.filter((r) => {
        if (segment === 'Submitted') {
          return r.status !== 'Cancelled' && r.status !== 'Withdrawn';
        }
        if (segment === 'Ongoing Verification') {
          return ['Ongoing Verification', 'Processing', ...ENROLLED].includes(
            r.status
          );
        }
        if (segment === 'Processing') {
          return ['Processing', ...ENROLLED].includes(r.status);
        }
        if (segment === 'Enrolled') {
          return ENROLLED.includes(r.status);
        }
        return true;
      });
    }
    case 'pipeline-stage':
      if (!segment) return rows;
      // The chart's segments are STAGE_LABELS values (e.g. "Assessment",
      // "Documents") plus "Not started". Filter on the derived
      // `pipelineStage` so the drill matches the chart bucket exactly.
      // Legacy fallback to `r.status === segment` preserved in case any
      // caller still passes an applicationStatus value.
      return rows.filter(
        (r) => r.pipelineStage === segment || r.status === segment
      );
    case 'referral':
      if (!segment) return rows;
      if (segment === 'Not specified') {
        return rows.filter((r) => !r.referralSource);
      }
      if (segment.startsWith('__other__:')) {
        // ReferralDrillCard encodes the named top-N sources after the prefix
        // so we can exclude them exactly, rather than guessing which sources
        // were collapsed into "Other".
        const named = new Set(segment.slice(10).split('|').filter(Boolean));
        return rows.filter(
          (r) => r.referralSource != null && !named.has(r.referralSource)
        );
      }
      return rows.filter((r) => r.referralSource === segment);
    case 'assessment':
      if (!segment) return rows;
      if (segment.includes(':')) {
        const colonIdx = segment.indexOf(':');
        const subject = segment.slice(0, colonIdx);
        const outcome = segment.slice(colonIdx + 1);
        if (subject === 'math')
          return rows.filter((r) => r.assessmentMathOutcome === outcome);
        if (subject === 'eng')
          return rows.filter((r) => r.assessmentEnglishOutcome === outcome);
      }
      return rows.filter((r) => r.assessmentOutcome === segment);
    case 'time-to-enroll-bucket': {
      if (!segment) return rows.filter((r) => r.daysToEnroll !== null);
      const bucket = parseTimeToEnrollBucket(segment);
      if (!bucket) return rows;
      return rows.filter((r) => {
        if (r.daysToEnroll === null) return false;
        if (bucket.hi === null) return r.daysToEnroll >= bucket.lo;
        return r.daysToEnroll >= bucket.lo && r.daysToEnroll <= bucket.hi;
      });
    }
    case 'applications-by-level':
      if (!segment) return rows;
      return rows.filter((r) => r.level === segment);
    case 'doc-completion': {
      // Admissions cares about completeness for funnel applicants only;
      // enrolled-side missing-doc work belongs to P-Files renewal queue.
      const funnelOnly = rows.filter((r) =>
        ACTIVE_FUNNEL_STATUSES.has(r.status)
      );
      if (!segment) return funnelOnly.filter((r) => r.hasMissingDocs);
      // segment can be a level string OR "missing" / "complete"
      if (segment === 'missing')
        return funnelOnly.filter((r) => r.hasMissingDocs);
      if (segment === 'complete')
        return funnelOnly.filter((r) => !r.hasMissingDocs);
      return funnelOnly.filter((r) => r.level === segment);
    }
    case 'outdated':
      // Outdated = stale & active (≥7 days since update, status not closed).
      return rows.filter((r) => {
        const closed = [
          'Enrolled',
          'Enrolled (Conditional)',
          'Cancelled',
          'Withdrawn',
        ].includes(r.status);
        if (closed) return false;
        return r.daysSinceUpdate === null || r.daysSinceUpdate >= 7;
      });
    default:
      return rows;
  }
}

function parseTimeToEnrollBucket(
  segment: string
): { lo: number; hi: number | null } | null {
  // Matches "0–7d", "8–14d", "31–60d", ">180d". Use alternation (not a
  // character class) so the en-dash U+2013 in the bucket label and a plain
  // hyphen both match — `[–-]` is a degenerate character-class range and
  // silently fails on some engines.
  const range = /^(\d+)(?:–|-)(\d+)d$/.exec(segment);
  if (range) return { lo: Number(range[1]), hi: Number(range[2]) };
  const open = /^>\s*(\d+)d$/.exec(segment);
  if (open) return { lo: Number(open[1]) + 1, hi: null };
  return null;
}

// ---------------------------------------------------------------------------
// Per-target column defaults — drives which columns a drill renders by
// default. The Columns dropdown can toggle hidden columns on.

export type DrillColumnKey =
  | 'enroleeNumber'
  | 'studentNumber'
  | 'fullName'
  | 'status'
  | 'level'
  | 'stage'
  | 'referralSource'
  | 'assessmentOutcome'
  | 'assessmentMath'
  | 'assessmentEnglish'
  | 'applicationDate'
  | 'enrollmentDate'
  | 'daysToEnroll'
  | 'daysSinceUpdate'
  | 'daysInPipeline'
  | 'documentsComplete';

export const ALL_DRILL_COLUMNS: DrillColumnKey[] = [
  'fullName',
  'enroleeNumber',
  'studentNumber',
  'status',
  'level',
  'stage',
  'applicationDate',
  'enrollmentDate',
  'daysToEnroll',
  'daysSinceUpdate',
  'daysInPipeline',
  'referralSource',
  'assessmentOutcome',
  'assessmentMath',
  'assessmentEnglish',
  'documentsComplete',
];

export function defaultColumnsForTarget(target: DrillTarget): DrillColumnKey[] {
  switch (target) {
    case 'applications':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'applicationDate',
        'daysSinceUpdate',
      ];
    case 'enrolled':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'applicationDate',
        'enrollmentDate',
        'daysToEnroll',
      ];
    case 'conversion':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'applicationDate',
        'daysToEnroll',
      ];
    case 'avg-time':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'applicationDate',
        'enrollmentDate',
        'daysToEnroll',
      ];
    case 'funnel-stage':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'applicationDate',
        'daysSinceUpdate',
      ];
    case 'pipeline-stage':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'daysSinceUpdate',
        'daysInPipeline',
      ];
    case 'referral':
      return [
        'fullName',
        'enroleeNumber',
        'referralSource',
        'status',
        'level',
        'applicationDate',
      ];
    case 'assessment':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'assessmentMath',
        'assessmentEnglish',
        'assessmentOutcome',
      ];
    case 'time-to-enroll-bucket':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'applicationDate',
        'enrollmentDate',
        'daysToEnroll',
      ];
    case 'applications-by-level':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'status',
        'applicationDate',
      ];
    case 'doc-completion':
      return [
        'fullName',
        'enroleeNumber',
        'level',
        'documentsComplete',
        'daysSinceUpdate',
      ];
    case 'outdated':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'daysSinceUpdate',
      ];
    default:
      return ['fullName', 'enroleeNumber', 'status', 'level'];
  }
}

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  enroleeNumber: 'Applicant Number',
  studentNumber: 'Student ID',
  fullName: 'Applicant',
  status: 'Status',
  level: 'Level',
  stage: 'Stage',
  referralSource: 'Referral source',
  assessmentOutcome: 'Combined outcome',
  assessmentMath: 'Math grade',
  assessmentEnglish: 'English grade',
  applicationDate: 'App date',
  enrollmentDate: 'Enrolled on',
  daysToEnroll: 'Days to enroll',
  daysSinceUpdate: 'Days since update',
  daysInPipeline: 'Days in pipeline',
  documentsComplete: 'Documents',
};

// Title + eyebrow per target. Used in the drill sheet header.
export function drillHeaderForTarget(
  target: DrillTarget,
  segment?: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'applications':
      return {
        eyebrow: 'Admissions',
        title: 'Applications received in this date range',
      };
    case 'enrolled':
      return {
        eyebrow: 'Admissions',
        title: 'Students enrolled in this date range',
      };
    case 'conversion':
      return {
        eyebrow: 'Admissions',
        title: 'Conversion breakdown — enrolled vs. not enrolled',
      };
    case 'avg-time':
      return {
        eyebrow: 'Admissions',
        title: 'Time to enrolment — enrolled students',
      };
    case 'funnel-stage':
      return {
        eyebrow: 'Admissions funnel',
        title: segment
          ? `Applicants who reached the ${segment} stage`
          : 'Applicants by funnel stage reached',
      };
    case 'pipeline-stage':
      return {
        eyebrow: 'Admissions pipeline',
        title: segment
          ? `Applicants currently at the ${segment} stage`
          : 'Applicants by current pipeline stage',
      };
    case 'referral':
      return {
        eyebrow: 'Admissions',
        title: !segment
          ? 'Applicants by referral source'
          : segment.startsWith('__other__:')
            ? 'Applicants from other referral sources'
            : segment === 'Not specified'
              ? 'Applicants who did not specify a referral source'
              : `Applicants who heard about HFSE from ${segment}`,
      };
    case 'assessment': {
      if (!segment)
        return {
          eyebrow: 'Admissions',
          title: 'Applicants by entrance assessment outcome',
        };
      if (segment.includes(':')) {
        const colonIdx = segment.indexOf(':');
        const subjectLabel =
          segment.slice(0, colonIdx) === 'math' ? 'Maths' : 'English';
        const outcome = segment.slice(colonIdx + 1);
        return {
          eyebrow: 'Admissions',
          title: `Applicants whose ${subjectLabel} assessment outcome was ${outcome}`,
        };
      }
      return {
        eyebrow: 'Admissions',
        title: `Applicants whose assessment outcome was ${segment}`,
      };
    }
    case 'time-to-enroll-bucket':
      return {
        eyebrow: 'Admissions',
        title: segment
          ? `Students who took ${segment} from application to enrollment`
          : 'Time-to-enroll cohort',
      };
    case 'applications-by-level':
      return {
        eyebrow: 'Admissions',
        title: segment
          ? `Applicants for ${segment}`
          : 'Applicants by level applied for',
      };
    case 'doc-completion':
      return {
        eyebrow: 'Drill · Documents',
        title:
          segment === 'missing'
            ? 'Applicants missing documents'
            : segment === 'complete'
              ? 'Applicants with all documents'
              : segment
                ? `${segment}: missing documents`
                : 'Document completeness',
      };
    case 'outdated':
      return {
        eyebrow: 'Drill · Outdated',
        title: 'Applications with no recent activity',
      };
    default:
      return { eyebrow: 'Drill', title: 'Applications' };
  }
}

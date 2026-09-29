import { unstable_cache } from 'next/cache';

import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';
import { prefixFor } from '@/lib/admissions/_shared';
import {
  classifyAssessmentGrade,
  formatAssessmentGrade,
} from '@/lib/admissions/assessment-grade';
import {
  daysSinceUpdate as stalenessDaysSinceUpdate,
  isFollowUpStaleness,
  stalenessLabel,
} from '@/lib/admissions/staleness';
import {
  APPLICATION_TERMINAL_STATUSES,
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  isActiveFunnelStatus,
} from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';

import {
  AY_MONTH_LABELS,
  canonicaliseLevelApplied,
  canonicaliseNationality,
  categoryMixKey,
  daysToEnrol,
  decodePairSegment,
  hasReachedFunnelStage,
  intakeMonthIndex,
  isFunnelStageName,
  isWithdrawnApplication,
  levelAsAppliedKey,
  NATIONALITY_BY_LEVEL_LIMIT,
  NATIONALITY_MIX_LIMIT,
  nationalityBucketer,
  OVERFLOW_SEGMENT,
  reasonLabel,
  referralBucketer,
  referralSourceKey,
  terminalReasonKey,
  topReasonKeys,
  type AyMonthLabel,
} from '@/lib/admissions/insights-predicates';

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
  | 'outdated'
  // Admissions Insights (KD #229) — each filters with the predicate its
  // Insights loader counts with (lib/admissions/insights-predicates.ts).
  | 'intake-month'
  | 'withdrawn-by-level'
  | 'assessment-all'
  | 'terminal-reason'
  | 'referral-all'
  | 'category'
  | 'nationality';

export type DrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  status: string;
  level: string | null;
  stage: string | null;
  /**
   * Pipeline stage label = the applicant's `applicationStatus`. The
   * `getPipelineStageBreakdown` chart now buckets by `applicationStatus`
   * (the deep `*UpdatedDate` stage columns are unstamped in prod — 0/490 —
   * so a stage-date breakdown was hollow). Keeping `pipelineStage` aligned to
   * the same column means `pipeline-stage` segment clicks land on real rows.
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
  /**
   * Raw (non-fallback) days since `applicationUpdatedDate` was last
   * touched — null when never stamped. Internal to the 'outdated' target's
   * filter (mirrors getOutdatedApplications in dashboard.ts exactly); NOT
   * rendered as a column — `daysSinceUpdate` above is the displayed value.
   */
  rawDaysSinceUpdate: number | null;
  daysInPipeline: number;
  hasMissingDocs: boolean;
  documentsComplete: number; // count of present core docs
  documentsTotal: number; // count of core doc slots tracked
  /** The application's own `levelApplied`, raw. The Insights withdrawn,
   *  cancellation-reason and nationality charts group by this — NOT `level`,
   *  which prefers the status table's classLevel. */
  levelAsApplied: string | null;
  /** `terminalReasonKey(applicationTerminalReason)`: null = none recorded,
   *  'Unspecified' = recorded blank. */
  terminalReason: string | null;
  /** Enrolee category as the parent portal stored it, trimmed. */
  category: string | null;
  /** `canonicaliseNationality(nationality)`. */
  nationality: string | null;
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

// Same rule as the dashboard chart (lib/admissions/dashboard.ts), read through
// `parseAssessmentGrade` so HTML-wrapped Directus values classify — the chart
// and its drill must agree or a segment click lands on the wrong rows.
const classifyAssessmentValue = classifyAssessmentGrade;

/** Pure — exported for unit tests. */
export function combinedAssessmentOutcome(
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
    category: string | null;
    nationality: string | null;
  };
  type StatusLite = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    applicationUpdatedDate: string | null;
    /** Write-once enrolment timestamp added by migration 075 — the real
     *  "when did this applicant enrol" column. Distinct from
     *  applicationUpdatedDate (a general last-touched signal). */
    enrolledAt: string | null;
    classLevel: string | null;
    levelApplied: string | null;
    assessmentGradeMath: string | number | null;
    assessmentGradeEnglish: string | number | null;
    applicationTerminalReason: string | null;
  } & Record<string, string | null | number>;

  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;

  const statusCols = [
    'enroleeNumber',
    'applicationStatus',
    'applicationUpdatedDate',
    'enrolledAt',
    'classLevel',
    'levelApplied',
    'assessmentGradeMath',
    'assessmentGradeEnglish',
    '"applicationTerminalReason"',
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
              'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at, howDidYouKnowAboutHFSEIS, category, nationality'
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

  // Pipeline stage label = the applicant's `applicationStatus` — the same
  // column `loadPipelineStageBreakdown` now buckets by (the deep `*UpdatedDate`
  // stage columns are unstamped in prod, so a stage-date breakdown was hollow).
  // The chart and the drill must agree on this value or segment clicks miss
  // every row.
  function derivePipelineStage(s: StatusLite | undefined): string {
    const status = (s?.applicationStatus ?? '').trim();
    return status || 'No status';
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
    // `updated` keeps the created_at fallback for staleness/pipeline-age columns
    // (same as dashboard.ts JoinedRow.applicationUpdatedDate).
    const updated = s?.applicationUpdatedDate ?? a.created_at ?? null;
    // `enrolledAt` is the REAL write-once status-table column (migration 075
    // — stamped the moment a student first reaches Enrolled / Enrolled
    // (Conditional)) — null when never stamped. Used for daysToEnroll /
    // enrollmentDate so un-stamped rows don't produce spurious durations.
    // Distinct from `applicationUpdatedDate` (a general last-touched signal
    // that has nothing to do with when the applicant actually enrolled) —
    // see dashboard.ts's JoinedRow.enrolledAt doc comment for the same
    // distinction on the chart side.
    const enrolledAt = s?.enrolledAt ?? null;

    const createdMs = a.created_at ? Date.parse(a.created_at) : NaN;
    const updatedMs = updated ? Date.parse(updated) : NaN;

    const isEnrolled = ENROLLED_STATUSES.has(status);
    // enrollmentDate: only set when we have a real (non-fallback) timestamp.
    const enrollmentDate = isEnrolled && enrolledAt ? enrolledAt : null;

    // Shared with getAverageTimeToEnrollment (KD #229) — the card's sample is
    // exactly the rows with a non-null value here.
    const daysToEnroll = daysToEnrol({
      status,
      createdAt: a.created_at,
      enrolledAt,
    });
    const daysSinceUpdate = !Number.isNaN(updatedMs)
      ? Math.floor((today - updatedMs) / 86_400_000)
      : null;
    const daysInPipeline = !Number.isNaN(createdMs)
      ? Math.floor((today - createdMs) / 86_400_000)
      : 0;
    // Raw (non-fallback) staleness input — used exclusively by the
    // 'outdated' target so its inclusion rule is byte-identical to
    // getOutdatedApplications (dashboard.ts), which reads
    // applicationUpdatedDate directly with no created_at substitution. A
    // NULL here must stay NULL (= "Never updated", the most urgent tier per
    // staleness.ts) — `daysSinceUpdate` above intentionally keeps the
    // created_at fallback for the displayed "Days since update" column and
    // must not be reused for this filter.
    const rawDaysSinceUpdate = stalenessDaysSinceUpdate(
      s?.applicationUpdatedDate ?? null
    );

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
      // Formatted for display AND the CSV ("93.55% (29/31)", never HTML).
      assessmentMath: formatAssessmentGrade(s?.assessmentGradeMath),
      assessmentEnglish: formatAssessmentGrade(s?.assessmentGradeEnglish),
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
      rawDaysSinceUpdate,
      daysInPipeline,
      // Doc fields default to all-missing; enrichWithDocs() upgrades them
      // for callers that need doc data.
      hasMissingDocs: true,
      documentsComplete: 0,
      documentsTotal,
      levelAsApplied: a.levelApplied ?? null,
      terminalReason: terminalReasonKey(s?.applicationTerminalReason),
      category: (a.category ?? '').trim() || null,
      nationality: canonicaliseNationality(a.nationality ?? null),
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
    // v2: DrillRow gained levelAsApplied / terminalReason / category /
    // nationality (KD #229) — a stale v1 entry would serve rows without them.
    ['admissions-drill', 'rows-v2', input.ayCode],
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

// "Not terminal" — everyone except Cancelled/Withdrawn (includes Enrolled +
// Enrolled (Conditional)). Distinct from ACTIVE_FUNNEL_STAGES (which also
// excludes Enrolled); this is the definition the `assessment`, `referral`,
// and `doc-completion` charts actually use (getAssessmentOutcomes /
// getReferralSourceBreakdown / getDocumentCompletionByLevel in
// dashboard.ts) — drop terminal-status noise but keep the enrolled cohort.
const APPLICATION_TERMINAL_STATUS_SET = new Set<string>(
  APPLICATION_TERMINAL_STATUSES
);

function isTerminalStatus(status: string): boolean {
  return APPLICATION_TERMINAL_STATUS_SET.has(status);
}

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
      // still narrow their scope below.
      return rows;
    case 'enrolled':
      return rows.filter(
        (r) => r.status === 'Enrolled' || r.status === 'Enrolled (Conditional)'
      );
    case 'conversion':
      return rows;
    case 'avg-time':
      return rows.filter((r) => r.daysToEnroll !== null);
    case 'funnel-stage':
      // Same stage rule as getConversionFunnel (hasReachedFunnelStage): a
      // blank or unrecognised status reaches no stage, so "Applications
      // received" equals this list. This target had no caller before the
      // Insights page (KD #229), so aligning it changed no dashboard.
      if (!isFunnelStageName(segment)) return rows;
      return rows.filter((r) => hasReachedFunnelStage(r.status, segment));
    case 'pipeline-stage':
      if (!segment) return rows;
      // The chart's segments are now `applicationStatus` values (Submitted,
      // Processing, Enrolled, …). `pipelineStage` mirrors `status`, so both
      // branches match the same rows; the `r.status` branch also catches any
      // legacy caller passing an applicationStatus value directly.
      return rows.filter(
        (r) => r.pipelineStage === segment || r.status === segment
      );
    case 'referral': {
      // Excludes Cancelled/Withdrawn — mirrors getReferralSourceBreakdown,
      // which skips terminal statuses so referral attribution reflects the
      // funnel marketing actually drove forward, not all-time inquiry inputs.
      const referralRows = rows.filter((r) => !isTerminalStatus(r.status));
      if (!segment) return referralRows;
      if (segment === 'Not specified') {
        return referralRows.filter((r) => !r.referralSource);
      }
      if (segment.startsWith('__other__:')) {
        // ReferralDrillCard encodes the named top-N sources after the prefix
        // so we can exclude them exactly, rather than guessing which sources
        // were collapsed into "Other".
        const named = new Set(segment.slice(10).split('|').filter(Boolean));
        return referralRows.filter(
          (r) => r.referralSource != null && !named.has(r.referralSource)
        );
      }
      return referralRows.filter((r) => r.referralSource === segment);
    }
    case 'assessment': {
      // Excludes Cancelled/Withdrawn — mirrors getAssessmentOutcomes, which
      // skips terminal statuses so the donut reflects the active funnel +
      // enrolled cohort, not applicants who never completed an assessment.
      const assessmentRows = rows.filter((r) => !isTerminalStatus(r.status));
      if (!segment) return assessmentRows;
      if (segment.includes(':')) {
        const colonIdx = segment.indexOf(':');
        const subject = segment.slice(0, colonIdx);
        const outcome = segment.slice(colonIdx + 1);
        if (subject === 'math')
          return assessmentRows.filter(
            (r) => r.assessmentMathOutcome === outcome
          );
        if (subject === 'eng')
          return assessmentRows.filter(
            (r) => r.assessmentEnglishOutcome === outcome
          );
      }
      return assessmentRows.filter((r) => r.assessmentOutcome === segment);
    }
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
      // Matches getDocumentCompletionByLevel (dashboard.ts): "not terminal"
      // — everyone except Cancelled/Withdrawn, which DELIBERATELY includes
      // Enrolled / Enrolled (Conditional). The chart intentionally shows
      // upload progress across the whole cohort (not just the active
      // funnel), so the drill widens to match it rather than staying
      // narrowed to ACTIVE_FUNNEL_STAGES.
      const notTerminal = rows.filter((r) => !isTerminalStatus(r.status));
      if (!segment) return notTerminal.filter((r) => r.hasMissingDocs);
      // segment can be a level string OR "missing" / "complete"
      if (segment === 'missing')
        return notTerminal.filter((r) => r.hasMissingDocs);
      if (segment === 'complete')
        return notTerminal.filter((r) => !r.hasMissingDocs);
      return notTerminal.filter((r) => r.level === segment);
    }
    case 'outdated':
      // Outdated = stale & in the active funnel. Same scope predicate as
      // getOutdatedApplications (the dashboard count) and the
      // /admissions/applications list — shared isActiveFunnelStatus, so the
      // drill rows always equal the count (count == drill, KD #124). Staleness
      // routes through the SAME shared helpers getOutdatedApplications uses
      // (lib/admissions/staleness.ts), applied to `rawDaysSinceUpdate` (the
      // RAW applicationUpdatedDate, no created_at fallback) — a NULL there is
      // "Never updated", the most urgent tier, and must stay included. Using
      // the fallback-substituted `daysSinceUpdate` here would silently
      // exclude genuinely-never-updated recent applications.
      return rows.filter((r) => {
        if (!isActiveFunnelStatus(r.status)) return false;
        return isFollowUpStaleness(stalenessLabel(r.rawDaysSinceUpdate));
      });
    case 'intake-month': {
      // getIntakeTrendByAy: UTC month of created_at, year ignored.
      if (!segment) {
        return rows.filter((r) => intakeMonthIndex(r.applicationDate) !== null);
      }
      const month = AY_MONTH_LABELS.indexOf(segment as AyMonthLabel);
      if (month === -1) return [];
      return rows.filter((r) => intakeMonthIndex(r.applicationDate) === month);
    }
    case 'withdrawn-by-level': {
      // getWithdrawnByLevel: status Withdrawn, grouped by the level as applied.
      const withdrawn = rows.filter((r) => isWithdrawnApplication(r.status));
      if (!segment) return withdrawn;
      return withdrawn.filter(
        (r) => levelAsAppliedKey(r.levelAsApplied) === segment
      );
    }
    case 'assessment-all': {
      // getConversionByAssessment: every applicant, terminal included.
      if (!segment) return rows;
      const parsed = parseAssessmentAllSegment(segment);
      if (!parsed) return [];
      return rows.filter(
        (r) =>
          (parsed.subject === 'math'
            ? r.assessmentMathOutcome
            : r.assessmentEnglishOutcome) === parsed.outcome
      );
    }
    case 'terminal-reason': {
      // getAdmissionsTerminalReasons: applications with a reason recorded.
      const withReason = rows.filter((r) => r.terminalReason !== null);
      if (!segment) return withReason;
      const pair = decodePairSegment(segment);
      if (!pair) return [];
      // The overflow is ranked over EVERY reason, as selectTopReasonBars
      // ranks terminal.overall.
      const named =
        pair.second === OVERFLOW_SEGMENT
          ? topReasonKeys(withReason.map((r) => r.terminalReason as string))
          : null;
      return withReason.filter((r) => {
        if (pair.first && levelAsAppliedKey(r.levelAsApplied) !== pair.first) {
          return false;
        }
        if (pair.second === '') return true;
        if (named) return !named.has(r.terminalReason as string);
        return r.terminalReason === pair.second;
      });
    }
    case 'referral-all': {
      // getReferralConversion: every applicant, terminal included.
      if (!segment) return rows;
      if (segment === OVERFLOW_SEGMENT) {
        const bucketOf = referralBucketer(
          rows.map((r) => referralSourceKey(r.referralSource))
        );
        return rows.filter(
          (r) =>
            bucketOf(referralSourceKey(r.referralSource)) === OVERFLOW_SEGMENT
        );
      }
      return rows.filter(
        (r) => referralSourceKey(r.referralSource) === segment
      );
    }
    case 'category':
      // getCategoryMix: every applicant, blank/unknown as Unspecified.
      if (!segment) return rows;
      return rows.filter((r) => categoryMixKey(r.category) === segment);
    case 'nationality': {
      // getNationalityMix (no level) / getApplicantNationalityByLevel (level).
      if (!segment) return rows;
      const pair = decodePairSegment(segment);
      if (!pair) return [];
      if (!pair.first) {
        const bucketOf = nationalityBucketer(
          rows.map((r) => r.nationality),
          NATIONALITY_MIX_LIMIT
        );
        return rows.filter((r) => bucketOf(r.nationality) === pair.second);
      }
      const bucketOf = nationalityBucketer(
        rows.map((r) => r.nationality),
        NATIONALITY_BY_LEVEL_LIMIT
      );
      return rows.filter(
        (r) =>
          canonicaliseLevelApplied(r.levelAsApplied) === pair.first &&
          (pair.second === '' || bucketOf(r.nationality) === pair.second)
      );
    }
    default:
      return rows;
  }
}

/** `'math:pass'` … `'eng:notAssessed'` → subject + the drill row's outcome
 *  value. `notAssessed` is the chart's name for `unknown`. */
export function parseAssessmentAllSegment(
  segment: string
): { subject: 'math' | 'eng'; outcome: 'pass' | 'fail' | 'unknown' } | null {
  const colon = segment.indexOf(':');
  if (colon === -1) return null;
  const subject = segment.slice(0, colon);
  const raw = segment.slice(colon + 1);
  if (subject !== 'math' && subject !== 'eng') return null;
  const outcome =
    raw === 'pass' || raw === 'fail'
      ? raw
      : raw === 'notAssessed' || raw === 'unknown'
        ? 'unknown'
        : null;
  return outcome ? { subject, outcome } : null;
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
  | 'documentsComplete'
  | 'levelAsApplied'
  | 'terminalReason'
  | 'category'
  | 'nationality';

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
  'levelAsApplied',
  'terminalReason',
  'category',
  'nationality',
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
    case 'intake-month':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'applicationDate',
      ];
    case 'withdrawn-by-level':
      return [
        'fullName',
        'enroleeNumber',
        'levelAsApplied',
        'status',
        'applicationDate',
      ];
    case 'assessment-all':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'level',
        'assessmentMath',
        'assessmentEnglish',
      ];
    case 'terminal-reason':
      return [
        'fullName',
        'enroleeNumber',
        'status',
        'levelAsApplied',
        'terminalReason',
      ];
    case 'referral-all':
      return ['fullName', 'enroleeNumber', 'referralSource', 'status', 'level'];
    case 'category':
      return ['fullName', 'enroleeNumber', 'category', 'status', 'level'];
    case 'nationality':
      return [
        'fullName',
        'enroleeNumber',
        'nationality',
        'levelAsApplied',
        'status',
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
  levelAsApplied: 'Level applied for',
  terminalReason: 'Reason',
  category: 'Category',
  nationality: 'Nationality',
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
        title:
          segment === 'Submitted'
            ? 'Applications received'
            : segment
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
    case 'intake-month':
      return {
        eyebrow: 'Admissions insights',
        title: segment
          ? `Applications received in ${segment}`
          : 'Applications received by month',
      };
    case 'withdrawn-by-level':
      return {
        eyebrow: 'Admissions insights',
        title: segment
          ? `Withdrawn applications for ${segment}`
          : 'Withdrawn applications',
      };
    case 'assessment-all': {
      const parsed = segment ? parseAssessmentAllSegment(segment) : null;
      if (!parsed) {
        return {
          eyebrow: 'Admissions insights',
          title: 'Applicants by entrance assessment result',
        };
      }
      const subject = parsed.subject === 'math' ? 'Maths' : 'English';
      return {
        eyebrow: 'Admissions insights',
        title:
          parsed.outcome === 'unknown'
            ? `Applicants with no ${subject} assessment result`
            : `Applicants who ${parsed.outcome === 'pass' ? 'passed' : 'did not pass'} the ${subject} assessment`,
      };
    }
    case 'terminal-reason': {
      const pair = segment ? decodePairSegment(segment) : null;
      if (!pair) {
        return {
          eyebrow: 'Admissions insights',
          title: 'Every application with a cancellation reason',
        };
      }
      const reason =
        pair.second === OVERFLOW_SEGMENT
          ? 'other reasons'
          : pair.second
            ? reasonLabel(pair.second)
            : null;
      return {
        eyebrow: 'Admissions insights',
        title:
          pair.first && reason
            ? `${pair.first}: cancelled or withdrawn — ${reason}`
            : pair.first
              ? `Cancellation reasons for ${pair.first}`
              : `Cancelled or withdrawn — ${reason}`,
      };
    }
    case 'referral-all':
      return {
        eyebrow: 'Admissions insights',
        title: !segment
          ? 'Applicants by how they heard about HFSE'
          : segment === OVERFLOW_SEGMENT
            ? 'Applicants from other referral sources'
            : segment === 'Not specified'
              ? 'Applicants who did not say how they heard about HFSE'
              : `Applicants who heard about HFSE from ${segment}`,
      };
    case 'category':
      return {
        eyebrow: 'Admissions insights',
        title: !segment
          ? 'Applicants by category'
          : segment === 'Unspecified'
            ? 'Applicants with no category recorded'
            : `${segment} applicants`,
      };
    case 'nationality': {
      const pair = segment ? decodePairSegment(segment) : null;
      if (!pair) {
        return {
          eyebrow: 'Admissions insights',
          title: 'Applicants by nationality',
        };
      }
      const who =
        pair.second === 'Other'
          ? 'Applicants of other nationalities'
          : pair.second === 'Unspecified'
            ? 'Applicants with no nationality recorded'
            : pair.second
              ? `${pair.second} applicants`
              : 'Applicants';
      return {
        eyebrow: 'Admissions insights',
        title: pair.first ? `${who} for ${pair.first}` : who,
      };
    }
    default:
      return { eyebrow: 'Drill', title: 'Applications' };
  }
}

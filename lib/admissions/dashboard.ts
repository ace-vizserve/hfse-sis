import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';

// Sprint 7 Part A — read-only admissions analytics.
//
// Every helper here runs against the shared Supabase project using the
// service-role client. Results are wrapped in unstable_cache with a 10-minute
// TTL and an `admissions-dashboard:${ayCode}` tag so we can manually
// invalidate per-AY later if Joann asks for a "refresh" button.
//
// Table-name derivation: ayCode "AY2026" → prefix "ay2026" → tables
// ay2026_enrolment_applications, ay2026_enrolment_status, ay2026_enrolment_documents.
// Never hardcode the year — Key Decision #14.

const CACHE_TTL_SECONDS = 600;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['admissions-dashboard', `admissions-dashboard:${ayCode}`];
}

// Canonical 7 statuses from the spec (08-admission-dashboard.md §1.1).
// Any other value returned by the admissions DB folds into "Other" and is
// surfaced to the user rather than silently dropped.
const PIPELINE_STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
  'Enrolled (Conditional)',
  'Withdrawn',
  'Cancelled',
] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

type PipelineCounts = Record<PipelineStatus, number> & {
  Other: number;
  total: number;
};

type StatusLite = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  classLevel: string | null;
  levelApplied: string | null;
  assessmentGradeMath: string | number | null;
  assessmentGradeEnglish: string | number | null;
};

type AppLite = {
  enroleeNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  created_at: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
};

// ──────────────────────────────────────────────────────────────────────────
// Shared fetch — every dashboard query needs the joined (apps × status) shape,
// so we fetch both tables once and memoize via unstable_cache. Downstream
// aggregators re-use the same cached payload.
//
// Column ownership reality (probed live 2026-04-17):
//   apps    — enroleeFullName, firstName, lastName, levelApplied, created_at,
//             howDidYouKnowAboutHFSEIS
//   status  — applicationStatus, applicationUpdatedDate, classLevel,
//             levelApplied, assessmentGradeMath, assessmentGradeEnglish
// The spec doc lists `a.applicationStatus` and `a.assessment...` in its SQL
// snippets, but those columns are actually on the status table. Selecting
// them from the apps table makes the whole query fail silently.
// ──────────────────────────────────────────────────────────────────────────

type JoinedRow = AppLite & {
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  statusLevel: string | null;
  assessmentGradeMath: string | number | null;
  assessmentGradeEnglish: string | number | null;
};

async function loadJoinedRowsUncached(ayCode: string): Promise<JoinedRow[]> {
  const prefix = prefixFor(ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  const supabase = createAdmissionsClient();

  const [appsRes, statusRes] = await Promise.all([
    supabase
      .from(appsTable)
      .select(
        'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, created_at, howDidYouKnowAboutHFSEIS',
      ),
    supabase
      .from(statusTable)
      .select(
        'enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel, levelApplied, assessmentGradeMath, assessmentGradeEnglish',
      ),
  ]);

  if (appsRes.error) {
    console.error('[admissions-dashboard] apps fetch failed:', appsRes.error.message);
    return [];
  }
  if (statusRes.error) {
    console.error('[admissions-dashboard] status fetch failed:', statusRes.error.message);
    return [];
  }

  const apps = (appsRes.data ?? []) as AppLite[];
  const statuses = (statusRes.data ?? []) as StatusLite[];

  const statusByEnrolee = new Map<string, StatusLite>();
  for (const s of statuses) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }

  const out: JoinedRow[] = [];
  for (const a of apps) {
    if (!a.enroleeNumber) continue;
    const s = statusByEnrolee.get(a.enroleeNumber);
    // Fallback: the admissions team never stamps `applicationUpdatedDate` in
    // practice (0/471 populated in AY2026 as of 2026-04-17), so staleness
    // against null would make every row "Never updated." Falling back to the
    // application's `created_at` gives the real-world meaning "days since
    // submission, if nobody has touched it." The RAG tiers and pipeline-age
    // column then produce meaningful red/amber/green signal instead of all
    // collapsing into the unknown bucket.
    out.push({
      ...a,
      applicationStatus: s?.applicationStatus ?? null,
      applicationUpdatedDate: s?.applicationUpdatedDate ?? a.created_at,
      statusLevel: s?.classLevel ?? s?.levelApplied ?? null,
      assessmentGradeMath: s?.assessmentGradeMath ?? null,
      assessmentGradeEnglish: s?.assessmentGradeEnglish ?? null,
    });
  }
  return out;
}

function loadJoinedRows(ayCode: string): Promise<JoinedRow[]> {
  return unstable_cache(
    () => loadJoinedRowsUncached(ayCode),
    ['admissions-joined', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregators — each takes rows from loadJoinedRows and reduces them.
// ──────────────────────────────────────────────────────────────────────────

async function getPipelineCounts(ayCode: string): Promise<PipelineCounts> {
  const rows = await loadJoinedRows(ayCode);
  const counts: PipelineCounts = {
    Submitted: 0,
    'Ongoing Verification': 0,
    Processing: 0,
    Enrolled: 0,
    'Enrolled (Conditional)': 0,
    Withdrawn: 0,
    Cancelled: 0,
    Other: 0,
    total: 0,
  };
  for (const r of rows) {
    counts.total += 1;
    const s = (r.applicationStatus ?? '').trim();
    if ((PIPELINE_STATUSES as readonly string[]).includes(s)) {
      counts[s as PipelineStatus] += 1;
    } else {
      counts.Other += 1;
    }
  }
  return counts;
}

export type TimeToEnrollment = {
  avgDays: number;
  sampleSize: number;
};

export async function getAverageTimeToEnrollment(ayCode: string): Promise<TimeToEnrollment> {
  const rows = await loadJoinedRows(ayCode);
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.created_at || !r.applicationUpdatedDate) continue;
    if (
      r.applicationStatus !== 'Enrolled' &&
      r.applicationStatus !== 'Enrolled (Conditional)'
    ) {
      continue;
    }
    const start = Date.parse(r.created_at);
    const end = Date.parse(r.applicationUpdatedDate);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
    if (days < 0) continue;
    total += days;
    n += 1;
  }
  return { avgDays: n > 0 ? Math.round(total / n) : 0, sampleSize: n };
}

export type FunnelStage = {
  stage: string;
  count: number;
  dropOffPct: number; // % drop from previous stage (0 on first stage)
};

// Funnel counts are cumulative: every enrolled application also passed
// through verification and processing, so we count a status as having reached
// every earlier stage. That's how the spec funnel reads in practice.
export async function getConversionFunnel(ayCode: string): Promise<FunnelStage[]> {
  const counts = await getPipelineCounts(ayCode);
  const stages = [
    { stage: 'Submitted', count: counts.total - counts.Cancelled - counts.Withdrawn },
    {
      stage: 'Ongoing Verification',
      count:
        counts['Ongoing Verification'] +
        counts.Processing +
        counts.Enrolled +
        counts['Enrolled (Conditional)'],
    },
    {
      stage: 'Processing',
      count: counts.Processing + counts.Enrolled + counts['Enrolled (Conditional)'],
    },
    { stage: 'Enrolled', count: counts.Enrolled + counts['Enrolled (Conditional)'] },
  ];
  const out: FunnelStage[] = [];
  for (let i = 0; i < stages.length; i++) {
    const prev = i === 0 ? stages[i].count : stages[i - 1].count;
    const dropOffPct =
      prev > 0 && i > 0 ? Math.round(((prev - stages[i].count) / prev) * 100) : 0;
    out.push({ ...stages[i], dropOffPct });
  }
  return out;
}

export type OutdatedRow = {
  enroleeNumber: string;
  fullName: string;
  status: string;
  levelApplied: string | null;
  lastUpdated: string | null; // ISO date
  daysSinceUpdate: number | null;
  daysInPipeline: number;
};

// Spec §1.2 uses a blocklist (`NOT IN ('Enrolled', 'Cancelled', 'Withdrawn')`)
// rather than an allowlist. This matters: rows with NULL applicationStatus
// and any future intermediate status (e.g. "Ready for Assessment") stay in
// scope automatically. The freshness cutoff of 7 days comes from the same
// section of the spec — this function only returns genuinely outdated rows.
const INACTIVE_STATUSES = new Set(['Enrolled', 'Cancelled', 'Withdrawn']);
const STALE_DAY_THRESHOLD = 7;

export async function getOutdatedApplications(ayCode: string): Promise<OutdatedRow[]> {
  const rows = await loadJoinedRows(ayCode);
  const today = new Date();
  const out: OutdatedRow[] = [];
  for (const r of rows) {
    if (!r.enroleeNumber) continue;
    const status = (r.applicationStatus ?? '').trim();
    if (INACTIVE_STATUSES.has(status)) continue;

    const created = r.created_at ? Date.parse(r.created_at) : NaN;
    const updated = r.applicationUpdatedDate ? Date.parse(r.applicationUpdatedDate) : NaN;

    const daysSinceUpdate = Number.isNaN(updated)
      ? null
      : Math.floor((today.getTime() - updated) / (1000 * 60 * 60 * 24));
    const daysInPipeline = Number.isNaN(created)
      ? 0
      : Math.floor((today.getTime() - created) / (1000 * 60 * 60 * 24));

    // Spec-faithful freshness cutoff: keep rows where applicationUpdatedDate
    // is NULL (most urgent) or ≥ 7 days old. Fresh rows are dropped.
    if (daysSinceUpdate !== null && daysSinceUpdate < STALE_DAY_THRESHOLD) continue;

    out.push({
      enroleeNumber: r.enroleeNumber,
      fullName:
        (r.enroleeFullName ?? '').trim() ||
        `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() ||
        r.enroleeNumber,
      status,
      levelApplied: r.levelApplied ?? r.statusLevel,
      lastUpdated: r.applicationUpdatedDate,
      daysSinceUpdate,
      daysInPipeline,
    });
  }
  // Null updates float to the top (never updated = most urgent).
  out.sort((a, b) => {
    if (a.daysSinceUpdate === null && b.daysSinceUpdate === null) return 0;
    if (a.daysSinceUpdate === null) return -1;
    if (b.daysSinceUpdate === null) return 1;
    return b.daysSinceUpdate - a.daysSinceUpdate;
  });
  return out;
}

export type AssessmentOutcomes = {
  mathPass: number;
  mathFail: number;
  mathUnknown: number;
  engPass: number;
  engFail: number;
  engUnknown: number;
};

// HFSE uses a 60% pass mark on the entrance assessment (confirmed by Joann in
// the AY2026 onboarding notes). Grades are stored as strings that may be
// numeric ("72"), letter ("B+"), or blank. Letter grades follow the standard
// A/B/C = pass, D/F = fail convention.
function classifyAssessment(raw: string | number | null): 'pass' | 'fail' | 'unknown' {
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

export async function getAssessmentOutcomes(ayCode: string): Promise<AssessmentOutcomes> {
  const rows = await loadJoinedRows(ayCode);
  const out: AssessmentOutcomes = {
    mathPass: 0,
    mathFail: 0,
    mathUnknown: 0,
    engPass: 0,
    engFail: 0,
    engUnknown: 0,
  };
  for (const r of rows) {
    const m = classifyAssessment(r.assessmentGradeMath);
    const e = classifyAssessment(r.assessmentGradeEnglish);
    if (m === 'pass') out.mathPass += 1;
    else if (m === 'fail') out.mathFail += 1;
    else out.mathUnknown += 1;
    if (e === 'pass') out.engPass += 1;
    else if (e === 'fail') out.engFail += 1;
    else out.engUnknown += 1;
  }
  return out;
}

export type ReferralSource = {
  source: string;
  count: number;
};

export async function getReferralSourceBreakdown(ayCode: string): Promise<ReferralSource[]> {
  const rows = await loadJoinedRows(ayCode);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = (r.howDidYouKnowAboutHFSEIS ?? '').trim();
    const key = raw || 'Not specified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const all = Array.from(counts.entries()).map(([source, count]) => ({ source, count }));
  all.sort((a, b) => b.count - a.count);
  const TOP = 8;
  if (all.length <= TOP) return all;
  const top = all.slice(0, TOP);
  const rest = all.slice(TOP);
  const otherTotal = rest.reduce((acc, r) => acc + r.count, 0);
  top.push({ source: 'Other', count: otherTotal });
  return top;
}

// Document completion — live query against ay{YY}_enrolment_documents.
// ──────────────────────────────────────────────────────────────────────────
// Range-aware siblings (new). Delegate to the existing `loadJoinedRows`
// cache (AY-scoped) and range-filter in memory — avoids stampede on per-
// (from,to) cache keys.
// ──────────────────────────────────────────────────────────────────────────

export type AdmissionsRangeKpis = {
  applicationsInRange: number;
  enrolledInRange: number;
  conversionPct: number;
  avgDaysToEnroll: number;
  sampleSize: number;
};

function inRange(iso: string | null, from: string, to: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

function computeRangeKpis(rows: JoinedRow[], from: string, to: string): AdmissionsRangeKpis {
  let applications = 0;
  let enrolled = 0;
  let totalDays = 0;
  let samples = 0;

  for (const r of rows) {
    if (inRange(r.created_at, from, to)) applications += 1;
    const isEnrolled =
      r.applicationStatus === 'Enrolled' || r.applicationStatus === 'Enrolled (Conditional)';
    if (isEnrolled && inRange(r.applicationUpdatedDate, from, to)) {
      enrolled += 1;
      if (r.created_at && r.applicationUpdatedDate) {
        const start = Date.parse(r.created_at);
        const end = Date.parse(r.applicationUpdatedDate);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          totalDays += Math.round((end - start) / 86_400_000);
          samples += 1;
        }
      }
    }
  }

  return {
    applicationsInRange: applications,
    enrolledInRange: enrolled,
    conversionPct: applications > 0 ? (enrolled / applications) * 100 : 0,
    avgDaysToEnroll: samples > 0 ? Math.round(totalDays / samples) : 0,
    sampleSize: samples,
  };
}

async function loadAdmissionsKpisRangeUncached(
  input: RangeInput,
): Promise<RangeResult<AdmissionsRangeKpis>> {
  const rows = await loadJoinedRows(input.ayCode);
  const current = computeRangeKpis(rows, input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = computeRangeKpis(rows, input.cmpFrom, input.cmpTo);
  return {
    current,
    comparison,
    delta: computeDelta(current.applicationsInRange, comparison.applicationsInRange),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getAdmissionsKpisRange(
  input: RangeInput,
): Promise<RangeResult<AdmissionsRangeKpis>> {
  return unstable_cache(
    loadAdmissionsKpisRangeUncached,
    ['admissions', 'kpis-range', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Applications-per-day velocity.

export type VelocityPoint = { x: string; y: number };

function bucketByDay(dates: (string | null)[], from: string, to: string): VelocityPoint[] {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  if (!fromDate || !toDate) return [];
  const length = daysInRange({ from, to });
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    labels.push(toISODate(d));
  }
  // Pre-build label→index Map once; replaces per-row Array.indexOf which was
  // O(n × k). For a 90-day range × 1000 rows this drops 90k comparisons to
  // 1k Map lookups.
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < labels.length; i += 1) labelIndex.set(labels[i], i);
  const buckets = new Array(length).fill(0) as number[];
  for (const iso of dates) {
    if (!iso) continue;
    const day = iso.slice(0, 10);
    const idx = labelIndex.get(day);
    if (idx !== undefined) buckets[idx] += 1;
  }
  return labels.map((x, i) => ({ x, y: buckets[i] }));
}

async function loadApplicationsVelocityRangeUncached(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  const rows = await loadJoinedRows(input.ayCode);
  const createdDates = rows.map((r) => r.created_at);
  const current = bucketByDay(createdDates, input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = bucketByDay(createdDates, input.cmpFrom, input.cmpTo);
  const currentTotal = current.reduce((s, p) => s + p.y, 0);
  const comparisonTotal = comparison.reduce((s, p) => s + p.y, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getApplicationsVelocityRange(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadApplicationsVelocityRangeUncached,
    ['admissions', 'apps-velocity', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Time-to-enroll histogram — 7 day-buckets.

export type TimeToEnrollBucket = {
  label: string;
  loDays: number;
  hiDays: number | null;
  count: number;
};

const HISTOGRAM_BUCKETS = [
  { label: '0–7d', lo: 0, hi: 7 },
  { label: '8–14d', lo: 8, hi: 14 },
  { label: '15–30d', lo: 15, hi: 30 },
  { label: '31–60d', lo: 31, hi: 60 },
  { label: '61–90d', lo: 61, hi: 90 },
  { label: '91–180d', lo: 91, hi: 180 },
  { label: '>180d', lo: 181, hi: null as number | null },
] as const;

async function loadTimeToEnrollHistogramUncached(ayCode: string): Promise<TimeToEnrollBucket[]> {
  const rows = await loadJoinedRows(ayCode);
  const buckets: TimeToEnrollBucket[] = HISTOGRAM_BUCKETS.map((b) => ({
    label: b.label,
    loDays: b.lo,
    hiDays: b.hi,
    count: 0,
  }));
  for (const r of rows) {
    const isEnrolled =
      r.applicationStatus === 'Enrolled' || r.applicationStatus === 'Enrolled (Conditional)';
    if (!isEnrolled) continue;
    if (!r.created_at || !r.applicationUpdatedDate) continue;
    const start = Date.parse(r.created_at);
    const end = Date.parse(r.applicationUpdatedDate);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    const days = Math.round((end - start) / 86_400_000);
    const idx = buckets.findIndex(
      (b) => days >= b.loDays && (b.hiDays === null || days <= b.hiDays),
    );
    if (idx >= 0) buckets[idx].count += 1;
  }
  return buckets;
}

export function getTimeToEnrollHistogram(ayCode: string): Promise<TimeToEnrollBucket[]> {
  return unstable_cache(
    () => loadTimeToEnrollHistogramUncached(ayCode),
    ['admissions', 'time-to-enroll-histogram', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Canonical level ordering — primary then secondary, then any other value
// alphabetically, with 'Unknown' pinned to the end. Shared by the
// applications-by-level and doc-completion-by-level aggregators below.
// ──────────────────────────────────────────────────────────────────────────

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

const CANONICAL_LEVEL_INDEX: Record<string, number> = CANONICAL_LEVELS.reduce(
  (acc, lvl, i) => {
    acc[lvl] = i;
    return acc;
  },
  {} as Record<string, number>,
);

function compareLevels(a: string, b: string): number {
  // Three-tier ordering: canonical (P1..S4) → other → Unknown (last).
  const aIsUnknown = a === 'Unknown';
  const bIsUnknown = b === 'Unknown';
  if (aIsUnknown && bIsUnknown) return 0;
  if (aIsUnknown) return 1;
  if (bIsUnknown) return -1;

  const aIdx = CANONICAL_LEVEL_INDEX[a];
  const bIdx = CANONICAL_LEVEL_INDEX[b];
  const aIsCanon = aIdx !== undefined;
  const bIsCanon = bIdx !== undefined;
  if (aIsCanon && bIsCanon) return aIdx - bIdx;
  if (aIsCanon) return -1;
  if (bIsCanon) return 1;
  return a.localeCompare(b);
}

function resolveLevel(row: JoinedRow): string {
  // statusLevel takes precedence (registrar-stamped classLevel/levelApplied)
  // because admissions occasionally promotes/demotes between application and
  // class assignment. Falls back to the application-time levelApplied, then
  // 'Unknown' for blank/whitespace.
  const raw = (row.statusLevel ?? row.levelApplied ?? '').trim();
  return raw || 'Unknown';
}

// ──────────────────────────────────────────────────────────────────────────
// Applications-by-level — range-aware breakdown of applications by canonical
// level, with comparison-period delta on totals.
// ──────────────────────────────────────────────────────────────────────────

export type ApplicationsByLevelRow = {
  level: string; // canonical (P1..P6, S1..S4) or 'Unknown'
  count: number; // applications created within range with this level
};

export type ApplicationsByLevelResult = RangeResult<ApplicationsByLevelRow[]>;

function bucketByLevel(rows: JoinedRow[], from: string, to: string): ApplicationsByLevelRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!inRange(r.created_at, from, to)) continue;
    const lvl = resolveLevel(r);
    counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
  }
  const out: ApplicationsByLevelRow[] = Array.from(counts.entries()).map(([level, count]) => ({
    level,
    count,
  }));
  out.sort((a, b) => compareLevels(a.level, b.level));
  return out;
}

async function loadApplicationsByLevelRangeUncached(
  input: RangeInput,
): Promise<ApplicationsByLevelResult> {
  const rows = await loadJoinedRows(input.ayCode);
  const current = bucketByLevel(rows, input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = bucketByLevel(rows, input.cmpFrom, input.cmpTo);
  const currentTotal = current.reduce((s, r) => s + r.count, 0);
  const comparisonTotal = comparison.reduce((s, r) => s + r.count, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getApplicationsByLevelRange(
  input: RangeInput,
): Promise<ApplicationsByLevelResult> {
  return unstable_cache(
    loadApplicationsByLevelRangeUncached,
    ['admissions', 'apps-by-level', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Document-completion by level — current-state aggregate, not range-aware.
// Each applicant is bucketed as complete (5/5), partial (1–4), or missing (0)
// based on the 5 core document-status columns. We join the docs table to the
// existing cached joined rows in memory rather than refetching apps+status.
// ──────────────────────────────────────────────────────────────────────────

const CORE_DOC_STATUS_COLUMNS = [
  'medicalStatus',
  'passportStatus',
  'birthCertStatus',
  'educCertStatus',
  'idPictureStatus',
] as const;

type DocCompletionDocRow = Record<
  (typeof CORE_DOC_STATUS_COLUMNS)[number] | 'enroleeNumber',
  string | null
>;

export type DocCompletionRow = {
  level: string; // canonical or 'Unknown'
  total: number; // applicants in this AY at this level
  complete: number; // applicants with all 5 core docs present
  partial: number; // applicants with 1–4 docs present
  missing: number; // applicants with 0 docs present
  percentComplete: number; // round(complete/total * 100), 0 if total = 0
};

export type DocCompletionResult = DocCompletionRow[];

function countPresentDocs(d: DocCompletionDocRow | undefined): number {
  if (!d) return 0;
  let n = 0;
  for (const col of CORE_DOC_STATUS_COLUMNS) {
    const v = d[col];
    if (v !== null && v !== undefined) {
      const s = String(v).trim();
      if (s !== '' && s.toLowerCase() !== 'missing') n += 1;
    }
  }
  return n;
}

async function loadDocumentCompletionByLevelUncached(
  ayCode: string,
): Promise<DocCompletionResult> {
  const prefix = prefixFor(ayCode);
  const docsTable = `${prefix}_enrolment_documents`;
  const supabase = createAdmissionsClient();

  const [joinedRows, docsRes] = await Promise.all([
    loadJoinedRows(ayCode),
    supabase
      .from(docsTable)
      .select(`enroleeNumber, ${CORE_DOC_STATUS_COLUMNS.join(', ')}`),
  ]);

  if (docsRes.error) {
    // Non-fatal: surface zero-completion bucketing rather than failing the
    // whole dashboard card. Mirrors the drill.ts non-fatal-docs convention.
    console.warn(
      '[admissions-dashboard] doc completion fetch failed (non-fatal):',
      docsRes.error.message,
    );
  }

  const docs = (docsRes.data ?? []) as unknown as DocCompletionDocRow[];
  const docsByEnrolee = new Map<string, DocCompletionDocRow>();
  for (const d of docs) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }

  type Bucket = { total: number; complete: number; partial: number; missing: number };
  const byLevel = new Map<string, Bucket>();
  for (const r of joinedRows) {
    if (!r.enroleeNumber) continue;
    const level = resolveLevel(r);
    const bucket = byLevel.get(level) ?? { total: 0, complete: 0, partial: 0, missing: 0 };
    bucket.total += 1;
    const present = countPresentDocs(docsByEnrolee.get(r.enroleeNumber));
    if (present === CORE_DOC_STATUS_COLUMNS.length) bucket.complete += 1;
    else if (present === 0) bucket.missing += 1;
    else bucket.partial += 1;
    byLevel.set(level, bucket);
  }

  const out: DocCompletionResult = Array.from(byLevel.entries()).map(([level, b]) => ({
    level,
    total: b.total,
    complete: b.complete,
    partial: b.partial,
    missing: b.missing,
    percentComplete: b.total > 0 ? Math.round((b.complete / b.total) * 100) : 0,
  }));
  out.sort((a, b) => compareLevels(a.level, b.level));
  return out;
}

export function getDocumentCompletionByLevel(ayCode: string): Promise<DocCompletionResult> {
  return unstable_cache(
    () => loadDocumentCompletionByLevelUncached(ayCode),
    ['admissions', 'doc-completion-by-level', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Admissions chase view (Workstream A) — un-enrolled completeness rolled up
// per applicant for the focused-view branch on /admissions and the chase
// table embedded in /admissions/applications. Mirrors P-Files'
// `getDocumentDashboardData` shape, but:
//
//   * scope filter = active funnel only (Submitted / Ongoing Verification /
//     Processing) per KD #51 — Cancelled / Withdrawn / Enrolled fall out.
//   * per-row counters surface the 4 admissions chase signals (toFollow /
//     rejected / uploaded / expired). The first 3 are pre-enrolment chase
//     statuses; expired = un-enrolled applicant whose passport / pass /
//     guardian doc lapsed mid-pipeline (genuine chase trigger — parent
//     must re-upload before enrollment can finish).
//   * uses the same `DOCUMENT_SLOTS` + `resolveStatus` from
//     `lib/p-files/document-config.ts` so emitted statuses agree with the
//     SIS lifecycle widget + the chase strip counts.
//
// Cached per-(AY, statusFilter) under the existing
// `admissions-dashboard:${ayCode}` tag so writes that already revalidate
// admissions data also flush these reads.
// ──────────────────────────────────────────────────────────────────────────

export type AdmissionsChaseStatusFilter = 'all' | 'to-follow' | 'rejected' | 'uploaded' | 'expired';

const ADMISSIONS_CHASE_STATUSES: ReadonlySet<string> = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

export type AdmissionsCompletenessSlot = {
  key: string;
  label: string;
  status: import('@/lib/p-files/document-config').DocumentStatus;
  expiryDate: string | null;
};

export type AdmissionsCompleteness = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  section: string | null;
  applicationStatus: string | null;
  submittedDate: string | null;
  total: number;
  complete: number;
  toFollow: number;
  rejected: number;
  uploaded: number;
  /** Slots whose `<slot>Status === 'Expired'` for this un-enrolled applicant —
   *  passport / pass / guardian doc lapsed mid-pipeline. Genuine chase trigger:
   *  parent must re-upload before enrollment can finish. */
  expired: number;
  slots: AdmissionsCompletenessSlot[];
};

export type AdmissionsChaseSummary = {
  totalApplicants: number;
  withToFollow: number;
  withRejected: number;
  withUploaded: number;
  withExpired: number;
};

async function loadAdmissionsCompletenessForChaseUncached(
  ayCode: string,
  statusFilter: AdmissionsChaseStatusFilter,
): Promise<{ students: AdmissionsCompleteness[]; summary: AdmissionsChaseSummary }> {
  // Lazy-import p-files config to avoid circular collisions if this module
  // is ever re-imported from p-files queries.
  const { DOCUMENT_SLOTS: PFILES_SLOTS, resolveStatus } = await import('@/lib/p-files/document-config');

  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appsRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select(
        '"enroleeNumber", "studentNumber", "firstName", "lastName", "fatherEmail", "guardianEmail", "stpApplicationType", "created_at"',
      ),
    supabase
      .from(`${prefix}_enrolment_status`)
      .select('"enroleeNumber", "applicationStatus", "classLevel", "classSection"'),
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(
        PFILES_SLOTS.flatMap((s) => {
          const cols = ['"enroleeNumber"', `"${s.key}Status"`, `"${s.key}"`];
          if (s.expires) cols.push(`"${s.key}Expiry"`);
          return cols;
        })
          .filter((c, i, a) => a.indexOf(c) === i)
          .join(', '),
      ),
  ]);

  if (appsRes.error || statusRes.error || docsRes.error) {
    console.error(
      '[admissions] getAdmissionsCompletenessForChase fetch failed:',
      appsRes.error?.message ?? statusRes.error?.message ?? docsRes.error?.message,
    );
    return {
      students: [],
      summary: {
        totalApplicants: 0,
        withToFollow: 0,
        withRejected: 0,
        withUploaded: 0,
        withExpired: 0,
      },
    };
  }

  type AppRow = Record<string, unknown>;
  type StatusRow = Record<string, unknown>;
  type DocRow = Record<string, unknown>;

  const apps = (appsRes.data ?? []) as AppRow[];
  const statuses = (statusRes.data ?? []) as StatusRow[];
  const docs = (docsRes.data ?? []) as unknown as DocRow[];

  const statusByEnrolee = new Map<string, StatusRow>();
  for (const s of statuses) {
    const en = s.enroleeNumber as string | null;
    if (en) statusByEnrolee.set(en, s);
  }
  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of docs) {
    const en = d.enroleeNumber as string | null;
    if (en) docsByEnrolee.set(en, d);
  }

  const students: AdmissionsCompleteness[] = [];
  for (const a of apps) {
    const enroleeNumber = (a.enroleeNumber as string | null) ?? '';
    if (!enroleeNumber) continue;
    const statusRow = statusByEnrolee.get(enroleeNumber);
    const applicationStatus = (statusRow?.applicationStatus as string | null) ?? null;
    if (!applicationStatus || !ADMISSIONS_CHASE_STATUSES.has(applicationStatus)) continue;

    const docRow = docsByEnrolee.get(enroleeNumber);
    const firstName = (a.firstName as string | null) ?? '';
    const lastName = (a.lastName as string | null) ?? '';
    const fullName = `${lastName}, ${firstName}`.trim().replace(/^,\s*/, '');
    const level = (statusRow?.classLevel as string | null) ?? null;
    const section = (statusRow?.classSection as string | null) ?? null;
    const studentNumber = (a.studentNumber as string | null) ?? null;
    const submittedDate = (a.created_at as string | null) ?? null;

    // Per-slot resolution mirrors P-Files queries.computeForStudent — the
    // conditional gate (fatherEmail / guardianEmail / stpApplicationType)
    // hides slots not relevant for this applicant so chase counts only
    // surface the documents the parent is actually expected to upload.
    const applicableSlots = PFILES_SLOTS.filter((slot) => {
      if (!slot.conditional) return true;
      const gate = a[slot.conditional as keyof AppRow] as string | null | undefined;
      return !!gate && String(gate).trim().length > 0;
    });

    const slots = applicableSlots.map((slot) => {
      const url = (docRow?.[slot.key] as string | null) ?? null;
      const rawStatus = (docRow?.[`${slot.key}Status`] as string | null) ?? null;
      const expiryDate = slot.expires
        ? ((docRow?.[`${slot.key}Expiry`] as string | null) ?? null)
        : null;
      const status = resolveStatus(url, rawStatus, expiryDate, slot.expires);
      return { key: slot.key, label: slot.label, status, expiryDate };
    });

    const total = slots.length;
    const complete = slots.filter((s) => s.status === 'valid').length;
    const toFollow = slots.filter((s) => s.status === 'to-follow').length;
    const rejected = slots.filter((s) => s.status === 'rejected').length;
    const uploaded = slots.filter((s) => s.status === 'uploaded').length;
    const expired = slots.filter((s) => s.status === 'expired').length;

    students.push({
      enroleeNumber,
      studentNumber,
      fullName,
      level,
      section,
      applicationStatus,
      submittedDate,
      total,
      complete,
      toFollow,
      rejected,
      uploaded,
      expired,
      slots,
    });
  }

  // Apply the status pre-filter (the table component also exposes a
  // dropdown to flip between filters, but pre-filtering at the helper
  // keeps the focused-view payload smaller + cache-key-distinct).
  let visible = students;
  if (statusFilter === 'to-follow') visible = students.filter((s) => s.toFollow > 0);
  else if (statusFilter === 'rejected') visible = students.filter((s) => s.rejected > 0);
  else if (statusFilter === 'uploaded') visible = students.filter((s) => s.uploaded > 0);
  else if (statusFilter === 'expired') visible = students.filter((s) => s.expired > 0);

  // Sort: highest chase pressure first. Chase = parent-action-required
  // signals (toFollow + rejected + expired). Uploaded is awaiting-validation
  // (registrar work, not chase) and is intentionally excluded from the
  // ranking — it still surfaces in the dropdown filter + the chase strip's
  // `validation` tile.
  visible.sort((a, b) => {
    const aPressure = a.toFollow + a.rejected + a.expired;
    const bPressure = b.toFollow + b.rejected + b.expired;
    if (aPressure !== bPressure) return bPressure - aPressure;
    const aDate = a.submittedDate ? Date.parse(a.submittedDate) : Number.POSITIVE_INFINITY;
    const bDate = b.submittedDate ? Date.parse(b.submittedDate) : Number.POSITIVE_INFINITY;
    if (aDate !== bDate) return aDate - bDate;
    return a.fullName.localeCompare(b.fullName);
  });

  const summary: AdmissionsChaseSummary = {
    totalApplicants: students.length,
    withToFollow: students.filter((s) => s.toFollow > 0).length,
    withRejected: students.filter((s) => s.rejected > 0).length,
    withUploaded: students.filter((s) => s.uploaded > 0).length,
    withExpired: students.filter((s) => s.expired > 0).length,
  };

  return { students: visible, summary };
}

export function getAdmissionsCompletenessForChase(
  ayCode: string,
  statusFilter: AdmissionsChaseStatusFilter = 'all',
): Promise<{ students: AdmissionsCompleteness[]; summary: AdmissionsChaseSummary }> {
  return unstable_cache(
    () => loadAdmissionsCompletenessForChaseUncached(ayCode, statusFilter),
    ['admissions', 'completeness-chase', ayCode, statusFilter],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

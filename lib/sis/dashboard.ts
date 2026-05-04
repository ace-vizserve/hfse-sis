import { unstable_cache } from 'next/cache';

import { loadActorActivity } from '@/lib/sis/drill';
import { DOCUMENT_SLOTS, resolveStatus, type DocumentGroup } from '@/lib/p-files/document-config';
import { STAGE_COLUMN_MAP, STAGE_KEYS, STAGE_LABELS, type StageKey } from '@/lib/schemas/sis';
import { compareLevelLabels } from '@/lib/sis/levels';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';

// Records dashboard aggregators — daily-ops lens.
//
// Parallel to `lib/admissions/dashboard.ts` (analytical lens). Two Records-owned
// readouts: where students sit in the 9-stage pipeline, and the document
// validation backlog per slot. Shares the `sis:${ayCode}` cache tag + 600s TTL
// with `lib/sis/queries.ts` so every Records PATCH already invalidates these.
//
// Cache-wrapper pattern matches `lib/admissions/dashboard.ts` + `lib/p-files/queries.ts`:
// the inner `load*Uncached` functions are hoisted to module scope (no closure
// capture of ayCode per call); the `unstable_cache()` wrapper is composed
// per-call because per-AY `tags` require it. The static-tag `getRecentSisActivity`
// is fully hoisted.

const CACHE_TTL_SECONDS = 600;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['sis', `sis:${ayCode}`];
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline stage breakdown
// ──────────────────────────────────────────────────────────────────────────

export type PipelineStage = {
  key: StageKey | 'not_started';
  label: string;
  count: number;
};

// Canonical stage order: STAGE_KEYS from lib/schemas/sis.ts.
// "Current stage" = the rightmost stage in that order whose *UpdatedDate
// is non-null on the student's enrolment_status row. No stages touched →
// 'not_started'. Matches how Records staff mentally track position.
async function loadPipelineStageBreakdownUncached(ayCode: string): Promise<PipelineStage[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const updatedDateCols = STAGE_KEYS.map((k) => STAGE_COLUMN_MAP[k].updatedDateCol);
  const selectCols = ['enroleeNumber', ...updatedDateCols].join(', ');

  const { data, error } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select(selectCols);

  if (error) {
    console.error('[sis] getPipelineStageBreakdown fetch failed:', error.message);
    return emptyPipelineBuckets();
  }

  const rows = (data ?? []) as unknown as Array<Record<string, string | null>>;
  const counts = new Map<StageKey | 'not_started', number>();
  for (const k of STAGE_KEYS) counts.set(k, 0);
  counts.set('not_started', 0);

  for (const row of rows) {
    let current: StageKey | 'not_started' = 'not_started';
    for (const k of STAGE_KEYS) {
      const col = STAGE_COLUMN_MAP[k].updatedDateCol;
      if (row[col]) current = k;
    }
    counts.set(current, (counts.get(current) ?? 0) + 1);
  }

  const out: PipelineStage[] = [
    { key: 'not_started', label: 'Not started', count: counts.get('not_started') ?? 0 },
    ...STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], count: counts.get(k) ?? 0 })),
  ];
  return out;
}

export function getPipelineStageBreakdown(ayCode: string): Promise<PipelineStage[]> {
  return unstable_cache(
    loadPipelineStageBreakdownUncached,
    ['sis', 'pipeline-stage-breakdown', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}

function emptyPipelineBuckets(): PipelineStage[] {
  return [
    { key: 'not_started', label: 'Not started', count: 0 },
    ...STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], count: 0 })),
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Document validation backlog
// ──────────────────────────────────────────────────────────────────────────

export type DocumentBacklogRow = {
  slotKey: string;
  label: string;
  group: DocumentGroup;
  valid: number;
  pending: number;
  rejected: number;
  missing: number;
};

// Per-slot status tally across every student's documents row. Uses the
// canonical `resolveStatus()` helper so conditional slots (father/guardian,
// gated by fatherEmail/guardianEmail on applications) don't inflate "Missing".
// `na` is excluded from all counts. `expired` rolls into `missing` (Records
// needs to re-collect it either way).
async function loadDocumentValidationBacklogUncached(ayCode: string): Promise<DocumentBacklogRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  // Columns to select: for each slot, url + status + (expiry if expiring).
  // Plus the gate columns that drive `conditional` slots — fatherEmail /
  // guardianEmail for parent-presence gating, stpApplicationType for the STP
  // slot group (KD #61).
  const selectCols = new Set<string>([
    'enroleeNumber',
    'fatherEmail',
    'guardianEmail',
    'stpApplicationType',
  ]);
  for (const slot of DOCUMENT_SLOTS) {
    selectCols.add(slot.key);
    selectCols.add(`${slot.key}Status`);
    if (slot.expires) selectCols.add(`${slot.key}Expiry`);
  }

  // Documents table holds url + status + expiry; conditional columns
  // (fatherEmail / guardianEmail / stpApplicationType) live on the apps row.
  // Fetch both.
  const [docsRes, appsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(
        [
          'enroleeNumber',
          ...DOCUMENT_SLOTS.flatMap((s) =>
            s.expires ? [s.key, `${s.key}Status`, `${s.key}Expiry`] : [s.key, `${s.key}Status`],
          ),
        ].join(', '),
      ),
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, fatherEmail, guardianEmail, stpApplicationType'),
  ]);

  if (docsRes.error) {
    console.error('[sis] getDocumentValidationBacklog docs fetch failed:', docsRes.error.message);
    return emptyBacklogRows();
  }
  if (appsRes.error) {
    console.error('[sis] getDocumentValidationBacklog apps fetch failed:', appsRes.error.message);
    return emptyBacklogRows();
  }

  type GateRow = {
    enroleeNumber: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
    stpApplicationType: string | null;
  };
  const gates = new Map<string, GateRow>();
  for (const a of (appsRes.data ?? []) as unknown as GateRow[]) {
    if (a.enroleeNumber) gates.set(a.enroleeNumber, a);
  }

  const rows = (docsRes.data ?? []) as unknown as Array<Record<string, string | null>>;
  const buckets: DocumentBacklogRow[] = DOCUMENT_SLOTS.map((s) => ({
    slotKey: s.key,
    label: s.label,
    group: s.group,
    valid: 0,
    pending: 0,
    rejected: 0,
    missing: 0,
  }));
  const byKey = new Map(buckets.map((b) => [b.slotKey, b]));

  for (const row of rows) {
    const enroleeNumber = row.enroleeNumber;
    const gate = enroleeNumber ? gates.get(enroleeNumber) : null;

    for (const slot of DOCUMENT_SLOTS) {
      // Conditional slots — skip if the gate column is not set on this applicant.
      if (slot.conditional) {
        const gateValue =
          gate?.[
            slot.conditional as 'fatherEmail' | 'guardianEmail' | 'stpApplicationType'
          ] ?? null;
        if (!gateValue || gateValue.trim() === '') continue;
      }

      const url = row[slot.key];
      const rawStatus = row[`${slot.key}Status`];
      const expiry = slot.expires ? row[`${slot.key}Expiry`] : null;
      const status = resolveStatus(url, rawStatus, expiry, slot.expires);

      const bucket = byKey.get(slot.key);
      if (!bucket) continue;
      switch (status) {
        case 'valid':
          bucket.valid += 1;
          break;
        case 'uploaded':
        case 'to-follow':
          // 'to-follow' = parent acknowledged, awaiting upload — counts as
          // "in progress" alongside 'uploaded' for dashboard aggregates.
          bucket.pending += 1;
          break;
        case 'rejected':
          bucket.rejected += 1;
          break;
        case 'expired':
        case 'missing':
          bucket.missing += 1;
          break;
        case 'na':
          break;
      }
    }
  }

  return buckets;
}

export function getDocumentValidationBacklog(ayCode: string): Promise<DocumentBacklogRow[]> {
  return unstable_cache(
    loadDocumentValidationBacklogUncached,
    ['sis', 'document-validation-backlog', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}

function emptyBacklogRows(): DocumentBacklogRow[] {
  return DOCUMENT_SLOTS.map((s) => ({
    slotKey: s.key,
    label: s.label,
    group: s.group,
    valid: 0,
    pending: 0,
    rejected: 0,
    missing: 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Level distribution — current-AY breakdown by grade level
// ──────────────────────────────────────────────────────────────────────────

export type LevelCount = {
  level: string;
  count: number;
};

// Counts students per level. Prefers `classLevel` (post-enrollment assignment)
// and falls back to `levelApplied` (pre-enrollment) when a student hasn't
// been placed yet. `Unknown` bucket absorbs rows with neither.
async function loadLevelDistributionUncached(ayCode: string): Promise<LevelCount[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appsRes, statusRes] = await Promise.all([
    supabase.from(`${prefix}_enrolment_applications`).select('enroleeNumber, levelApplied'),
    supabase.from(`${prefix}_enrolment_status`).select('enroleeNumber, classLevel'),
  ]);

  if (appsRes.error || statusRes.error) {
    console.error(
      '[sis] getLevelDistribution fetch failed:',
      appsRes.error?.message ?? statusRes.error?.message,
    );
    return [];
  }

  type AppLite = { enroleeNumber: string | null; levelApplied: string | null };
  type StatusLite = { enroleeNumber: string | null; classLevel: string | null };

  const classLevelByEnrolee = new Map<string, string>();
  for (const s of (statusRes.data ?? []) as StatusLite[]) {
    if (s.enroleeNumber && s.classLevel) {
      classLevelByEnrolee.set(s.enroleeNumber, s.classLevel);
    }
  }

  const counts = new Map<string, number>();
  for (const a of (appsRes.data ?? []) as AppLite[]) {
    const level =
      (a.enroleeNumber && classLevelByEnrolee.get(a.enroleeNumber)) ||
      (a.levelApplied?.trim() || 'Unknown');
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  // Sort in HFSE canonical order (YS-L..CS2 per LEVEL_LABELS_ORDERED), then Unknown last.
  const entries = Array.from(counts.entries());
  entries.sort(([a], [b]) => compareLevelLabels(a, b));
  return entries.map(([level, count]) => ({ level, count }));
}

export function getLevelDistribution(ayCode: string): Promise<LevelCount[]> {
  return unstable_cache(
    loadLevelDistributionUncached,
    ['sis', 'level-distribution', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Expiring documents — passport / pass windows
// ──────────────────────────────────────────────────────────────────────────

export type ExpiringDocRow = {
  enroleeNumber: string;
  studentName: string;
  slotKey: string;
  slotLabel: string;
  expiryDate: string;
  daysUntilExpiry: number;
};

// Students whose passport / pass / parent-passport / parent-pass expire
// within `windowDays` (default 60). Returns at most `limit` rows sorted
// by soonest first. Includes already-expired docs (negative daysUntilExpiry)
// since those are still Records action items.
async function loadExpiringDocumentsUncached(
  ayCode: string,
  windowDays: number,
  limit: number,
): Promise<ExpiringDocRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const expiringSlots = DOCUMENT_SLOTS.filter((s) => s.expires);
  const selectCols = [
    'enroleeNumber',
    ...expiringSlots.map((s) => `${s.key}Expiry`),
  ].join(', ');

  const [docsRes, appsRes] = await Promise.all([
    supabase.from(`${prefix}_enrolment_documents`).select(selectCols),
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, enroleeFullName, firstName, lastName'),
  ]);

  if (docsRes.error || appsRes.error) {
    console.error(
      '[sis] getExpiringDocuments fetch failed:',
      docsRes.error?.message ?? appsRes.error?.message,
    );
    return [];
  }

  type AppLite = {
    enroleeNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  const nameByEnrolee = new Map<string, string>();
  for (const a of (appsRes.data ?? []) as AppLite[]) {
    if (!a.enroleeNumber) continue;
    const full =
      a.enroleeFullName?.trim() ||
      [a.firstName, a.lastName].filter(Boolean).join(' ').trim() ||
      a.enroleeNumber;
    nameByEnrolee.set(a.enroleeNumber, full);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const rows = (docsRes.data ?? []) as unknown as Array<Record<string, string | null>>;
  const out: ExpiringDocRow[] = [];

  for (const row of rows) {
    const enroleeNumber = row.enroleeNumber;
    if (!enroleeNumber) continue;

    for (const slot of expiringSlots) {
      const expiryStr = row[`${slot.key}Expiry`];
      if (!expiryStr) continue;

      const expiry = parseDate(expiryStr);
      if (!expiry) continue;

      const diffMs = expiry.getTime() - today.getTime();
      if (diffMs > windowMs) continue; // outside window

      out.push({
        enroleeNumber,
        studentName: nameByEnrolee.get(enroleeNumber) ?? enroleeNumber,
        slotKey: slot.key,
        slotLabel: slot.label,
        expiryDate: expiryStr,
        daysUntilExpiry: Math.round(diffMs / (1000 * 60 * 60 * 24)),
      });
    }
  }

  out.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return out.slice(0, limit);
}

export function getExpiringDocuments(
  ayCode: string,
  windowDays: number = 60,
  limit: number = 8,
): Promise<ExpiringDocRow[]> {
  return unstable_cache(
    loadExpiringDocumentsUncached,
    ['sis', 'expiring-documents', ayCode, String(windowDays), String(limit)],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode, windowDays, limit);
}

function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ──────────────────────────────────────────────────────────────────────────
// Recent activity feed — last N sis.* audit entries (cross-AY)
// ──────────────────────────────────────────────────────────────────────────

export type RecentActivityRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  entityId: string | null;
  createdAt: string;
  context: Record<string, unknown>;
};

// Last N Records-owned audit entries. NOT cached per-AY because audit rows
// span every AY and we want freshness on this feed; uses a shorter TTL
// keyed on limit alone, tagged so any sis.* mutation invalidates it.
// Fully hoisted (static tags) per playbook §2.
async function loadRecentSisActivityUncached(limit: number): Promise<RecentActivityRow[]> {
  const supabase = createAdmissionsClient();

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, actor_email, entity_id, created_at, context')
    .like('action', 'sis.%')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[sis] getRecentSisActivity fetch failed:', error.message);
    return [];
  }

  type AuditLite = {
    id: string;
    action: string;
    actor_email: string | null;
    entity_id: string | null;
    created_at: string;
    context: Record<string, unknown> | null;
  };
  return ((data ?? []) as AuditLite[]).map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email,
    entityId: r.entity_id,
    createdAt: r.created_at,
    context: r.context ?? {},
  }));
}

const loadRecentSisActivity = unstable_cache(
  loadRecentSisActivityUncached,
  ['sis', 'recent-activity'],
  { tags: ['sis'], revalidate: 120 },
);

export function getRecentSisActivity(limit: number = 8): Promise<RecentActivityRow[]> {
  return loadRecentSisActivity(limit);
}

// ──────────────────────────────────────────────────────────────────────────
// Range-aware siblings (new).
// ──────────────────────────────────────────────────────────────────────────

export type RecordsRangeKpis = {
  enrollmentsInRange: number;
  /** Subset of enrollmentsInRange — registrar-tagged late enrollees per
   *  KD #68. Surfaces alongside the New Enrollments MetricCard so oversight
   *  can spot late starts at-a-glance without drilling. */
  lateEnroleesInRange: number;
  withdrawalsInRange: number;
  activeEnrolled: number;
  expiringSoon: number;
};

async function loadRecordsKpisForRange(input: RangeInput): Promise<RecordsRangeKpis> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const prefix = prefixFor(input.ayCode);

  // KD #68: late enrollees are real new enrollments tagged for term-of-entry
  // visibility — count them in both `enrollmentsInRange` (so the headline
  // KPI is honest) and `lateEnroleesInRange` (so the breakdown surfaces).
  const [enrolRes, lateRes, withdrawRes, activeRes, docsRes] = await Promise.all([
    service
      .from('section_students')
      .select('id', { count: 'exact', head: true })
      .in('enrollment_status', ['active', 'late_enrollee'])
      .gte('enrollment_date', input.from)
      .lte('enrollment_date', input.to),
    service
      .from('section_students')
      .select('id', { count: 'exact', head: true })
      .eq('enrollment_status', 'late_enrollee')
      .gte('enrollment_date', input.from)
      .lte('enrollment_date', input.to),
    service
      .from('section_students')
      .select('id', { count: 'exact', head: true })
      .eq('enrollment_status', 'withdrawn')
      .gte('withdrawal_date', input.from)
      .lte('withdrawal_date', input.to),
    service
      .from('section_students')
      .select('id', { count: 'exact', head: true })
      .in('enrollment_status', ['active', 'late_enrollee']),
    admissions
      .from(`${prefix}_enrolment_documents`)
      .select(
        [
          'enroleeNumber',
          ...DOCUMENT_SLOTS.flatMap((s) =>
            s.expires ? [`${s.key}Expiry`] : [],
          ),
        ].join(', '),
      ),
  ]);

  type DocRow = Record<string, string | null>;
  const endDate = parseLocalDate(input.to) ?? new Date();
  const windowEnd = new Date(endDate);
  windowEnd.setDate(windowEnd.getDate() + 60);
  let expiringSoon = 0;
  for (const row of (docsRes.data ?? []) as unknown as DocRow[]) {
    for (const slot of DOCUMENT_SLOTS) {
      if (!slot.expires) continue;
      const exp = row[`${slot.key}Expiry`];
      if (!exp) continue;
      const d = parseLocalDate(exp);
      if (d && d >= endDate && d <= windowEnd) expiringSoon += 1;
    }
  }

  return {
    enrollmentsInRange: enrolRes.count ?? 0,
    lateEnroleesInRange: lateRes.count ?? 0,
    withdrawalsInRange: withdrawRes.count ?? 0,
    activeEnrolled: activeRes.count ?? 0,
    expiringSoon,
  };
}

async function loadRecordsKpisRangeUncached(
  input: RangeInput,
): Promise<RangeResult<RecordsRangeKpis>> {
  const current = await loadRecordsKpisForRange(input);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = await loadRecordsKpisForRange({
    ayCode: input.ayCode,
    from: input.cmpFrom,
    to: input.cmpTo,
    cmpFrom: input.cmpFrom,
    cmpTo: input.cmpTo,
  });
  return {
    current,
    comparison,
    delta: computeDelta(current.enrollmentsInRange, comparison.enrollmentsInRange),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getRecordsKpisRange(
  input: RangeInput,
): Promise<RangeResult<RecordsRangeKpis>> {
  return unstable_cache(
    loadRecordsKpisRangeUncached,
    ['sis', 'records-kpis-range', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Enrollment + withdrawal velocity — daily-bucketed.

export type VelocityPoint = { x: string; y: number };

function bucketByDay(rows: { ts: string }[], from: string, to: string): VelocityPoint[] {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  if (!fromDate || !toDate) return [];
  const length = daysInRange({ from, to });
  const buckets = new Array(length).fill(0) as number[];
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    labels.push(toISODate(d));
  }
  for (const row of rows) {
    const date = row.ts.slice(0, 10);
    const idx = labels.indexOf(date);
    if (idx >= 0) buckets[idx] += 1;
  }
  return labels.map((x, i) => ({ x, y: buckets[i] }));
}

async function loadEnrollmentVelocityRangeUncached(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  const service = createServiceClient();
  const hasCmp = input.cmpFrom != null && input.cmpTo != null;
  const earliest = hasCmp && input.cmpFrom! < input.from ? input.cmpFrom! : input.from;
  const latest = hasCmp && input.to < input.cmpTo! ? input.cmpTo! : input.to;

  const { data } = await service
    .from('section_students')
    .select('enrollment_date')
    .eq('enrollment_status', 'active')
    .gte('enrollment_date', earliest)
    .lte('enrollment_date', latest);

  type Row = { enrollment_date: string };
  const rows = ((data ?? []) as Row[])
    .filter((r) => r.enrollment_date)
    .map((r) => ({ ts: r.enrollment_date }));
  const current = bucketByDay(rows, input.from, input.to);
  if (!hasCmp) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = bucketByDay(rows, input.cmpFrom!, input.cmpTo!);
  const currentTotal = current.reduce((s, p) => s + p.y, 0);
  const comparisonTotal = comparison.reduce((s, p) => s + p.y, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom!, to: input.cmpTo! },
  };
}

export function getEnrollmentVelocityRange(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadEnrollmentVelocityRangeUncached,
    ['sis', 'enrollment-velocity', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Withdrawal velocity — symmetric sibling to enrollment velocity.
// Reads `section_students.withdrawal_date` for rows in the 'withdrawn'
// status, range-scoped and bucketed daily.

async function loadWithdrawalVelocityRangeUncached(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  const service = createServiceClient();
  const hasCmp = input.cmpFrom != null && input.cmpTo != null;
  const earliest = hasCmp && input.cmpFrom! < input.from ? input.cmpFrom! : input.from;
  const latest = hasCmp && input.to < input.cmpTo! ? input.cmpTo! : input.to;

  const { data } = await service
    .from('section_students')
    .select('withdrawal_date')
    .eq('enrollment_status', 'withdrawn')
    .gte('withdrawal_date', earliest)
    .lte('withdrawal_date', latest);

  type Row = { withdrawal_date: string };
  const rows = ((data ?? []) as Row[])
    .filter((r) => r.withdrawal_date)
    .map((r) => ({ ts: r.withdrawal_date }));
  const current = bucketByDay(rows, input.from, input.to);
  if (!hasCmp) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = bucketByDay(rows, input.cmpFrom!, input.cmpTo!);
  const currentTotal = current.reduce((s, p) => s + p.y, 0);
  const comparisonTotal = comparison.reduce((s, p) => s + p.y, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom!, to: input.cmpTo! },
  };
}

export function getWithdrawalVelocityRange(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadWithdrawalVelocityRangeUncached,
    ['sis', 'withdrawal-velocity', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Audit activity by module — for SIS admin dashboard.

export type AuditModulePoint = {
  module: string;
  count: number;
};

async function loadAuditActivityByModuleUncached(
  input: RangeInput,
): Promise<RangeResult<AuditModulePoint[]>> {
  const service = createServiceClient();
  const modules: Array<{ key: string; label: string }> = [
    { key: 'sheet.', label: 'Markbook — sheet' },
    { key: 'entry.', label: 'Markbook — entry' },
    { key: 'pfile.', label: 'P-Files' },
    { key: 'sis.', label: 'SIS' },
    { key: 'attendance.', label: 'Attendance' },
    { key: 'evaluation.', label: 'Evaluation' },
  ];

  async function countsFor(from: string, to: string): Promise<AuditModulePoint[]> {
    // Preserve module order (indexed results), so callers can align
    // current[i] to comparison[i] deterministically.
    const results = await Promise.all(
      modules.map(async (m) => {
        const { count } = await service
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .like('action', `${m.key}%`)
          .gte('created_at', `${from}T00:00:00+08:00`)
          .lte('created_at', `${to}T23:59:59+08:00`);
        return { module: m.label, count: count ?? 0 };
      }),
    );
    return results;
  }

  const current = await countsFor(input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = await countsFor(input.cmpFrom, input.cmpTo);
  const currentTotal = current.reduce((s, p) => s + p.count, 0);
  const comparisonTotal = comparison.reduce((s, p) => s + p.count, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getAuditActivityByModule(
  input: RangeInput,
): Promise<RangeResult<AuditModulePoint[]>> {
  return unstable_cache(
    loadAuditActivityByModuleUncached,
    ['sis', 'audit-by-module', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: ['sis'], revalidate: 120 },
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Class-assignment readiness — students enrolled (status=Enrolled) per the
// admissions tables but not yet placed in any AY-current section. Fills the
// gap between "enrolled" and "fully placed", actionable for registrars
// during the section-assignment workflow.

export type ClassAssignmentReadinessRow = {
  enroleeNumber: string;
  fullName: string;
  level: string | null;
  enrollmentDate: string | null; // ISO
  daysSinceEnrollment: number | null;
};

async function loadClassAssignmentReadinessUncached(
  ayCode: string,
): Promise<ClassAssignmentReadinessRow[]> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = ayRow?.id as string | undefined;
  if (!ayId) return [];

  const { data: sectionsData } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = ((sectionsData ?? []) as { id: string }[]).map((r) => r.id);

  const prefix = prefixFor(ayCode);
  type EnrolledRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    applicationUpdatedDate: string | null;
    classLevel: string | null;
    levelApplied: string | null;
  };
  const [enrolledRes, ssRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel, levelApplied')
      .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']),
    sectionIds.length > 0
      ? service.from('section_students').select('enrolee_number').in('section_id', sectionIds)
      : Promise.resolve({ data: [] as { enrolee_number: string | null }[] }),
  ]);

  const enrolledRows = (enrolledRes.data ?? []) as EnrolledRow[];
  const assignedEnrolees = new Set(
    ((ssRes.data ?? []) as { enrolee_number: string | null }[])
      .map((r) => r.enrolee_number)
      .filter((v): v is string => v !== null),
  );

  const unassignedEnrolees = enrolledRows
    .map((r) => r.enroleeNumber)
    .filter((v): v is string => v !== null && !assignedEnrolees.has(v));
  if (unassignedEnrolees.length === 0) return [];

  type AppRow = {
    enroleeNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
    levelApplied: string | null;
    created_at: string | null;
  };
  const { data: appsData } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, created_at')
    .in('enroleeNumber', unassignedEnrolees);
  const appsByEnrolee = new Map<string, AppRow>();
  for (const a of (appsData ?? []) as AppRow[]) {
    if (a.enroleeNumber) appsByEnrolee.set(a.enroleeNumber, a);
  }
  const statusByEnrolee = new Map<string, EnrolledRow>();
  for (const s of enrolledRows) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }

  const today = Date.now();
  const out: ClassAssignmentReadinessRow[] = [];
  for (const enroleeNumber of unassignedEnrolees) {
    const status = statusByEnrolee.get(enroleeNumber);
    const app = appsByEnrolee.get(enroleeNumber);
    const fullName =
      (app?.enroleeFullName ?? '').trim() ||
      `${app?.firstName ?? ''} ${app?.lastName ?? ''}`.trim() ||
      enroleeNumber;
    const enrollmentDate = status?.applicationUpdatedDate ?? app?.created_at ?? null;
    const enrolledMs = enrollmentDate ? Date.parse(enrollmentDate) : NaN;
    out.push({
      enroleeNumber,
      fullName,
      level: status?.classLevel ?? app?.levelApplied ?? null,
      enrollmentDate,
      daysSinceEnrollment: !Number.isNaN(enrolledMs)
        ? Math.floor((today - enrolledMs) / 86_400_000)
        : null,
    });
  }
  out.sort((a, b) => (b.daysSinceEnrollment ?? 0) - (a.daysSinceEnrollment ?? 0));
  return out;
}

export function getClassAssignmentReadiness(
  ayCode: string,
): Promise<ClassAssignmentReadinessRow[]> {
  return unstable_cache(
    () => loadClassAssignmentReadinessUncached(ayCode),
    ['sis-dashboard', 'class-assignment-readiness', ayCode],
    { revalidate: 60, tags: tag(ayCode) },
  )();
}

export async function getActivityByActor(
  range?: { from: string; to: string },
): Promise<Awaited<ReturnType<typeof loadActorActivity>>> {
  // Cache wrapper keyed by range
  const key = ['sis-dashboard', 'activity-by-actor', range?.from ?? 'all', range?.to ?? 'all'];
  return unstable_cache(() => loadActorActivity(range), key, {
    revalidate: 60,
    tags: ['sis-dashboard', 'audit-log'],
  })();
}

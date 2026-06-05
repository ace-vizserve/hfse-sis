import { unstable_cache } from 'next/cache';

import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { loadActorActivity } from '@/lib/sis/drill';
import {
  DOCUMENT_SLOTS,
  resolveStatus,
  type DocumentGroup,
} from '@/lib/p-files/document-config';
import {
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  type StageKey,
} from '@/lib/schemas/sis';
import { compareLevelLabels } from '@/lib/sis/levels';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';

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
async function loadPipelineStageBreakdownUncached(
  ayCode: string
): Promise<PipelineStage[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const updatedDateCols = STAGE_KEYS.map(
    (k) => STAGE_COLUMN_MAP[k].updatedDateCol
  );
  const selectCols = ['enroleeNumber', ...updatedDateCols].join(', ');

  const { data, error } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select(selectCols);

  if (error) {
    console.error(
      '[sis] getPipelineStageBreakdown fetch failed:',
      error.message
    );
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
    {
      key: 'not_started',
      label: 'Not started',
      count: counts.get('not_started') ?? 0,
    },
    ...STAGE_KEYS.map((k) => ({
      key: k,
      label: STAGE_LABELS[k],
      count: counts.get(k) ?? 0,
    })),
  ];
  return out;
}

export function getPipelineStageBreakdown(
  ayCode: string
): Promise<PipelineStage[]> {
  return unstable_cache(
    loadPipelineStageBreakdownUncached,
    ['sis', 'pipeline-stage-breakdown', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
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
async function loadDocumentValidationBacklogUncached(
  ayCode: string
): Promise<DocumentBacklogRow[]> {
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

  // Records is enrolled-only per KD #51 — first resolve the set of enrolled
  // enroleeNumbers, then narrow both the docs + apps fetches to that set.
  // Without this, the backlog tally counted every Submitted/Cancelled/etc.
  // row's documents, inflating "missing"/"pending" buckets with funnel
  // applicants that aren't Records's responsibility.
  const { data: statusRows, error: statusErr } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus')
    .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
  if (statusErr) {
    console.error(
      '[sis] getDocumentValidationBacklog status fetch failed:',
      statusErr.message
    );
    return emptyBacklogRows();
  }
  const enrolledNumbers = (
    (statusRows ?? []) as { enroleeNumber: string | null }[]
  )
    .map((s) => s.enroleeNumber)
    .filter((v): v is string => v !== null);
  if (enrolledNumbers.length === 0) return emptyBacklogRows();

  // Documents table holds url + status + expiry; conditional columns
  // (fatherEmail / guardianEmail / stpApplicationType) live on the apps row.
  // Both narrowed to the enrolled set.
  const [docsRes, appsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(
        [
          'enroleeNumber',
          ...DOCUMENT_SLOTS.flatMap((s) =>
            s.expires
              ? [s.key, `${s.key}Status`, `${s.key}Expiry`]
              : [s.key, `${s.key}Status`]
          ),
        ].join(', ')
      )
      .in('enroleeNumber', enrolledNumbers),
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, fatherEmail, guardianEmail, stpApplicationType')
      .in('enroleeNumber', enrolledNumbers),
  ]);

  if (docsRes.error) {
    console.error(
      '[sis] getDocumentValidationBacklog docs fetch failed:',
      docsRes.error.message
    );
    return emptyBacklogRows();
  }
  if (appsRes.error) {
    console.error(
      '[sis] getDocumentValidationBacklog apps fetch failed:',
      appsRes.error.message
    );
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

  const rows = (docsRes.data ?? []) as unknown as Array<
    Record<string, string | null>
  >;
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
            slot.conditional as
              | 'fatherEmail'
              | 'guardianEmail'
              | 'stpApplicationType'
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

export function getDocumentValidationBacklog(
  ayCode: string
): Promise<DocumentBacklogRow[]> {
  return unstable_cache(
    loadDocumentValidationBacklogUncached,
    ['sis', 'document-validation-backlog', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
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

// Counts students per level. Records is enrolled-only per KD #51 — filter
// to applicationStatus IN ('Enrolled', 'Enrolled (Conditional)') so the
// donut shows enrolled cohort breakdown, not pre-enrolment funnel volume.
// Prefers `classLevel` (post-enrollment assignment); falls back to
// `levelApplied` if the registrar hasn't assigned a class yet.
async function loadLevelDistributionUncached(
  ayCode: string
): Promise<LevelCount[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const { data: statusRows, error: statusErr } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, classLevel, applicationStatus')
    .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
  if (statusErr) {
    console.error(
      '[sis] getLevelDistribution status fetch failed:',
      statusErr.message
    );
    return [];
  }

  type StatusLite = {
    enroleeNumber: string | null;
    classLevel: string | null;
    applicationStatus: string | null;
  };
  const enrolledRows = (statusRows ?? []) as StatusLite[];
  const enrolledNumbers = enrolledRows
    .map((s) => s.enroleeNumber)
    .filter((v): v is string => v !== null);
  if (enrolledNumbers.length === 0) return [];

  const classLevelByEnrolee = new Map<string, string>();
  for (const s of enrolledRows) {
    if (s.enroleeNumber && s.classLevel) {
      classLevelByEnrolee.set(s.enroleeNumber, s.classLevel);
    }
  }

  // Fetch the apps row only for enrolled enroleeNumbers — fallback to
  // levelApplied when classLevel hasn't been assigned yet.
  const { data: appsRows, error: appsErr } = await supabase
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, levelApplied')
    .in('enroleeNumber', enrolledNumbers);
  if (appsErr) {
    console.error(
      '[sis] getLevelDistribution apps fetch failed:',
      appsErr.message
    );
    return [];
  }

  type AppLite = { enroleeNumber: string | null; levelApplied: string | null };
  const counts = new Map<string, number>();
  for (const a of (appsRows ?? []) as AppLite[]) {
    const level =
      (a.enroleeNumber && classLevelByEnrolee.get(a.enroleeNumber)) ||
      a.levelApplied?.trim() ||
      'Unknown';
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
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
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
  limit: number
): Promise<ExpiringDocRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  // Records is enrolled-only per KD #51 — narrow to the enrolled set so the
  // expiring-docs panel doesn't surface pre-enrolment funnel applicants.
  const { data: statusRows, error: statusErr } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus')
    .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
  if (statusErr) {
    console.error(
      '[sis] getExpiringDocuments status fetch failed:',
      statusErr.message
    );
    return [];
  }
  const enrolledNumbers = (
    (statusRows ?? []) as { enroleeNumber: string | null }[]
  )
    .map((s) => s.enroleeNumber)
    .filter((v): v is string => v !== null);
  if (enrolledNumbers.length === 0) return [];

  const expiringSlots = DOCUMENT_SLOTS.filter((s) => s.expires);
  const selectCols = [
    'enroleeNumber',
    ...expiringSlots.map((s) => `${s.key}Expiry`),
  ].join(', ');

  const [docsRes, appsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(selectCols)
      .in('enroleeNumber', enrolledNumbers),
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, enroleeFullName, firstName, lastName')
      .in('enroleeNumber', enrolledNumbers),
  ]);

  if (docsRes.error || appsRes.error) {
    console.error(
      '[sis] getExpiringDocuments fetch failed:',
      docsRes.error?.message ?? appsRes.error?.message
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

  const rows = (docsRes.data ?? []) as unknown as Array<
    Record<string, string | null>
  >;
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
  limit: number = 8
): Promise<ExpiringDocRow[]> {
  return unstable_cache(
    loadExpiringDocumentsUncached,
    ['sis', 'expiring-documents', ayCode, String(windowDays), String(limit)],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
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
async function loadRecentSisActivityUncached(
  limit: number
): Promise<RecentActivityRow[]> {
  const supabase = createAdmissionsClient();

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, actor_email, entity_id, created_at, context')
    .or(
      'action.like.sis.%,action.like.student.%,action.like.enrolment.%,action.like.ay.%,action.like.pfile.%'
    )
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
  { tags: ['sis'], revalidate: 120 }
);

export function getRecentSisActivity(
  limit: number = 8
): Promise<RecentActivityRow[]> {
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

async function loadRecordsKpisForRange(
  input: RangeInput
): Promise<RecordsRangeKpis> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const prefix = prefixFor(input.ayCode);

  // Resolve AY id once. `section_students` has no `academic_year_id` column
  // — AY-scoping requires a `sections!inner` join. Without this, counts
  // span every AY whose enrollment_date falls in the range, contaminating
  // the dashboard when multiple AYs coexist (e.g. AY9999 test + AY2026
  // production). When the AY can't be resolved, return zero counts.
  // Uses request-scoped cache so parallel helpers share one round-trip.
  const ayId = await getAyIdByCode(input.ayCode);

  if (ayId == null) {
    return {
      enrollmentsInRange: 0,
      lateEnroleesInRange: 0,
      withdrawalsInRange: 0,
      activeEnrolled: 0,
      expiringSoon: 0,
    };
  }

  // KD #68: late enrollees are real new enrollments tagged for term-of-entry
  // visibility — count them in both `enrollmentsInRange` (so the headline
  // KPI is honest) and `lateEnroleesInRange` (so the breakdown surfaces).
  const [enrolRes, lateRes, withdrawRes, activeRes, docsRes] =
    await Promise.all([
      service
        .from('section_students')
        .select('id, sections!inner(academic_year_id)', {
          count: 'exact',
          head: true,
        })
        .eq('sections.academic_year_id', ayId)
        .in('enrollment_status', ['active', 'late_enrollee'])
        .gte('enrollment_date', input.from)
        .lte('enrollment_date', input.to),
      service
        .from('section_students')
        .select('id, sections!inner(academic_year_id)', {
          count: 'exact',
          head: true,
        })
        .eq('sections.academic_year_id', ayId)
        .eq('enrollment_status', 'late_enrollee')
        .gte('enrollment_date', input.from)
        .lte('enrollment_date', input.to),
      service
        .from('section_students')
        .select('id, sections!inner(academic_year_id)', {
          count: 'exact',
          head: true,
        })
        .eq('sections.academic_year_id', ayId)
        .eq('enrollment_status', 'withdrawn')
        .gte('withdrawal_date', input.from)
        .lte('withdrawal_date', input.to),
      service
        .from('section_students')
        .select('id, sections!inner(academic_year_id)', {
          count: 'exact',
          head: true,
        })
        .eq('sections.academic_year_id', ayId)
        .in('enrollment_status', ['active', 'late_enrollee']),
      // Records is enrolled-only per KD #51 — narrow the docs scan to the
      // enrolled set so the "Docs expiring ≤60d" KPI doesn't count slots
      // belonging to pre-enrolment funnel applicants. Without this filter
      // the card was showing 47 when the drill (which IS enrolled-filtered)
      // would show 3 — classic card-vs-drill disagreement.
      (async () => {
        const { data: enrolledStatus } = await admissions
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, applicationStatus')
          .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
        const enrolledNumbers = (
          (enrolledStatus ?? []) as { enroleeNumber: string | null }[]
        )
          .map((s) => s.enroleeNumber)
          .filter((v): v is string => v !== null);
        if (enrolledNumbers.length === 0) {
          return {
            data: [] as Array<Record<string, string | null>>,
            error: null,
          };
        }
        return admissions
          .from(`${prefix}_enrolment_documents`)
          .select(
            [
              'enroleeNumber',
              ...DOCUMENT_SLOTS.flatMap((s) =>
                s.expires ? [`${s.key}Expiry`] : []
              ),
            ].join(', ')
          )
          .in('enroleeNumber', enrolledNumbers);
      })(),
    ]);

  type DocRow = Record<string, string | null>;
  // "Docs expiring ≤60d" is a LIVE state, not range activity — anchor the
  // window to TODAY, not the picker's range endpoint. The drill
  // (lib/sis/drill.ts::enrichWithDocs) already anchors today → today+60d;
  // anchoring the count to the range end made the card diverge from the drill
  // whenever the picker range wasn't "ending today". Matches the drill's
  // raw `new Date()` exactly so count == drill rows.
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + 60);
  let expiringSoon = 0;
  for (const row of (docsRes.data ?? []) as unknown as DocRow[]) {
    for (const slot of DOCUMENT_SLOTS) {
      if (!slot.expires) continue;
      const exp = row[`${slot.key}Expiry`];
      if (!exp) continue;
      // Slice to the date portion first so a full-ISO timestamp still yields its
      // date (parseLocalDate is strict ^\d{4}-\d{2}-\d{2}$); bare dates are
      // unaffected. Mirrors lib/sis/drill.ts::enrichWithDocs so count == drill.
      const d = parseLocalDate(exp.slice(0, 10));
      if (d && d >= today && d <= windowEnd) expiringSoon += 1;
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
  input: RangeInput
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
    delta: computeDelta(
      current.enrollmentsInRange,
      comparison.enrollmentsInRange
    ),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getRecordsKpisRange(
  input: RangeInput
): Promise<RangeResult<RecordsRangeKpis>> {
  return unstable_cache(
    loadRecordsKpisRangeUncached,
    [
      'sis',
      'records-kpis-range',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS }
  )(input);
}

// Enrollment + withdrawal velocity — daily-bucketed.

function bucketByDay(
  rows: { ts: string }[],
  from: string,
  to: string
): VelocityPoint[] {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  if (!fromDate || !toDate) return [];
  const length = daysInRange({ from, to });
  const buckets = new Array(length).fill(0) as number[];
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(
      fromDate.getFullYear(),
      fromDate.getMonth(),
      fromDate.getDate() + i
    );
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
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  const service = createServiceClient();
  const hasCmp = input.cmpFrom != null && input.cmpTo != null;
  const earliest =
    hasCmp && input.cmpFrom! < input.from ? input.cmpFrom! : input.from;
  const latest = hasCmp && input.to < input.cmpTo! ? input.cmpTo! : input.to;

  const ayId = await getAyIdByCode(input.ayCode);
  if (ayId == null) {
    return {
      current: [],
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }

  // KD #68: late enrollees are real enrollments — include them so the
  // velocity chart aligns with the New Enrollments KPI. AY-scope via
  // sections!inner so counts don't span other AYs.
  const { data } = await service
    .from('section_students')
    .select('enrollment_date, sections!inner(academic_year_id)')
    .eq('sections.academic_year_id', ayId)
    .in('enrollment_status', ['active', 'late_enrollee'])
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
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadEnrollmentVelocityRangeUncached,
    [
      'sis',
      'enrollment-velocity',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS }
  )(input);
}

// Withdrawal velocity — symmetric sibling to enrollment velocity.
// Reads `section_students.withdrawal_date` for rows in the 'withdrawn'
// status, range-scoped and bucketed daily.

async function loadWithdrawalVelocityRangeUncached(
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  const service = createServiceClient();
  const hasCmp = input.cmpFrom != null && input.cmpTo != null;
  const earliest =
    hasCmp && input.cmpFrom! < input.from ? input.cmpFrom! : input.from;
  const latest = hasCmp && input.to < input.cmpTo! ? input.cmpTo! : input.to;

  const ayId = await getAyIdByCode(input.ayCode);
  if (ayId == null) {
    return {
      current: [],
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }

  // AY-scope via sections!inner so counts don't span other AYs.
  const { data } = await service
    .from('section_students')
    .select('withdrawal_date, sections!inner(academic_year_id)')
    .eq('sections.academic_year_id', ayId)
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
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadWithdrawalVelocityRangeUncached,
    [
      'sis',
      'withdrawal-velocity',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS }
  )(input);
}

// Audit activity by module — for SIS admin dashboard.

export type AuditModulePoint = {
  module: string;
  count: number;
};

async function loadAuditActivityByModuleUncached(
  input: RangeInput
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

  async function countsFor(
    from: string,
    to: string
  ): Promise<AuditModulePoint[]> {
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
      })
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
  input: RangeInput
): Promise<RangeResult<AuditModulePoint[]>> {
  return unstable_cache(
    loadAuditActivityByModuleUncached,
    [
      'sis',
      'audit-by-module',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { tags: ['sis'], revalidate: 120 }
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
  ayCode: string
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
  const sectionIds = ((sectionsData ?? []) as { id: string }[]).map(
    (r) => r.id
  );

  const prefix = prefixFor(ayCode);
  type EnrolledRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    applicationUpdatedDate: string | null;
    classLevel: string | null;
    classSection: string | null;
    levelApplied: string | null;
  };
  const [enrolledRes, ssRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_status`)
      .select(
        'enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel, classSection, levelApplied'
      )
      .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']),
    sectionIds.length > 0
      ? service
          .from('section_students')
          .select('enrolee_number')
          .in('section_id', sectionIds)
          .neq('enrollment_status', 'withdrawn')
      : Promise.resolve({ data: [] as { enrolee_number: string | null }[] }),
  ]);

  const enrolledRows = (enrolledRes.data ?? []) as EnrolledRow[];
  const assignedEnrolees = new Set(
    ((ssRes.data ?? []) as { enrolee_number: string | null }[])
      .map((r) => r.enrolee_number)
      .filter((v): v is string => v !== null)
  );

  // A student is truly "without a section" only if BOTH:
  // 1. They have no section_students row (not in assignedEnrolees via enrolee_number), AND
  // 2. admissions has no classSection recorded for them.
  // A student with classSection set but a NULL enrolee_number in section_students
  // (a known seeder gap — KD #83) has already been assigned and should not appear here.
  const unassignedEnrolees = enrolledRows
    .filter((r) => !r.classSection)
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
    .select(
      'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, created_at'
    )
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
    const enrollmentDate =
      status?.applicationUpdatedDate ?? app?.created_at ?? null;
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
  out.sort(
    (a, b) => (b.daysSinceEnrollment ?? 0) - (a.daysSinceEnrollment ?? 0)
  );
  return out;
}

export function getClassAssignmentReadiness(
  ayCode: string
): Promise<ClassAssignmentReadinessRow[]> {
  return unstable_cache(
    () => loadClassAssignmentReadinessUncached(ayCode),
    ['sis-dashboard', 'class-assignment-readiness', ayCode],
    { revalidate: 60, tags: tag(ayCode) }
  )();
}

export async function getActivityByActor(range?: {
  from: string;
  to: string;
}): Promise<Awaited<ReturnType<typeof loadActorActivity>>> {
  // Cache wrapper keyed by range
  const key = [
    'sis-dashboard',
    'activity-by-actor',
    range?.from ?? 'all',
    range?.to ?? 'all',
  ];
  return unstable_cache(() => loadActorActivity(range), key, {
    revalidate: 60,
    tags: ['sis-dashboard', 'audit-log'],
  })();
}

// ──────────────────────────────────────────────────────────────────────────
// Audit daily trend — events bucketed by day over the selected range.
// ──────────────────────────────────────────────────────────────────────────

export type AuditDailyTrendResult = RangeResult<VelocityPoint[]>;

async function loadAuditDailyForRange(
  from: string,
  to: string
): Promise<VelocityPoint[]> {
  const service = createServiceClient();
  const rows = await fetchAllPages<{ created_at: string }>((f, t) =>
    service
      .from('audit_log')
      .select('created_at')
      .gte('created_at', `${from}T00:00:00+08:00`)
      .lte('created_at', `${to}T23:59:59+08:00`)
      .range(f, t)
  );
  return bucketByDay(
    rows.map((r) => ({ ts: r.created_at })),
    from,
    to
  );
}

async function loadAuditDailyTrendUncached(
  input: RangeInput
): Promise<AuditDailyTrendResult> {
  const current = await loadAuditDailyForRange(input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = await loadAuditDailyForRange(input.cmpFrom, input.cmpTo);
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

export function getAuditDailyTrend(
  input: RangeInput
): Promise<AuditDailyTrendResult> {
  return unstable_cache(
    loadAuditDailyTrendUncached,
    [
      'sis',
      'audit-daily-trend',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { tags: ['sis'], revalidate: 120 }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Grade change request pipeline — funnel of the approval workflow.
// ──────────────────────────────────────────────────────────────────────────

export type GradeChangePipeline = {
  submitted: number;
  approved: number;
  rejected: number;
  applied: number;
  undoneRejections: number;
};

async function loadGradeChangePipelineUncached(
  input: RangeInput
): Promise<GradeChangePipeline> {
  const service = createServiceClient();
  const fromTs = `${input.from}T00:00:00+08:00`;
  const toTs = `${input.to}T23:59:59+08:00`;

  const countFor = async (action: string) => {
    const { count } = await service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', action)
      .gte('created_at', fromTs)
      .lte('created_at', toTs);
    return count ?? 0;
  };

  const [submitted, approved, rejected, applied, undoneRejections] =
    await Promise.all([
      countFor('grade_change_requested'),
      countFor('grade_change_approved'),
      countFor('grade_change_rejected'),
      countFor('grade_change_applied'),
      countFor('grade_change_undo_rejection'),
    ]);

  return { submitted, approved, rejected, applied, undoneRejections };
}

export function getGradeChangePipeline(
  input: RangeInput
): Promise<GradeChangePipeline> {
  return unstable_cache(
    loadGradeChangePipelineUncached,
    ['sis', 'grade-change-pipeline', input.ayCode, input.from, input.to],
    { tags: ['sis'], revalidate: 120 }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Top audit actions — most frequent action strings in the range.
// ──────────────────────────────────────────────────────────────────────────

export type TopAuditAction = { action: string; count: number };

async function loadTopAuditActionsUncached(
  input: RangeInput
): Promise<TopAuditAction[]> {
  const service = createServiceClient();
  const rows = await fetchAllPages<{ action: string }>((f, t) =>
    service
      .from('audit_log')
      .select('action')
      .gte('created_at', `${input.from}T00:00:00+08:00`)
      .lte('created_at', `${input.to}T23:59:59+08:00`)
      .range(f, t)
  );

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);

  return Array.from(counts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export function getTopAuditActions(
  input: RangeInput
): Promise<TopAuditAction[]> {
  return unstable_cache(
    loadTopAuditActionsUncached,
    ['sis', 'top-audit-actions', input.ayCode, input.from, input.to],
    { tags: ['sis'], revalidate: 120 }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Auth event counts — staff logins + parent session events in the range.
// ──────────────────────────────────────────────────────────────────────────

export type AuthEventCounts = {
  staffLogins: number;
  parentSessionsIssued: number;
  parentSessionsCleared: number;
};

async function loadAuthEventCountsUncached(
  input: RangeInput
): Promise<AuthEventCounts> {
  const service = createServiceClient();
  const fromTs = `${input.from}T00:00:00+08:00`;
  const toTs = `${input.to}T23:59:59+08:00`;

  const countFor = async (action: string) => {
    const { count } = await service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', action)
      .gte('created_at', fromTs)
      .lte('created_at', toTs);
    return count ?? 0;
  };

  const [staffLogins, parentSessionsIssued, parentSessionsCleared] =
    await Promise.all([
      countFor('user.login'),
      countFor('parent.session.issued'),
      countFor('parent.session.cleared'),
    ]);

  return { staffLogins, parentSessionsIssued, parentSessionsCleared };
}

export function getAuthEventCounts(
  input: RangeInput
): Promise<AuthEventCounts> {
  return unstable_cache(
    loadAuthEventCountsUncached,
    ['sis', 'auth-event-counts', input.ayCode, input.from, input.to],
    { tags: ['sis'], revalidate: 120 }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Structural changes feed — last 5 high-impact admin actions (cross-range).
// ──────────────────────────────────────────────────────────────────────────

export const STRUCTURAL_ACTIONS = [
  'school_config.update',
  'template.apply',
  'environment.switch',
  'environment.seed',
  'environment.topup',
  'user.role.update',
  'user.create',
  'ay.create',
  'ay.switch_current',
  'ay.delete',
  'ay.accepting_applications.toggle',
  'approver.assign',
  'approver.revoke',
] as const;

export type StructuralChangeRow = {
  id: string;
  action: string;
  actorEmail: string;
  createdAt: string;
  context: Record<string, unknown>;
};

async function loadStructuralChangeFeedUncached(): Promise<
  StructuralChangeRow[]
> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('audit_log')
    .select('id, action, actor_email, created_at, context')
    .in('action', [...STRUCTURAL_ACTIONS])
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[sis] getStructuralChangeFeed fetch failed:', error.message);
    return [];
  }

  type AuditLite = {
    id: string;
    action: string;
    actor_email: string | null;
    created_at: string;
    context: Record<string, unknown> | null;
  };

  return ((data ?? []) as AuditLite[]).map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email ?? '(unknown)',
    createdAt: r.created_at,
    context: r.context ?? {},
  }));
}

const loadStructuralChangeFeedCached = unstable_cache(
  loadStructuralChangeFeedUncached,
  ['sis', 'structural-change-feed'],
  { tags: ['sis'], revalidate: 120 }
);

export function getStructuralChangeFeed(): Promise<StructuralChangeRow[]> {
  return loadStructuralChangeFeedCached();
}

// ──────────────────────────────────────────────────────────────────────────
// Hub KPIs — at-a-glance counts for the admin hub tab.
// ──────────────────────────────────────────────────────────────────────────

export type HubKpis = {
  enrolledStudents: number;
  activeSections: number;
  pendingChangeRequests: number;
  openPublicationWindows: number;
};

async function loadHubKpisUncached(ayCode: string): Promise<HubKpis> {
  const service = createServiceClient();
  const ayId = await getAyIdByCode(ayCode);
  if (ayId == null) {
    return {
      enrolledStudents: 0,
      activeSections: 0,
      pendingChangeRequests: 0,
      openPublicationWindows: 0,
    };
  }

  const { data: sectionsData } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = ((sectionsData ?? []) as { id: string }[]).map(
    (r) => r.id
  );

  const now = new Date().toISOString();

  const [enrolledRes, sectionsRes, pendingCrRes, openPubRes] =
    await Promise.all([
      sectionIds.length > 0
        ? service
            .from('section_students')
            .select('id', { count: 'exact', head: true })
            .in('section_id', sectionIds)
            .in('enrollment_status', ['active', 'late_enrollee'])
        : Promise.resolve({ count: 0, data: null, error: null }),
      service
        .from('sections')
        .select('id', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
      service
        .from('grade_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      sectionIds.length > 0
        ? service
            .from('report_card_publications')
            .select('id', { count: 'exact', head: true })
            .in('section_id', sectionIds)
            .lte('publish_from', now)
            .gte('publish_until', now)
        : Promise.resolve({ count: 0, data: null, error: null }),
    ]);

  return {
    enrolledStudents: enrolledRes.count ?? 0,
    activeSections: sectionsRes.count ?? 0,
    pendingChangeRequests: pendingCrRes.count ?? 0,
    openPublicationWindows: openPubRes.count ?? 0,
  };
}

export function getHubKpis(ayCode: string): Promise<HubKpis> {
  return unstable_cache(loadHubKpisUncached, ['sis', 'hub-kpis', ayCode], {
    tags: tag(ayCode),
    revalidate: 120,
  })(ayCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Upcoming calendar events — next N events from the current AY's terms.
// ──────────────────────────────────────────────────────────────────────────

export type UpcomingCalendarEvent = {
  id: string;
  label: string;
  startDate: string;
  endDate: string | null;
  category: string;
  tentative: boolean;
};

async function loadUpcomingCalendarEventsUncached(
  ayCode: string,
  limit: number
): Promise<UpcomingCalendarEvent[]> {
  const service = createServiceClient();
  const ayId = await getAyIdByCode(ayCode);
  if (ayId == null) return [];

  const { data: termsData } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((termsData ?? []) as { id: string }[]).map((r) => r.id);
  if (termIds.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await service
    .from('calendar_events')
    .select('id, label, start_date, end_date, category, tentative')
    .in('term_id', termIds)
    .gte('start_date', today)
    .order('start_date', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(
      '[sis] getUpcomingCalendarEvents fetch failed:',
      error.message
    );
    return [];
  }

  type EventLite = {
    id: string;
    label: string;
    start_date: string;
    end_date: string | null;
    category: string;
    tentative: boolean;
  };

  return ((data ?? []) as EventLite[]).map((r) => ({
    id: r.id,
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    category: r.category,
    tentative: r.tentative ?? false,
  }));
}

export function getUpcomingCalendarEvents(
  ayCode: string,
  limit: number = 5
): Promise<UpcomingCalendarEvent[]> {
  return unstable_cache(
    loadUpcomingCalendarEventsUncached,
    ['sis', 'upcoming-calendar-events', ayCode, String(limit)],
    { tags: tag(ayCode), revalidate: 120 }
  )(ayCode, limit);
}

// ──────────────────────────────────────────────────────────────────────────
// Section staffing coverage — sections that have a form adviser assigned.
// ──────────────────────────────────────────────────────────────────────────

export type SectionStaffingCoverage = {
  total: number;
  withAdviser: number;
};

async function loadSectionStaffingCoverageUncached(
  ayCode: string
): Promise<SectionStaffingCoverage> {
  const service = createServiceClient();
  const ayId = await getAyIdByCode(ayCode);
  if (ayId == null) return { total: 0, withAdviser: 0 };

  const { data: sectionsData } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = ((sectionsData ?? []) as { id: string }[]).map(
    (r) => r.id
  );
  const total = sectionIds.length;
  if (total === 0) return { total: 0, withAdviser: 0 };

  const { data: assignmentsData } = await service
    .from('teacher_assignments')
    .select('section_id')
    .in('section_id', sectionIds)
    .eq('role', 'form_adviser');

  const advisedSectionIds = new Set(
    ((assignmentsData ?? []) as { section_id: string }[]).map(
      (r) => r.section_id
    )
  );

  return { total, withAdviser: advisedSectionIds.size };
}

export function getSectionStaffingCoverage(
  ayCode: string
): Promise<SectionStaffingCoverage> {
  return unstable_cache(
    loadSectionStaffingCoverageUncached,
    ['sis', 'section-staffing-coverage', ayCode],
    { tags: tag(ayCode), revalidate: 120 }
  )(ayCode);
}

import { unstable_cache } from 'next/cache';

import { DOCUMENT_SLOTS, resolveStatus, type DocumentGroup } from '@/lib/p-files/document-config';
import { STAGE_COLUMN_MAP, STAGE_KEYS, STAGE_LABELS, type StageKey } from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

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
  // Plus the parent-email gate columns that drive `conditional` slots.
  const selectCols = new Set<string>(['enroleeNumber', 'fatherEmail', 'guardianEmail']);
  for (const slot of DOCUMENT_SLOTS) {
    selectCols.add(slot.key);
    selectCols.add(`${slot.key}Status`);
    if (slot.expires) selectCols.add(`${slot.key}Expiry`);
  }

  // Documents table holds url + status + expiry; conditional columns
  // (fatherEmail / guardianEmail) live on the applications row. Fetch both.
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
      .select('enroleeNumber, fatherEmail, guardianEmail'),
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
        const gateValue = gate?.[slot.conditional as 'fatherEmail' | 'guardianEmail'] ?? null;
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

  // Sort in HFSE canonical order (P1..P6, S1..S4), then Unknown last.
  const canonicalOrder = [
    'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
    'Secondary 1', 'Secondary 2', 'Secondary 3', 'Secondary 4',
  ];
  const entries = Array.from(counts.entries());
  entries.sort(([a], [b]) => {
    const ai = canonicalOrder.indexOf(a);
    const bi = canonicalOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
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

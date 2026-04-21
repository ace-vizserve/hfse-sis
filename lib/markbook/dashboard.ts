import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

// Markbook dashboard aggregators — grading-specific lens.
//
// Mirrors the shape of `lib/sis/dashboard.ts` (hoisted uncached helpers +
// per-AY cache wrapper). Tag: `markbook:${ayId}` — mutating routes (sheet
// lock/unlock, grade entry PATCH, publication create/delete, change-request
// transitions) are the invalidation triggers if freshness > 60s becomes
// insufficient. Not wired yet; TTL covers it.

const CACHE_TTL_SECONDS = 60;

function tag(academicYearId: string): string[] {
  return ['markbook', `markbook:${academicYearId}`];
}

// ──────────────────────────────────────────────────────────────────────────
// Grade distribution — histogram of quarterly_grade for the current term.
// ──────────────────────────────────────────────────────────────────────────

// HFSE-standard mastery bands (DepEd Phil. Sec style — widely used in intl
// schools following the K–12 grading framework). Buckets are inclusive-low,
// inclusive-high except the last which is 95–100.
export const GRADE_BANDS = [
  { key: 'dnm', label: '< 75 (DNM)', lo: 0, hi: 74 },
  { key: 'fs', label: '75–79 (FS)', lo: 75, hi: 79 },
  { key: 's', label: '80–84 (S)', lo: 80, hi: 84 },
  { key: 'vs', label: '85–89 (VS)', lo: 85, hi: 89 },
  { key: 'o', label: '90–100 (O)', lo: 90, hi: 100 },
] as const;

export type GradeBand = (typeof GRADE_BANDS)[number]['key'];

export type GradeBucket = {
  key: GradeBand;
  label: string;
  count: number;
};

async function loadGradeDistributionUncached(
  academicYearId: string,
  termId: string | null,
): Promise<GradeBucket[]> {
  const service = createServiceClient();

  // Resolve term scope. If termId given, use it; else resolve current term
  // via academic_years.current_term_id or fall back to most recent term.
  let effectiveTermId = termId;
  if (!effectiveTermId) {
    const { data: termRow } = await service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', academicYearId)
      .order('term_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    effectiveTermId = (termRow?.id as string | undefined) ?? null;
  }

  if (!effectiveTermId) return emptyGradeBuckets();

  // Sheet IDs for the target term → entries for those sheets.
  const { data: sheetRows, error: sheetErr } = await service
    .from('grading_sheets')
    .select('id')
    .eq('term_id', effectiveTermId);
  if (sheetErr) {
    console.error('[markbook] getGradeDistribution sheets fetch failed:', sheetErr.message);
    return emptyGradeBuckets();
  }
  const sheetIds = (sheetRows ?? []).map((r) => r.id as string);
  if (sheetIds.length === 0) return emptyGradeBuckets();

  const { data: entryRows, error: entryErr } = await service
    .from('grade_entries')
    .select('quarterly_grade')
    .in('grading_sheet_id', sheetIds)
    .not('quarterly_grade', 'is', null);
  if (entryErr) {
    console.error('[markbook] getGradeDistribution entries fetch failed:', entryErr.message);
    return emptyGradeBuckets();
  }

  const buckets: GradeBucket[] = GRADE_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    count: 0,
  }));

  for (const row of entryRows ?? []) {
    const g = row.quarterly_grade as number | null;
    if (g == null) continue;
    const idx = GRADE_BANDS.findIndex((b) => g >= b.lo && g <= b.hi);
    if (idx >= 0) buckets[idx].count += 1;
  }

  return buckets;
}

export function getGradeDistribution(
  academicYearId: string,
  termId: string | null = null,
): Promise<GradeBucket[]> {
  return unstable_cache(
    loadGradeDistributionUncached,
    ['markbook', 'grade-distribution', academicYearId, termId ?? 'current'],
    { tags: tag(academicYearId), revalidate: CACHE_TTL_SECONDS },
  )(academicYearId, termId);
}

function emptyGradeBuckets(): GradeBucket[] {
  return GRADE_BANDS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
}

// ──────────────────────────────────────────────────────────────────────────
// Sheet lock progress by term — stacked locked/open per term.
// ──────────────────────────────────────────────────────────────────────────

export type TermLockProgress = {
  termNumber: number;
  termLabel: string;
  locked: number;
  open: number;
};

async function loadSheetLockProgressByTermUncached(
  academicYearId: string,
): Promise<TermLockProgress[]> {
  const service = createServiceClient();

  const [termsRes, sheetsRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', academicYearId)
      .order('term_number', { ascending: true }),
    service.from('grading_sheets').select('term_id, is_locked'),
  ]);

  if (termsRes.error || sheetsRes.error) {
    console.error(
      '[markbook] getSheetLockProgressByTerm fetch failed:',
      termsRes.error?.message ?? sheetsRes.error?.message,
    );
    return [];
  }

  type TermRow = { id: string; term_number: number };
  type SheetRow = { term_id: string; is_locked: boolean };
  const terms = (termsRes.data ?? []) as TermRow[];
  const sheets = (sheetsRes.data ?? []) as SheetRow[];

  const termIds = new Set(terms.map((t) => t.id));
  const counts = new Map<string, { locked: number; open: number }>();
  for (const t of terms) counts.set(t.id, { locked: 0, open: 0 });

  for (const s of sheets) {
    if (!termIds.has(s.term_id)) continue;
    const bucket = counts.get(s.term_id)!;
    if (s.is_locked) bucket.locked += 1;
    else bucket.open += 1;
  }

  return terms.map((t) => {
    const c = counts.get(t.id)!;
    return {
      termNumber: t.term_number,
      termLabel: `Term ${t.term_number}`,
      locked: c.locked,
      open: c.open,
    };
  });
}

export function getSheetLockProgressByTerm(
  academicYearId: string,
): Promise<TermLockProgress[]> {
  return unstable_cache(
    loadSheetLockProgressByTermUncached,
    ['markbook', 'sheet-lock-progress', academicYearId],
    { tags: tag(academicYearId), revalidate: CACHE_TTL_SECONDS },
  )(academicYearId);
}

// ──────────────────────────────────────────────────────────────────────────
// Change request summary — last N days, status breakdown + avg decision hours.
// ──────────────────────────────────────────────────────────────────────────

export type ChangeRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'cancelled';

export type ChangeRequestSummary = {
  byStatus: Record<ChangeRequestStatus, number>;
  total: number;
  avgDecisionHours: number | null;
  windowDays: number;
};

async function loadChangeRequestSummaryUncached(
  days: number,
): Promise<ChangeRequestSummary> {
  const service = createServiceClient();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const { data, error } = await service
    .from('grade_change_requests')
    .select('status, requested_at, reviewed_at')
    .gte('requested_at', sinceIso);

  const byStatus: Record<ChangeRequestStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    applied: 0,
    cancelled: 0,
  };

  if (error) {
    console.error('[markbook] getChangeRequestSummary fetch failed:', error.message);
    return { byStatus, total: 0, avgDecisionHours: null, windowDays: days };
  }

  type Row = {
    status: ChangeRequestStatus;
    requested_at: string;
    reviewed_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  let total = 0;
  let decidedCount = 0;
  let totalDecisionMs = 0;
  for (const r of rows) {
    total += 1;
    if (r.status in byStatus) byStatus[r.status] += 1;
    if (r.reviewed_at && (r.status === 'approved' || r.status === 'rejected' || r.status === 'applied')) {
      const req = Date.parse(r.requested_at);
      const rev = Date.parse(r.reviewed_at);
      if (!Number.isNaN(req) && !Number.isNaN(rev) && rev >= req) {
        totalDecisionMs += rev - req;
        decidedCount += 1;
      }
    }
  }

  const avgDecisionHours =
    decidedCount > 0
      ? Math.round((totalDecisionMs / decidedCount / (1000 * 60 * 60)) * 10) / 10
      : null;

  return { byStatus, total, avgDecisionHours, windowDays: days };
}

const loadChangeRequestSummary = unstable_cache(
  loadChangeRequestSummaryUncached,
  ['markbook', 'change-request-summary'],
  { tags: ['markbook'], revalidate: CACHE_TTL_SECONDS },
);

export function getChangeRequestSummary(days: number = 30): Promise<ChangeRequestSummary> {
  return loadChangeRequestSummary(days);
}

// ──────────────────────────────────────────────────────────────────────────
// Publication coverage by term — "of N sections, how many published for T?"
// ──────────────────────────────────────────────────────────────────────────

export type TermPubCoverage = {
  termNumber: number;
  termLabel: string;
  sections: number;
  published: number;
};

async function loadPublicationCoverageUncached(
  academicYearId: string,
): Promise<TermPubCoverage[]> {
  const service = createServiceClient();

  const [termsRes, sectionsRes, pubsRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', academicYearId)
      .order('term_number', { ascending: true }),
    service.from('sections').select('id').eq('academic_year_id', academicYearId),
    service
      .from('report_card_publications')
      .select('term_id, section_id'),
  ]);

  if (termsRes.error || sectionsRes.error || pubsRes.error) {
    console.error(
      '[markbook] getPublicationCoverage fetch failed:',
      termsRes.error?.message ?? sectionsRes.error?.message ?? pubsRes.error?.message,
    );
    return [];
  }

  type TermRow = { id: string; term_number: number };
  const terms = (termsRes.data ?? []) as TermRow[];
  const sectionIds = new Set((sectionsRes.data ?? []).map((s) => s.id as string));
  const sectionsCount = sectionIds.size;

  // Count unique (section, term) publications, limited to this AY's sections.
  type PubRow = { term_id: string; section_id: string };
  const pubsByTerm = new Map<string, Set<string>>();
  for (const p of (pubsRes.data ?? []) as PubRow[]) {
    if (!sectionIds.has(p.section_id)) continue;
    const set = pubsByTerm.get(p.term_id) ?? new Set<string>();
    set.add(p.section_id);
    pubsByTerm.set(p.term_id, set);
  }

  return terms.map((t) => ({
    termNumber: t.term_number,
    termLabel: `Term ${t.term_number}`,
    sections: sectionsCount,
    published: pubsByTerm.get(t.id)?.size ?? 0,
  }));
}

export function getPublicationCoverage(academicYearId: string): Promise<TermPubCoverage[]> {
  return unstable_cache(
    loadPublicationCoverageUncached,
    ['markbook', 'publication-coverage', academicYearId],
    { tags: tag(academicYearId), revalidate: CACHE_TTL_SECONDS },
  )(academicYearId);
}

// ──────────────────────────────────────────────────────────────────────────
// Recent Markbook activity — last N markbook-related audit entries.
// ──────────────────────────────────────────────────────────────────────────

export type RecentMarkbookActivityRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  entityId: string | null;
  createdAt: string;
};

// Actions that represent Markbook operator activity. Kept in sync with
// `lib/audit/log-action.ts::AuditAction`. Excludes sis.* / pfile.* / ay.* /
// approver.* which belong to other module dashboards.
const MARKBOOK_ACTION_PREFIXES = [
  'sheet.',
  'entry.',
  'totals.',
  'assignment.',
  'attendance.',
  'comment.',
  'publication.',
  'grade_change_',
  'grade_correction',
  'student.',
] as const;

async function loadRecentMarkbookActivityUncached(
  limit: number,
): Promise<RecentMarkbookActivityRow[]> {
  const service = createServiceClient();

  // OR chain: actions starting with any markbook-owned prefix. Supabase's
  // `or()` takes a comma-separated string of filter exprs.
  const orClause = MARKBOOK_ACTION_PREFIXES
    .map((p) => `action.like.${p}%`)
    .join(',');

  const { data, error } = await service
    .from('audit_log')
    .select('id, action, actor_email, entity_id, created_at')
    .or(orClause)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[markbook] getRecentMarkbookActivity fetch failed:', error.message);
    return [];
  }

  type AuditLite = {
    id: string;
    action: string;
    actor_email: string | null;
    entity_id: string | null;
    created_at: string;
  };
  return ((data ?? []) as AuditLite[]).map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email,
    entityId: r.entity_id,
    createdAt: r.created_at,
  }));
}

const loadRecentMarkbookActivity = unstable_cache(
  loadRecentMarkbookActivityUncached,
  ['markbook', 'recent-activity'],
  { tags: ['markbook'], revalidate: 120 },
);

export function getRecentMarkbookActivity(
  limit: number = 8,
): Promise<RecentMarkbookActivityRow[]> {
  return loadRecentMarkbookActivity(limit);
}

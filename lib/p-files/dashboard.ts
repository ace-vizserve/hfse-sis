import { unstable_cache } from 'next/cache';

import { DOCUMENT_SLOTS, resolveStatus } from '@/lib/p-files/document-config';
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
import { getExpiringDocuments } from '@/lib/sis/dashboard';
import { compareLevelLabels } from '@/lib/sis/levels';
import type { PriorityPayload } from '@/lib/dashboard/priority';

// P-Files dashboard aggregators — document-repository lens.
//
// Complementary to the Records dashboard: Records cares about "which stage
// is the student in"; P-Files cares about "are their documents on file and
// fresh". Both read the same `ay{YY}_enrolment_documents` table; the
// visualizations differ.
//
// Cache pattern mirrors lib/sis/dashboard.ts: inner `load*Uncached`
// hoisted to module scope; wrapper composed per-call for per-AY tags.

const CACHE_TTL_SECONDS = 600;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['p-files-dashboard', `p-files-dashboard:${ayCode}`];
}

// ──────────────────────────────────────────────────────────────────────────
// Completion by level — stacked per-level breakdown (P1..S4 + Unknown).
// ──────────────────────────────────────────────────────────────────────────

export type LevelCompletionRow = {
  level: string;
  valid: number;
  pending: number;
  rejected: number;
  missing: number;
};

async function loadCompletionByLevelUncached(ayCode: string): Promise<LevelCompletionRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appsRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, levelApplied, fatherEmail, guardianEmail, stpApplicationType'),
    supabase.from(`${prefix}_enrolment_status`).select('enroleeNumber, classLevel'),
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(
        [
          'enroleeNumber',
          ...DOCUMENT_SLOTS.flatMap((s) =>
            s.expires
              ? [s.key, `${s.key}Status`, `${s.key}Expiry`]
              : [s.key, `${s.key}Status`],
          ),
        ].join(', '),
      ),
  ]);

  if (appsRes.error || statusRes.error || docsRes.error) {
    console.error(
      '[p-files] getCompletionByLevel fetch failed:',
      appsRes.error?.message ?? statusRes.error?.message ?? docsRes.error?.message,
    );
    return [];
  }

  type AppRow = {
    enroleeNumber: string | null;
    levelApplied: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
    stpApplicationType: string | null;
  };
  type StatusRow = { enroleeNumber: string | null; classLevel: string | null };

  const statusByEnrolee = new Map<string, string>();
  for (const s of (statusRes.data ?? []) as StatusRow[]) {
    if (s.enroleeNumber && s.classLevel) statusByEnrolee.set(s.enroleeNumber, s.classLevel);
  }

  // level + gate info per enrollee
  const byEnrolee = new Map<string, { level: string; gate: AppRow }>();
  for (const a of (appsRes.data ?? []) as AppRow[]) {
    if (!a.enroleeNumber) continue;
    const level =
      statusByEnrolee.get(a.enroleeNumber) || (a.levelApplied?.trim() || 'Unknown');
    byEnrolee.set(a.enroleeNumber, { level, gate: a });
  }

  const buckets = new Map<string, LevelCompletionRow>();
  const ensureBucket = (level: string): LevelCompletionRow => {
    const existing = buckets.get(level);
    if (existing) return existing;
    const fresh: LevelCompletionRow = { level, valid: 0, pending: 0, rejected: 0, missing: 0 };
    buckets.set(level, fresh);
    return fresh;
  };

  const docRows = (docsRes.data ?? []) as unknown as Array<Record<string, string | null>>;
  for (const row of docRows) {
    const enroleeNumber = row.enroleeNumber;
    if (!enroleeNumber) continue;
    const entry = byEnrolee.get(enroleeNumber);
    if (!entry) continue;
    const bucket = ensureBucket(entry.level);

    for (const slot of DOCUMENT_SLOTS) {
      if (slot.conditional) {
        const gateValue =
          entry.gate[
            slot.conditional as 'fatherEmail' | 'guardianEmail' | 'stpApplicationType'
          ] ?? null;
        if (!gateValue || String(gateValue).trim() === '') continue;
      }
      const url = row[slot.key];
      const rawStatus = row[`${slot.key}Status`];
      const expiry = slot.expires ? row[`${slot.key}Expiry`] : null;
      const status = resolveStatus(url, rawStatus, expiry, slot.expires);
      switch (status) {
        case 'valid': bucket.valid += 1; break;
        case 'uploaded':
        case 'to-follow':
          // 'to-follow' counts as in-progress alongside 'uploaded' for
          // level completion roll-ups.
          bucket.pending += 1;
          break;
        case 'rejected': bucket.rejected += 1; break;
        case 'expired':
        case 'missing': bucket.missing += 1; break;
        case 'na': break;
      }
    }
  }

  const entries = Array.from(buckets.values());
  entries.sort((a, b) => compareLevelLabels(a.level, b.level));
  return entries;
}

export function getCompletionByLevel(ayCode: string): Promise<LevelCompletionRow[]> {
  return unstable_cache(
    loadCompletionByLevelUncached,
    ['p-files', 'completion-by-level', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Revisions over time — weekly bucket of p_file_revisions replacements.
// ──────────────────────────────────────────────────────────────────────────

export type RevisionWeek = {
  weekStart: string; // ISO date of the Monday
  weekLabel: string;
  count: number;
};

async function loadRevisionsOverTimeUncached(
  ayCode: string,
  weeks: number,
): Promise<RevisionWeek[]> {
  const service = createServiceClient();

  // Window: N weeks back from most recent Monday.
  const now = new Date();
  const monday = startOfWeekIso(now);
  const windowStart = new Date(monday);
  windowStart.setDate(windowStart.getDate() - 7 * (weeks - 1));

  const { data, error } = await service
    .from('p_file_revisions')
    .select('replaced_at')
    .eq('ay_code', ayCode)
    .gte('replaced_at', windowStart.toISOString())
    .order('replaced_at', { ascending: true });

  if (error) {
    console.error('[p-files] getRevisionsOverTime fetch failed:', error.message);
    return emptyWeeks(weeks);
  }

  // Pre-seed buckets so empty weeks still render.
  const bucketKeys: string[] = [];
  for (let i = 0; i < weeks; i += 1) {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i * 7);
    bucketKeys.push(toDateStr(d));
  }
  const counts = new Map<string, number>();
  for (const k of bucketKeys) counts.set(k, 0);

  for (const r of (data ?? []) as Array<{ replaced_at: string }>) {
    const t = Date.parse(r.replaced_at);
    if (Number.isNaN(t)) continue;
    const wk = startOfWeekIso(new Date(t));
    const key = toDateStr(wk);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return bucketKeys.map((k) => ({
    weekStart: k,
    weekLabel: formatWeekLabel(k),
    count: counts.get(k) ?? 0,
  }));
}

export function getRevisionsOverTime(
  ayCode: string,
  weeks: number = 12,
): Promise<RevisionWeek[]> {
  return unstable_cache(
    loadRevisionsOverTimeUncached,
    ['p-files', 'revisions-over-time', ayCode, String(weeks)],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode, weeks);
}

function startOfWeekIso(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  // ISO week: Monday = 1, Sunday = 0. Shift so Mondays anchor the week.
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

function emptyWeeks(weeks: number): RevisionWeek[] {
  const out: RevisionWeek[] = [];
  const monday = startOfWeekIso(new Date());
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const d = new Date(monday);
    d.setDate(d.getDate() - 7 * i);
    const iso = toDateStr(d);
    out.push({ weekStart: iso, weekLabel: formatWeekLabel(iso), count: 0 });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Top missing documents — ranked slot list (derived client-side in the
// page from DocumentBacklogRow[], but exported here for a clean import shape).
// ──────────────────────────────────────────────────────────────────────────

export type TopMissingSlot = {
  slotKey: string;
  label: string;
  missing: number;
  pending: number;
  total: number;
};

// ──────────────────────────────────────────────────────────────────────────
// Range-aware siblings (new). Same cache-wrapper pattern; existing fns above
// stay byte-compatible.
// ──────────────────────────────────────────────────────────────────────────

export type PFilesRangeKpis = {
  revisionsInRange: number;
  /** Within 60 days from end of range — used by the renewal-window MetricCard. */
  expiringSoon: number;
  /** Within 30 days from end of range — narrower urgency window. Surfaced as
   *  its own MetricCard alongside the 60-day figure (Phase 2B subtractive
   *  rebuild dropped the prior "Pending review" KPI). */
  expiringSoon30: number;
  pendingReview: number;
  totalDocuments: number;
};

async function loadPFilesKpisForRange(input: RangeInput): Promise<PFilesRangeKpis> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const prefix = prefixFor(input.ayCode);
  const fromIso = `${input.from}T00:00:00+08:00`;
  const toIso = `${input.to}T23:59:59+08:00`;

  const [revRes, docsRes] = await Promise.all([
    service
      .from('p_file_revisions')
      .select('id, status_snapshot', { count: 'exact' })
      .eq('ay_code', input.ayCode)
      .gte('replaced_at', fromIso)
      .lte('replaced_at', toIso),
    admissions
      .from(`${prefix}_enrolment_documents`)
      .select(
        [
          'enroleeNumber',
          ...DOCUMENT_SLOTS.flatMap((s) =>
            s.expires ? [s.key, `${s.key}Status`, `${s.key}Expiry`] : [s.key, `${s.key}Status`],
          ),
        ].join(', '),
      ),
  ]);

  type DocRow = Record<string, string | null>;
  const docs = (docsRes.data ?? []) as unknown as DocRow[];
  const endDate = parseLocalDate(input.to) ?? new Date();
  const sixtyDaysOut = new Date(endDate);
  sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
  const thirtyDaysOut = new Date(endDate);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

  let expiringSoon = 0;
  let expiringSoon30 = 0;
  let pending = 0;
  let total = 0;

  // Use the same resolveStatus helper that powers getCompletionByLevel and
  // getSlotStatusMix so the KPI counts agree with what the drills + table
  // show. Comparing raw `status === 'pending'` against the DB's PascalCase
  // values ('Uploaded', 'Pending', etc.) was the previous bug — the strings
  // never matched and the KPI cards showed 0.
  for (const row of docs) {
    for (const slot of DOCUMENT_SLOTS) {
      const url = row[slot.key];
      const rawStatus = row[`${slot.key}Status`];
      const expiry = slot.expires ? row[`${slot.key}Expiry`] : null;
      const status = resolveStatus(url, rawStatus, expiry, slot.expires);
      // Skip slots that are entirely absent (no URL, no status) — these
      // would resolve to 'missing' but they're not "tracked" yet, so leave
      // them out of the totalDocuments tally.
      if (!url && !rawStatus) continue;
      total += 1;
      if (status === 'uploaded') pending += 1;
      if (slot.expires && expiry) {
        const exp = parseLocalDate(expiry);
        if (exp && exp >= endDate && exp <= sixtyDaysOut) expiringSoon += 1;
        if (exp && exp >= endDate && exp <= thirtyDaysOut) expiringSoon30 += 1;
      }
    }
  }

  return {
    revisionsInRange: revRes.count ?? 0,
    expiringSoon,
    expiringSoon30,
    pendingReview: pending,
    totalDocuments: total,
  };
}

async function loadPFilesKpisRangeUncached(
  input: RangeInput,
): Promise<RangeResult<PFilesRangeKpis>> {
  const current = await loadPFilesKpisForRange(input);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = await loadPFilesKpisForRange({
    ayCode: input.ayCode,
    from: input.cmpFrom,
    to: input.cmpTo,
    cmpFrom: input.cmpFrom,
    cmpTo: input.cmpTo,
  });
  return {
    current,
    comparison,
    delta: computeDelta(current.revisionsInRange, comparison.revisionsInRange),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getPFilesKpisRange(input: RangeInput): Promise<RangeResult<PFilesRangeKpis>> {
  return unstable_cache(
    loadPFilesKpisRangeUncached,
    ['p-files', 'kpis-range', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Revision velocity — daily-bucketed revision replacements.

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

async function loadRevisionVelocityRangeUncached(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  const service = createServiceClient();
  const hasCmp = input.cmpFrom != null && input.cmpTo != null;
  const earliest = hasCmp && input.cmpFrom! < input.from ? input.cmpFrom! : input.from;
  const latest = hasCmp && input.to < input.cmpTo! ? input.cmpTo! : input.to;

  const { data } = await service
    .from('p_file_revisions')
    .select('replaced_at')
    .eq('ay_code', input.ayCode)
    .gte('replaced_at', `${earliest}T00:00:00+08:00`)
    .lte('replaced_at', `${latest}T23:59:59+08:00`);

  type Row = { replaced_at: string };
  const rows = ((data ?? []) as Row[]).map((r) => ({ ts: r.replaced_at }));
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

export function getRevisionVelocityRange(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadRevisionVelocityRangeUncached,
    ['p-files', 'revision-velocity', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { tags: tag(input.ayCode), revalidate: CACHE_TTL_SECONDS },
  )(input);
}

// Slot status mix — donut-ready breakdown of valid / pending / rejected / missing.

export type SlotStatusMix = {
  valid: number;
  pending: number;
  rejected: number;
  missing: number;
};

async function loadSlotStatusMixUncached(ayCode: string): Promise<SlotStatusMix> {
  const prefix = prefixFor(ayCode);
  const admissions = createAdmissionsClient();
  const { data } = await admissions
    .from(`${prefix}_enrolment_documents`)
    .select(
      [
        'enroleeNumber',
        ...DOCUMENT_SLOTS.flatMap((s) =>
          s.expires ? [s.key, `${s.key}Status`, `${s.key}Expiry`] : [s.key, `${s.key}Status`],
        ),
      ].join(', '),
    );
  type Row = Record<string, string | null>;
  const mix: SlotStatusMix = { valid: 0, pending: 0, rejected: 0, missing: 0 };
  for (const row of ((data ?? []) as unknown as Row[])) {
    for (const slot of DOCUMENT_SLOTS) {
      const url = row[slot.key];
      const rawStatus = row[`${slot.key}Status`];
      const expiry = slot.expires ? row[`${slot.key}Expiry`] : null;
      const status = resolveStatus(url, rawStatus, expiry, slot.expires);
      switch (status) {
        case 'valid': mix.valid += 1; break;
        case 'uploaded':
        case 'to-follow':
          // 'to-follow' counts as in-progress alongside 'uploaded' for the
          // donut "Pending" slice.
          mix.pending += 1;
          break;
        case 'rejected': mix.rejected += 1; break;
        case 'expired':
        case 'missing': mix.missing += 1; break;
        case 'na': break;
      }
    }
  }
  return mix;
}

export function getSlotStatusMix(ayCode: string): Promise<SlotStatusMix> {
  return unstable_cache(
    loadSlotStatusMixUncached,
    ['p-files', 'slot-status-mix', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )(ayCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Revisions activity heatmap — 12-week × 7-day calendar grid of revision
// counts. Visualises which weeks/days see uploads (e.g. enrollment season
// spikes). Each cell click drills to revisions on that day.

export type RevisionsHeatmapCell = {
  date: string; // ISO yyyy-MM-dd
  count: number;
};

async function loadRevisionsHeatmapUncached(
  ayCode: string,
  weeks: number,
): Promise<RevisionsHeatmapCell[]> {
  const service = createServiceClient();
  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weeks * 7 + 1);
  const sinceIso = since.toISOString();

  const { data } = await service
    .from('p_file_revisions')
    .select('replaced_at')
    .eq('ay_code', ayCode)
    .gte('replaced_at', sinceIso);

  const buckets = new Map<string, number>();
  for (const r of (data ?? []) as { replaced_at: string }[]) {
    const day = r.replaced_at.slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }

  // Fill the full grid so empty cells render as muted; cells are in
  // chronological order which the card uses to lay out 7 days × N weeks.
  const out: RevisionsHeatmapCell[] = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(since.getFullYear(), since.getMonth(), since.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: buckets.get(iso) ?? 0 });
  }
  return out;
}

export function getRevisionsHeatmap(
  ayCode: string,
  weeks = 12,
): Promise<RevisionsHeatmapCell[]> {
  return unstable_cache(
    () => loadRevisionsHeatmapUncached(ayCode, weeks),
    ['p-files', 'revisions-heatmap', ayCode, String(weeks)],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// PriorityPanel payload — top-of-fold "what should I act on right now?"
// answer for the operational P-Files dashboard. Reuses getExpiringDocuments
// (already cached + urgency-ordered) so no new query is introduced.
// ──────────────────────────────────────────────────────────────────────────

export type PFilesPriorityInput = {
  ayCode: string;
};

export async function getPFilesPriority(
  input: PFilesPriorityInput,
): Promise<PriorityPayload> {
  // Pull a few more than we'll display so we have headroom for the chips.
  const expiring = await getExpiringDocuments(input.ayCode, 60, 12);

  const overdue = expiring.filter((r) => r.daysUntilExpiry < 0);
  const dueSoon = expiring.filter(
    (r) => r.daysUntilExpiry >= 0 && r.daysUntilExpiry <= 14,
  );
  const total = overdue.length + dueSoon.length;

  // Chips: top 4 most urgent items. Each chip is one student.
  const top = expiring.slice(0, 4).map((row) => ({
    label: row.studentName,
    count: row.daysUntilExpiry < 0 ? Math.abs(row.daysUntilExpiry) : row.daysUntilExpiry,
    href: `/p-files/${row.enroleeNumber}`,
    severity:
      row.daysUntilExpiry < 0
        ? ('bad' as const)
        : row.daysUntilExpiry <= 14
          ? ('warn' as const)
          : ('info' as const),
  }));

  return {
    eyebrow: 'Priority · today',
    title: total === 0 ? 'No documents need urgent attention' : 'Documents needing attention',
    headline: {
      value: total,
      label:
        overdue.length > 0
          ? `${overdue.length} overdue · ${dueSoon.length} due in 14 days`
          : `due in the next 14 days`,
      severity: overdue.length > 0 ? 'bad' : dueSoon.length > 0 ? 'warn' : 'good',
    },
    chips: top,
    cta:
      total > 0
        ? { label: 'View all expiring', href: `/p-files?ay=${input.ayCode}&status=expired` }
        : undefined,
    iconKey: 'alert',
  };
}

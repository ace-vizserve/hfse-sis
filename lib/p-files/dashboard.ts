import { unstable_cache } from 'next/cache';

import { DOCUMENT_SLOTS, resolveStatus } from '@/lib/p-files/document-config';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

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

// HFSE canonical order. Levels outside this list fold into "Unknown" and
// appear last.
const CANONICAL_LEVELS = [
  'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
  'Secondary 1', 'Secondary 2', 'Secondary 3', 'Secondary 4',
];

async function loadCompletionByLevelUncached(ayCode: string): Promise<LevelCompletionRow[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appsRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, levelApplied, fatherEmail, guardianEmail'),
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
          entry.gate[slot.conditional as 'fatherEmail' | 'guardianEmail'] ?? null;
        if (!gateValue || String(gateValue).trim() === '') continue;
      }
      const url = row[slot.key];
      const rawStatus = row[`${slot.key}Status`];
      const expiry = slot.expires ? row[`${slot.key}Expiry`] : null;
      const status = resolveStatus(url, rawStatus, expiry, slot.expires);
      switch (status) {
        case 'valid': bucket.valid += 1; break;
        case 'uploaded': bucket.pending += 1; break;
        case 'rejected': bucket.rejected += 1; break;
        case 'expired':
        case 'missing': bucket.missing += 1; break;
        case 'na': break;
      }
    }
  }

  const entries = Array.from(buckets.values());
  entries.sort((a, b) => {
    const ai = CANONICAL_LEVELS.indexOf(a.level);
    const bi = CANONICAL_LEVELS.indexOf(b.level);
    if (ai === -1 && bi === -1) return a.level.localeCompare(b.level);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
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

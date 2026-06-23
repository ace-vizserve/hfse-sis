import 'server-only';

import { unstable_cache } from 'next/cache';

import { growthDelta, type Growth } from '@/lib/dashboard/growth';
import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';
import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
import { getMovementEvents, type MovementEvent } from '@/lib/sis/movements';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// Records Insights synthesis (Phase 2 of Module Insights, KD #140).
//
// Pure `rollupMovements` aggregates the cross-AY movement feed into the
// Retention/Population breakdowns; thin cached loaders add cross-AY retention
// (studentNumber set-intersection priorAy ∩ currentAy) + headcount. Reuses
// `lib/sis/movements.ts` + `lib/sis/dashboard.ts` loaders. `growthDelta` is
// re-exported for the page (hoisted to lib/dashboard/growth.ts, shared with
// Admissions).

export { growthDelta, type Growth };

// ──────────────────────────────────────────────────────────────────────────
// Movement rollups (pure)
// ──────────────────────────────────────────────────────────────────────────

export type LabelCount = { reason: string; count: number };
export type LevelCountRow = { level: string; count: number };
export type TermCountRow = { termNumber: number; count: number };
export type MovementRollup = {
  counts: {
    withdrawn: number;
    lateEnrolled: number;
    transferred: number;
    reEnrolled: number;
  };
  withdrawalsByReason: LabelCount[];
  withdrawalsByLevel: LevelCountRow[];
  lateByLevel: LevelCountRow[];
  lateByTerm: TermCountRow[];
};

const UNSPECIFIED = 'Unspecified';
function bump<K>(m: Map<K, number>, k: K) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function sortedLabels(m: Map<string, number>): LabelCount[] {
  return [...m.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
function sortedLevels(m: Map<string, number>): LevelCountRow[] {
  return [...m.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
}

export function rollupMovements(events: MovementEvent[]): MovementRollup {
  const counts = {
    withdrawn: 0,
    lateEnrolled: 0,
    transferred: 0,
    reEnrolled: 0,
  };
  const wReason = new Map<string, number>();
  const wLevel = new Map<string, number>();
  const lLevel = new Map<string, number>();
  const lTerm = new Map<number, number>();
  for (const e of events) {
    const level = (e.level ?? '').trim() || 'Unknown';
    if (e.kind === 'withdrawn') {
      counts.withdrawn += 1;
      const reason =
        ((e as { reasonLabel?: string | null }).reasonLabel ?? '').trim() ||
        UNSPECIFIED;
      bump(wReason, reason);
      bump(wLevel, level);
    } else if (e.kind === 'late-enrolled') {
      counts.lateEnrolled += 1;
      bump(lLevel, level);
      if (typeof e.termNumber === 'number') bump(lTerm, e.termNumber);
    } else if (e.kind === 'section-transfer') {
      counts.transferred += 1;
    } else if (e.kind === 're-enrolled') {
      counts.reEnrolled += 1;
    }
  }
  return {
    counts,
    withdrawalsByReason: sortedLabels(wReason),
    withdrawalsByLevel: sortedLevels(wLevel),
    lateByLevel: sortedLevels(lLevel),
    lateByTerm: [...lTerm.entries()]
      .map(([termNumber, count]) => ({ termNumber, count }))
      .sort((a, b) => a.termNumber - b.termNumber),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Cross-AY retention
// ──────────────────────────────────────────────────────────────────────────

async function loadEnrolledStudentNumbers(
  ayCode: string
): Promise<Set<string>> {
  const service = createServiceClient();
  // Resolve the AY id, then active section_students -> student_number.
  // section_students has no academic_year_id column — AY-scope via a
  // sections!inner join (mirrors lib/sis/dashboard.ts range loaders).
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return new Set();
  // Walk past the PostgREST 1000-row cap — a growing school's roster (esp. the
  // prior AY's) can exceed it, and a silent truncation would undercount
  // retention (the exact metric where that goes unnoticed). Mirrors the
  // fetchAllPages pattern used across cross-AY bulk reads.
  type EnrolRow = {
    student:
      | { student_number: string | null }
      | { student_number: string | null }[]
      | null;
  };
  const rows = await fetchAllPages<EnrolRow>((from, to) =>
    service
      .from('section_students')
      .select(
        'student:students(student_number), section:sections!inner(academic_year_id)'
      )
      .eq('section.academic_year_id', ayId)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );
  const out = new Set<string>();
  for (const r of rows) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (s?.student_number) out.add(s.student_number);
  }
  return out;
}

export type Retention = {
  priorAy: string | null;
  returned: number;
  didNotReturn: number;
  priorTotal: number;
  pct: number | null;
};

/** Of priorAy's enrolled students, how many are also enrolled in currentAy. */
async function loadRecordsRetention(
  currentAy: string,
  priorAy: string | null
): Promise<Retention> {
  if (!priorAy) {
    return {
      priorAy: null,
      returned: 0,
      didNotReturn: 0,
      priorTotal: 0,
      pct: null,
    };
  }
  const [current, prior] = await Promise.all([
    loadEnrolledStudentNumbers(currentAy),
    loadEnrolledStudentNumbers(priorAy),
  ]);
  let returned = 0;
  for (const sn of prior) if (current.has(sn)) returned += 1;
  const priorTotal = prior.size;
  return {
    priorAy,
    returned,
    didNotReturn: priorTotal - returned,
    priorTotal,
    pct:
      priorTotal === 0 ? null : Math.round((returned / priorTotal) * 1000) / 10,
  };
}

const CACHE_TTL_SECONDS = 60;

export function getRecordsRetention(
  currentAy: string,
  priorAy: string | null
): Promise<Retention> {
  return unstable_cache(
    () => loadRecordsRetention(currentAy, priorAy),
    ['sis', 'records-retention', currentAy, priorAy ?? ''],
    { tags: ['sis', `sis:${currentAy}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Headcount — total enrolled + per-level breakdown for the AY.
// ──────────────────────────────────────────────────────────────────────────

export type RecordsHeadcount = {
  total: number;
  byLevel: LevelCount[];
};

/** Thin sum over getLevelDistribution — total enrolled + the per-level array. */
export async function getRecordsHeadcount(
  ayCode: string
): Promise<RecordsHeadcount> {
  const byLevel = await getLevelDistribution(ayCode);
  const total = byLevel.reduce((s, l) => s + l.count, 0);
  return { total, byLevel };
}

// ──────────────────────────────────────────────────────────────────────────
// Net-movement trend — one AyTrendPoint per (AY, month-of-year).
//
// Net movement = enrolments(+) − withdrawals(−) for each calendar month.
// "Enrolment" events: late-enrolled + re-enrolled (first-time enrolments are
// handled by the headcount loaders; what we track here is mid-year movement).
// "Withdrawal" events: withdrawn.
// Section-transfers are excluded (not a population change).
//
// Month label is the abbreviated 3-letter month name derived from the event
// date (yyyy-mm-dd), locale-independent.
// ──────────────────────────────────────────────────────────────────────────

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Pure: compute per-month net movement from a pre-fetched events array for
 * one AY. Returns 12 points (Jan–Dec), value = net (can be 0 or negative),
 * or null for future months relative to `today` (yyyy-mm-dd string).
 */
export function netMovementByMonth(
  events: MovementEvent[],
  ayCode: string,
  today: string
): AyTrendPoint[] {
  const net = new Array<number>(12).fill(0);
  for (const e of events) {
    const monthIdx = Number(e.date.slice(5, 7)) - 1; // 0-based
    if (monthIdx < 0 || monthIdx > 11) continue;
    if (e.kind === 'late-enrolled' || e.kind === 're-enrolled') {
      net[monthIdx] += 1;
    } else if (e.kind === 'withdrawn') {
      net[monthIdx] -= 1;
    }
    // section-transfer: no population change → skip
  }
  return MONTH_LABELS.map((label, i) => {
    // Month string for this AY: AY2026 + i=0 → "2026-01"
    const year = ayCode.replace(/^AY/i, '');
    const month = String(i + 1).padStart(2, '0');
    const monthStart = `${year}-${month}-01`;
    // Null for future months (beyond today) — renders as a gap in the chart.
    const value = monthStart > today ? null : net[i];
    return { periodLabel: label, ayCode, value };
  });
}

/**
 * Async loader: fetches movement events for each AY and returns the combined
 * array of AyTrendPoints for use with buildAyTrend + MultiSeriesTrendChart.
 */
export async function getMovementTrendByAy(
  ays: string[],
  today: string
): Promise<AyTrendPoint[]> {
  if (ays.length === 0) return [];
  const eventsByAy = await Promise.all(ays.map((ay) => getMovementEvents(ay)));
  const points: AyTrendPoint[] = [];
  for (let i = 0; i < ays.length; i++) {
    const monthPoints = netMovementByMonth(eventsByAy[i], ays[i], today);
    points.push(...monthPoints);
  }
  return points;
}

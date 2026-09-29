import type { TermLockProgress } from '@/lib/markbook/dashboard';
import type { GradeEntryRow } from '@/lib/markbook/drill';
import type { GradeBand } from '@/lib/markbook/drill-filter';

// The rules every Markbook Insights figure shares with the drill behind it
// (KD #229). Each loader in dashboard.ts / compare.ts and each drill filter in
// drill-filter.ts calls THESE functions, so a figure and its list cannot count
// by different rules.
//
// Runtime-pure and client-safe: type-only imports, no Supabase, no
// 'server-only'. drill-filter.ts (bundled into the client drill sheet) imports
// it at runtime.

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Which entries count ─────────────────────────────────────────────────────

/**
 * An entry counts toward an Insights average (and the grade histogram) when it
 * carries a numeric grade and is not N.A. — an N.A. row's grade is a
 * placeholder (Hard Rule #3, KD #148). The examinable-subject rule (KD #95) is
 * applied at the SHEET level by the loaders; drill rows carry it per row.
 */
export function countsTowardInsightsAverage(
  isNa: boolean | null,
  grade: number | null
): boolean {
  return isNa !== true && grade !== null;
}

export function isInsightsAverageRow(r: {
  isExaminable: boolean;
  isNa: boolean;
  computedGrade: number | null;
}): boolean {
  return r.isExaminable && countsTowardInsightsAverage(r.isNa, r.computedGrade);
}

// ── Which term the grade histogram reads ────────────────────────────────────

export type DistributionTermCandidate = {
  id: string;
  term_number: number;
  is_current: boolean | null;
  start_date: string | null;
  end_date: string | null;
};

/**
 * The term `getGradeDistribution` reads when not handed one: the `is_current`
 * term, else the term containing today, else the most recently finished term,
 * else the highest term number. `today` is `yyyy-MM-dd` (sgToday()).
 */
export function pickGradeDistributionTerm<T extends DistributionTermCandidate>(
  terms: T[],
  today: string
): T | null {
  const ordered = [...terms].sort((a, b) => a.term_number - b.term_number);
  const current = ordered.find((t) => t.is_current === true);
  const containingToday = ordered.find(
    (t) =>
      t.start_date && t.end_date && t.start_date <= today && t.end_date >= today
  );
  const lastFinished = [...ordered]
    .filter((t) => t.end_date && t.end_date < today)
    .sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0];
  const fallback = ordered[ordered.length - 1];
  return current ?? containingToday ?? lastFinished ?? fallback ?? null;
}

// ── Change requests ─────────────────────────────────────────────────────────

/** Start of the rolling "last N days" window, as getChangeRequestSummary has always computed it. */
export function changeRequestWindowStart(
  days: number,
  now: Date = new Date()
): string {
  const since = new Date(now.getTime());
  since.setDate(since.getDate() - days);
  return since.toISOString();
}

/** The summary's `.gte('requested_at', since)`, as an instant comparison (formats differ: `Z` vs `+00:00`). */
export function isInChangeRequestWindow(
  requestedAt: string,
  sinceIso: string
): boolean {
  const t = Date.parse(requestedAt);
  return !Number.isNaN(t) && t >= Date.parse(sinceIso);
}

export type DecisionFields = {
  status: string;
  requestedAt: string;
  reviewedAt: string | null;
};

/**
 * Milliseconds from request to decision, or null when the request does not
 * count toward "Avg decision time": not approved/rejected/applied, never
 * reviewed, unparseable, or reviewed before it was requested.
 */
export function decisionMs(r: DecisionFields): number | null {
  if (!r.reviewedAt) return null;
  if (
    r.status !== 'approved' &&
    r.status !== 'rejected' &&
    r.status !== 'applied'
  ) {
    return null;
  }
  const req = Date.parse(r.requestedAt);
  const rev = Date.parse(r.reviewedAt);
  if (Number.isNaN(req) || Number.isNaN(rev) || rev < req) return null;
  return rev - req;
}

export function averageDecisionHours(rows: DecisionFields[]): number | null {
  let count = 0;
  let totalMs = 0;
  for (const r of rows) {
    const ms = decisionMs(r);
    if (ms === null) continue;
    count += 1;
    totalMs += ms;
  }
  return count > 0 ? round1(totalMs / count / (1000 * 60 * 60)) : null;
}

// ── Sheets locked per term ──────────────────────────────────────────────────

export function tallySheetLocksByTerm(
  terms: { id: string; term_number: number }[],
  sheets: { term_id: string; is_locked: boolean }[]
): TermLockProgress[] {
  const counts = new Map<string, { locked: number; open: number }>();
  for (const t of terms) counts.set(t.id, { locked: 0, open: 0 });
  for (const s of sheets) {
    const bucket = counts.get(s.term_id);
    if (!bucket) continue;
    if (s.is_locked) bucket.locked += 1;
    else bucket.open += 1;
  }
  return [...terms]
    .sort((a, b) => a.term_number - b.term_number)
    .map((t) => ({
      termNumber: t.term_number,
      termLabel: `Term ${t.term_number}`,
      locked: counts.get(t.id)!.locked,
      open: counts.get(t.id)!.open,
    }));
}

// ── Level average ───────────────────────────────────────────────────────────

export type SubjectAveragePoint = {
  periodLabel: string;
  levelCode: string;
  avgGrade: number | null;
};

/**
 * "Which levels are struggling?" — per level, the unweighted mean of its
 * subject averages in `period` (each already rounded to 1 dp), rounded to 1 dp.
 * A diagnostic signal, NOT the mean of the level's entries.
 */
export function levelAveragesForPeriod(
  points: SubjectAveragePoint[],
  period: string
): { levelCode: string; avg: number }[] {
  const byLevel = new Map<string, number[]>();
  for (const p of points) {
    if (p.periodLabel !== period || p.avgGrade === null) continue;
    const arr = byLevel.get(p.levelCode) ?? [];
    arr.push(p.avgGrade);
    byLevel.set(p.levelCode, arr);
  }
  return [...byLevel.entries()].map(([levelCode, avgs]) => ({
    levelCode,
    avg: round1(avgs.reduce((a, b) => a + b, 0) / avgs.length),
  }));
}

/**
 * The level point, recomputed from drill rows with the chart's own rule: each
 * catalogue subject's average (1 dp), then levelAveragesForPeriod.
 */
export function levelAverageFromEntryRows(
  rows: GradeEntryRow[],
  levelCode: string,
  termNumber: number
): number | null {
  const bySubject = new Map<string, number[]>();
  for (const r of rows) {
    if (r.level !== levelCode || r.termNumber !== termNumber) continue;
    if (!isInsightsAverageRow(r)) continue;
    const arr = bySubject.get(r.subjectCatalogName) ?? [];
    arr.push(r.computedGrade as number);
    bySubject.set(r.subjectCatalogName, arr);
  }
  const period = `T${termNumber}`;
  const points: SubjectAveragePoint[] = [...bySubject.values()].map(
    (grades) => ({
      periodLabel: period,
      levelCode,
      avgGrade: round1(grades.reduce((a, b) => a + b, 0) / grades.length),
    })
  );
  return levelAveragesForPeriod(points, period)[0]?.avg ?? null;
}

// ── Top band ────────────────────────────────────────────────────────────────

export const TOP_BAND_KEYS: readonly GradeBand[] = ['vs', 'o'];

export function isTopBand(b: GradeBand | null): boolean {
  return b !== null && TOP_BAND_KEYS.includes(b);
}

// ── Segment grammar ─────────────────────────────────────────────────────────
// `<left>|T<n>` and `<left>|<right>` split on the LAST bar, so a subject name
// holding a bar still parses.

function splitLast(segment: string): [string, string] | null {
  const i = segment.lastIndexOf('|');
  if (i <= 0 || i === segment.length - 1) return null;
  return [segment.slice(0, i), segment.slice(i + 1)];
}

function termToken(token: string): number | null {
  const m = /^T(\d+)$/.exec(token);
  return m ? Number(m[1]) : null;
}

export function subjectTermSegment(
  subjectName: string,
  termNumber: number
): string {
  return `${subjectName}|T${termNumber}`;
}

export function parseSubjectTermSegment(
  segment: string
): { subjectName: string; termNumber: number } | null {
  const parts = splitLast(segment);
  if (!parts) return null;
  const termNumber = termToken(parts[1]);
  return termNumber === null ? null : { subjectName: parts[0], termNumber };
}

export function levelTermSegment(
  levelCode: string,
  termNumber: number
): string {
  return `${levelCode}|T${termNumber}`;
}

export function parseLevelTermSegment(
  segment: string
): { levelCode: string; termNumber: number } | null {
  const parts = splitLast(segment);
  if (!parts) return null;
  const termNumber = termToken(parts[1]);
  return termNumber === null ? null : { levelCode: parts[0], termNumber };
}

export function subjectLevelSegment(
  subjectName: string,
  levelCode: string
): string {
  return `${subjectName}|${levelCode}`;
}

export function parseSubjectLevelSegment(
  segment: string
): { subjectName: string; levelCode: string } | null {
  const parts = splitLast(segment);
  return parts ? { subjectName: parts[0], levelCode: parts[1] } : null;
}

export function topBandSegment(termNumber: number): string {
  return `top|T${termNumber}`;
}

export function parseTopBandSegment(
  segment: string
): { termNumber: number | null } | null {
  if (segment === 'top') return { termNumber: null };
  const m = /^top\|T(\d+)$/.exec(segment);
  return m ? { termNumber: Number(m[1]) } : null;
}

export function windowedCrSegment(days: number, status?: string): string {
  return status ? `${days}d:${status}` : `${days}d`;
}

export function parseWindowedCrSegment(
  segment: string
): { days: number; status: string | null } | null {
  const m = /^(\d+)d(?::([a-z_]+))?$/.exec(segment);
  return m ? { days: Number(m[1]), status: m[2] ?? null } : null;
}

/** 'T2' → 2, 'Term 3' → 3. */
export function termNumberFromLabel(label: string): number | null {
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

/** buildMultiAyTrend's series key `"{subjectName} · {ayCode}"`. */
export function parseTrendSeriesKey(
  key: string
): { subjectName: string; ayCode: string } | null {
  const i = key.lastIndexOf(' · ');
  if (i <= 0) return null;
  const ayCode = key.slice(i + 3);
  if (!/^AY\d{4}$/.test(ayCode)) return null;
  return { subjectName: key.slice(0, i), ayCode };
}

import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { DAY_TYPE_LABELS } from '@/lib/schemas/attendance';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import type { CompassionateUsageRow } from '@/lib/attendance/drill';

// Attendance dashboard aggregators — read-only consumers per KD #47.
// Attendance itself is the sole writer of `attendance_daily`; this file only
// reads.

const CACHE_TTL_SECONDS = 300;

function tag(ayCode: string): string[] {
  return ['attendance-dashboard', `attendance-dashboard:${ayCode}`];
}

export type DailyRow = {
  date: string;
  status: string; // P | L | EX | A | NC
  ex_reason: string | null;
  section_student_id: string;
};

async function loadDailyRowsUncached(ayCode: string): Promise<DailyRow[]> {
  const service = createServiceClient();
  // Scope daily rows to this AY's sections. section_students.section_id ->
  // sections.academic_year_id. Do the filter via IN against section_ids.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = ayRow?.id as string | undefined;
  if (!ayId) return [];

  const { data: sectionRows } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = (sectionRows ?? []).map((r) => r.id as string);
  if (sectionIds.length === 0) return [];

  // Paginate via fetchAllPages — section_students in a busy AY can exceed
  // PostgREST's 1000-row default cap (mid-year transfers per KD #67 leave
  // both old + new rows; long-running AYs accumulate withdraws + re-
  // enrolments). A truncated SELECT here silently halves the attendance
  // row set the dashboard sees, producing card-vs-drill mismatches that
  // look like cache staleness but are actually data-volume truncation.
  const ss = await fetchAllPages<{ id: string }>((from, to) =>
    service
      .from('section_students')
      .select('id')
      .in('section_id', sectionIds)
      .range(from, to)
  );
  const studentRowIds = ss.map((r) => r.id);
  if (studentRowIds.length === 0) return [];

  // attendance_daily can exceed PostgREST's 1000-row response cap on the
  // HFSE instance (200 students × 60+ school days = 12K+ rows for a full
  // term), and an unbounded `.in()` of UUIDs overflows the gateway's URL cap.
  // Both are what `fetchInChunks` exists for, so use it rather than the
  // hand-rolled loop that was here.
  //
  // THAT LOOP WAS SERIAL, and it was the slowest read in the app. Measured on
  // AY2026: 53 round trips, 5.0s, for a page that shows a handful of KPIs —
  // ~400 students became 5 chunks, awaited one after another, each then paging
  // attendance_daily 1000 rows at a time. `fetchInChunks` sends the chunks as
  // one wave (see its header), so only the paging inside a chunk stays serial,
  // which it must be: page N+1's existence is only known once page N comes
  // back short.
  //
  // Chunk size is the shared default (200) rather than the old local 100 —
  // ~7.4KB of filter against a measured ~14.3KB ceiling, so still conservative,
  // and it halves the number of chunks.
  // ⚠ ORDERING IS LOAD-BEARING, AND SO IS THE `id` TIE-BREAK.
  //
  // `attendance_daily` is an append-only ledger: a correction is a NEW row that
  // supersedes the old one by `recorded_at desc`. This read had no ordering and
  // no dedupe, so every corrected mark was counted TWICE — measured on live
  // AY2026: 48,574 rows over 48,401 real (student, date) pairs, 106 of them
  // marks whose value had actually changed. An absence corrected to Excused
  // still counted as an absence, in the KPIs, the EX-reason mix and the
  // top-absentees ranking.
  //
  // `recorded_at desc` alone is not enough. A class register submit writes one
  // row per student in a single statement, so ~25 rows share one `recorded_at`
  // to the microsecond, and PostgREST is free to order tied rows differently on
  // each `.range()` request — a tie straddling a page boundary then repeats
  // rows on the next page and skips others. `.order('id')` breaks every tie the
  // same way on every page. It is a TIE-break only; `recorded_at desc` still
  // decides which correction wins. Same reasoning as
  // `lib/attendance/queries.ts::listDailyEntries`, which walks 1,610 rows —
  // this walks ~48,000, so it crosses far more page boundaries.
  //
  // Ordering columns need not be selected, so only `period_id` is added to the
  // payload — it is part of the dedupe key (migration 014 keys the ledger on
  // `(section_student_id, date, period_id)`; it is NULL everywhere today, but
  // keying on it now means a future multi-period day is not silently collapsed
  // into one mark).
  //
  // Chunking stays safe: a student belongs to exactly one chunk, so ordering
  // only has to hold WITHIN a chunk, which it does.
  const raw = await fetchInChunks<DailyRowRaw>(studentRowIds, (slice) =>
    fetchAllPages<DailyRowRaw>((from, to) =>
      service
        .from('attendance_daily')
        .select('date, status, ex_reason, section_student_id, period_id')
        .in('section_student_id', slice)
        // Grouped order, not global order. The dedupe only needs the latest row
        // FIRST WITHIN each (student, date) group — it does not care how groups
        // are ordered relative to each other, and neither do the consumers,
        // which all reduce into maps.
        //
        // That freedom is worth taking: this leading triple matches migration
        // 014's `(section_student_id, date desc, recorded_at desc)` index
        // exactly, so Postgres walks the index instead of sorting ~48k rows.
        // A global `recorded_at desc` matched no index and measured ~700ms
        // slower for an ordering nothing needed.
        .order('section_student_id', { ascending: true })
        .order('date', { ascending: false })
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    )
  );

  return dedupeLatestMarks(raw);
}

/**
 * Per-(date, status) mark counts for a year — migration 148's RPC.
 *
 * Request-scoped via `React.cache()` for the same reason `loadDailyRows` is:
 * four loaders on one page render ask for the same year, and they should share
 * one call rather than making four.
 *
 * ⚠ FALLS BACK when the RPC is missing. Migration 148 and this code can land in
 * either order, and an attendance dashboard that 500s because a migration is
 * five minutes behind a deploy is a worse failure than a slow one. The fallback
 * is the old path — read the year's rows and bucket them here — so behaviour is
 * identical either way, only slower. Remove the fallback once 148 is applied
 * everywhere.
 */
export const loadMarkCounts = cache(
  async (ayCode: string): Promise<MarkCount[]> => {
    const service = createServiceClient();
    const ayId = await getAyIdByCode(ayCode);
    if (!ayId) return [];
    // ⚠ PAGINATE THE RPC. A set-returning function is served through PostgREST
    // like any other relation, so it obeys the same 1000-row cap — and it
    // truncates SILENTLY, with no error and no flag. Caught by
    // scripts/verify-attendance-aggregates.perf.ts: the A/L function returned
    // exactly 1000 rows against 1271 real ones, which is the shape of this bug
    // every time. Buckets are ~500 today and would not truncate yet; paginating
    // both means the one that grows past the cap does not start lying.
    type CountRow = {
      mark_date: string;
      status: string;
      ex_reason: string | null;
      mark_count: number;
    };
    let data: CountRow[];
    try {
      data = await fetchAllPages<CountRow>((from, to) =>
        service
          .rpc('attendance_mark_counts_by_date', { p_academic_year_id: ayId })
          .order('mark_date')
          .order('status')
          .order('ex_reason')
          .range(from, to)
      );
    } catch (e) {
      console.warn(
        '[attendance] attendance_mark_counts_by_date unavailable, falling back to row scan:',
        e instanceof Error ? e.message : e
      );
      return countsFromRows(await loadDailyRows(ayCode));
    }
    return (
      (data ?? []) as Array<{
        mark_date: string;
        status: string;
        ex_reason: string | null;
        mark_count: number;
      }>
    ).map((r) => ({
      date: r.mark_date,
      status: r.status,
      ex_reason: r.ex_reason,
      count: r.mark_count,
    }));
  }
);

/**
 * The surviving A and L marks per student — migration 148's second RPC.
 *
 * ⚠ THE FILTER CANNOT MOVE TO THE CLIENT. `attendance_daily` is append-only, so
 * filtering to A/L in the query and deduping the result would keep an absence a
 * later correction had already replaced with Present — the superseding row is
 * not in the filtered set to beat it. The RPC dedupes first and filters second.
 * The fallback below therefore dedupes the FULL year (via `loadDailyRows`)
 * before filtering, which is the same order.
 */
export const loadAbsenceMarks = cache(
  async (ayCode: string): Promise<AbsenceMark[]> => {
    const service = createServiceClient();
    const ayId = await getAyIdByCode(ayCode);
    if (!ayId) return [];
    // Paginated for the same reason as `loadMarkCounts` above — this is the
    // call that actually hit the cap.
    type AbsenceRow = {
      section_student_id: string;
      mark_date: string;
      status: string;
    };
    let data: AbsenceRow[];
    try {
      data = await fetchAllPages<AbsenceRow>((from, to) =>
        service
          .rpc('attendance_absence_marks', { p_academic_year_id: ayId })
          .order('section_student_id')
          .order('mark_date')
          .range(from, to)
      );
    } catch (e) {
      console.warn(
        '[attendance] attendance_absence_marks unavailable, falling back to row scan:',
        e instanceof Error ? e.message : e
      );
      const rows = await loadDailyRows(ayCode);
      return rows
        .filter((r) => r.status === 'A' || r.status === 'L')
        .map((r) => ({
          section_student_id: r.section_student_id,
          date: r.date,
          status: r.status as 'A' | 'L',
        }));
    }
    return (
      (data ?? []) as Array<{
        section_student_id: string;
        mark_date: string;
        status: string;
      }>
    ).map((r) => ({
      section_student_id: r.section_student_id,
      date: r.mark_date,
      status: r.status as 'A' | 'L',
    }));
  }
);

/** A ledger row as fetched, before superseded entries are dropped. */
export type DailyRowRaw = DailyRow & { period_id: string | null };

/**
 * Keep only the surviving mark for each (student, date, period).
 *
 * Pure, and exported so the rule can be tested without a database. Assumes the
 * caller fetched in `recorded_at desc, id asc` order — the FIRST row seen for a
 * key is therefore the latest one, and everything after it is history.
 */
export function dedupeLatestMarks(rows: readonly DailyRowRaw[]): DailyRow[] {
  const seen = new Set<string>();
  const out: DailyRow[] = [];
  for (const r of rows) {
    const key = `${r.section_student_id}|${r.date}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: r.date,
      status: r.status,
      ex_reason: r.ex_reason,
      section_student_id: r.section_student_id,
    });
  }
  return out;
}

// loadDailyRows: request-scoped memoization via React's cache(), NOT
// unstable_cache. The full-AY attendance_daily set (4 narrow columns × up to
// 100k rows) serializes to ~3.9-8.3MB for any AY with real mid-year data —
// past Next.js's hard 2MB unstable_cache data-cache ceiling. Every persistent
// write was silently failing ("items over 2MB can not be cached"), surfacing
// as repeated unhandledRejection errors on /attendance and /attendance/insights.
//
// Unlike drill.ts's loadEntryRows (KD #56), left plain-uncached because it has
// a SINGLE caller, loadDailyRows has 5+ independent callers that all run
// inside one page's Promise.all fan-out (getAttendanceKpisRange,
// getDailyAttendanceRange, getExReasonMixRange, getTopAbsentRange, plus
// insights-compare's getAttendanceRateTrendByAy). Plain-uncaching would
// multiply one full-AY fetch into 5-10 per render (worse in compare mode).
// React's cache() dedupes by argument within a single request/render, so all
// same-ayCode callers share ONE Supabase fetch — no serialization, no 2MB
// limit, request-scoped (never leaks across requests/users/AYs). Same pattern
// as getAyIdByCode (lib/dashboard/ay-id.ts).
export const loadDailyRows = cache(
  (ayCode: string): Promise<DailyRow[]> => loadDailyRowsUncached(ayCode)
);

// ──────────────────────────────────────────────────────────────────────────
// KPIs: attendance %, late / excused / absent counts in range.
// ──────────────────────────────────────────────────────────────────────────

export type AttendanceKpis = {
  attendancePct: number;
  encodedDays: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  nc: number;
};

/**
 * One (date, status, ex_reason) bucket and how many marks fell in it.
 *
 * This is what the dashboard actually consumes. Four of the six loaders below
 * need nothing finer than per-date status counts, and the EX donut needs only
 * the reason alongside — so the year's ~48,000 marks collapse to a few thousand
 * buckets before they cross the wire (migration 148).
 *
 * `ex_reason` is null for every status except EX.
 */
export type MarkCount = {
  date: string;
  status: string; // P | L | EX | A | NC
  ex_reason: string | null;
  count: number;
};

/** One surviving A or L mark. The only per-student grain anything still needs. */
export type AbsenceMark = {
  section_student_id: string;
  date: string;
  status: 'A' | 'L';
};

export function sliceMarkCounts(
  counts: readonly MarkCount[],
  from: string,
  to: string
): MarkCount[] {
  return counts.filter((c) => c.date >= from && c.date <= to);
}

/**
 * Aggregate raw rows into buckets — the same shape migration 148's RPC returns.
 *
 * Three jobs: it is the fallback when that migration has not been applied yet,
 * it is what the unit tests exercise, and it is the oracle
 * `scripts/verify-attendance-aggregates.perf.ts` compares the RPC against.
 * Keeping one definition of "what the aggregate means" is what lets those three
 * agree.
 */
export function countsFromRows(rows: readonly DailyRow[]): MarkCount[] {
  const buckets = new Map<string, MarkCount>();
  for (const r of rows) {
    if (r.status == null) continue;
    // EX is the only status carrying a reason; folding the others on a null
    // keeps the key space small and matches the RPC's GROUP BY exactly.
    const reason = r.status === 'EX' ? (r.ex_reason ?? null) : null;
    const key = `${r.date}|${r.status}|${reason ?? ''}`;
    const hit = buckets.get(key);
    if (hit) hit.count += 1;
    else
      buckets.set(key, {
        date: r.date,
        status: r.status,
        ex_reason: reason,
        count: 1,
      });
  }
  return [...buckets.values()];
}

export function sliceDailyRows(
  rows: DailyRow[],
  from: string,
  to: string
): DailyRow[] {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

/** Same arithmetic as `kpisFor`, over buckets instead of one row per mark. */
export function kpisFromCounts(counts: readonly MarkCount[]): AttendanceKpis {
  let present = 0,
    late = 0,
    excused = 0,
    absent = 0,
    nc = 0;
  for (const c of counts) {
    switch (c.status) {
      case 'P':
        present += c.count;
        break;
      case 'L':
        late += c.count;
        break;
      case 'EX':
        excused += c.count;
        break;
      case 'A':
        absent += c.count;
        break;
      case 'NC':
        nc += c.count;
        break;
    }
  }
  const encoded = present + late + excused + absent;
  return {
    attendancePct:
      encoded > 0 ? ((present + late + excused) / encoded) * 100 : 0,
    encodedDays: encoded,
    present,
    late,
    excused,
    absent,
    nc,
  };
}

export function kpisFor(rows: DailyRow[]): AttendanceKpis {
  let present = 0,
    late = 0,
    excused = 0,
    absent = 0,
    nc = 0;
  for (const r of rows) {
    switch (r.status) {
      case 'P':
        present += 1;
        break;
      case 'L':
        late += 1;
        break;
      case 'EX':
        excused += 1;
        break;
      case 'A':
        absent += 1;
        break;
      case 'NC':
        nc += 1;
        break;
    }
  }
  const encoded = present + late + excused + absent;
  const attendancePct =
    encoded > 0 ? ((present + late + excused) / encoded) * 100 : 0;
  return {
    attendancePct,
    encodedDays: encoded,
    present,
    late,
    excused,
    absent,
    nc,
  };
}

async function loadAttendanceKpisRangeUncached(
  input: RangeInput
): Promise<RangeResult<AttendanceKpis>> {
  const counts = await loadMarkCounts(input.ayCode);
  const current = kpisFromCounts(sliceMarkCounts(counts, input.from, input.to));
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = kpisFromCounts(
    sliceMarkCounts(counts, input.cmpFrom, input.cmpTo)
  );
  return {
    current,
    comparison,
    delta: computeDelta(current.attendancePct, comparison.attendancePct),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getAttendanceKpisRange(
  input: RangeInput
): Promise<RangeResult<AttendanceKpis>> {
  return unstable_cache(
    loadAttendanceKpisRangeUncached,
    [
      'attendance',
      'kpis-range',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// Daily attendance % series (for TrendChart overlay).

export type DailyAttendancePoint = { x: string; y: number };

function dailyPctSeries(
  counts: readonly MarkCount[],
  from: string,
  to: string
): DailyAttendancePoint[] {
  const fromDate = parseLocalDate(from);
  if (!fromDate) return [];
  const length = daysInRange({ from, to });
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(
      fromDate.getFullYear(),
      fromDate.getMonth(),
      fromDate.getDate() + i
    );
    labels.push(toISODate(d));
  }
  const byDate = new Map<string, { encoded: number; attended: number }>();
  for (const l of labels) byDate.set(l, { encoded: 0, attended: 0 });
  for (const c of counts) {
    if (!byDate.has(c.date)) continue;
    const bucket = byDate.get(c.date)!;
    if (c.status === 'NC') continue;
    bucket.encoded += c.count;
    if (c.status === 'P' || c.status === 'L' || c.status === 'EX')
      bucket.attended += c.count;
  }
  return labels.map((x) => {
    const b = byDate.get(x)!;
    return { x, y: b.encoded > 0 ? (b.attended / b.encoded) * 100 : 0 };
  });
}

async function loadDailyAttendanceRangeUncached(
  input: RangeInput
): Promise<RangeResult<DailyAttendancePoint[]>> {
  const counts = await loadMarkCounts(input.ayCode);
  const current = dailyPctSeries(
    sliceMarkCounts(counts, input.from, input.to),
    input.from,
    input.to
  );
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = dailyPctSeries(
    sliceMarkCounts(counts, input.cmpFrom, input.cmpTo),
    input.cmpFrom,
    input.cmpTo
  );
  const currentAvg =
    current.length > 0
      ? current.reduce((s, p) => s + p.y, 0) / current.length
      : 0;
  const comparisonAvg =
    comparison.length > 0
      ? comparison.reduce((s, p) => s + p.y, 0) / comparison.length
      : 0;
  return {
    current,
    comparison,
    delta: computeDelta(currentAvg, comparisonAvg),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getDailyAttendanceRange(
  input: RangeInput
): Promise<RangeResult<DailyAttendancePoint[]>> {
  return unstable_cache(
    loadDailyAttendanceRangeUncached,
    [
      'attendance',
      'daily-pct',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// EX reason breakdown — donut-ready.

export type ExReasonMix = { name: string; value: number };

async function loadExReasonMixRangeUncached(
  input: RangeInput
): Promise<ExReasonMix[]> {
  const marks = await loadMarkCounts(input.ayCode);
  const windowed = sliceMarkCounts(marks, input.from, input.to).filter(
    (c) => c.status === 'EX'
  );
  const counts: Record<string, number> = {};
  for (const c of windowed) {
    const key = c.ex_reason || 'Other';
    counts[key] = (counts[key] ?? 0) + c.count;
  }
  const LABEL: Record<string, string> = {
    mc: 'MC / Excuse leave',
    compassionate: 'Compassionate',
    vacation: 'Vacation leave',
    Other: 'Other',
  };
  return Object.entries(counts).map(([k, v]) => ({
    name: LABEL[k] ?? k,
    value: v,
  }));
}

export function getExReasonMixRange(input: RangeInput): Promise<ExReasonMix[]> {
  return unstable_cache(
    loadExReasonMixRangeUncached,
    ['attendance', 'ex-reason-mix', input.ayCode, input.from, input.to],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// Top-absent students — ranked list by absence count in range.

export type TopAbsentRow = {
  sectionStudentId: string;
  studentName: string;
  sectionName: string;
  absences: number;
  lates: number;
};

async function loadTopAbsentRangeUncached(
  input: RangeInput,
  limit: number
): Promise<TopAbsentRow[]> {
  // Only A and L ever mattered here, and they are 2% of the ledger — so this
  // asks for them specifically (migration 148) instead of reading the year and
  // discarding the 95% that are `P`. The RPC dedupes BEFORE filtering, which is
  // the part that cannot be done client-side: an absence later corrected to
  // Present would otherwise survive, because the row that supersedes it is not
  // in the filtered set to beat it.
  const marks = await loadAbsenceMarks(input.ayCode);
  const windowed = marks.filter(
    (m) => m.date >= input.from && m.date <= input.to
  );
  const counts = new Map<string, { absences: number; lates: number }>();
  for (const m of windowed) {
    const bucket = counts.get(m.section_student_id) ?? {
      absences: 0,
      lates: 0,
    };
    if (m.status === 'A') bucket.absences += 1;
    else bucket.lates += 1;
    counts.set(m.section_student_id, bucket);
  }
  const ids = Array.from(counts.keys());
  if (ids.length === 0) return [];

  const service = createServiceClient();
  // Chunked: `ids` is every student with at least one A/L mark in the picker's
  // range, so over a full-AY window it approaches the whole roster. PostgREST
  // serializes `.in()` into the URL and fails past ~14.3KB / 396 uuids (see
  // lib/supabase/paginate.ts). Measured on AY2026 this is already 276 ids =
  // 10.0KB, 70% of the ceiling with terms still left to record — so it crosses
  // within the year, not eventually.
  const data = await fetchInChunks(ids, async (slice) => {
    const { data, error } = await service
      .from('section_students')
      .select(
        'id, section:sections(name), student:students(first_name, last_name, student_number)'
      )
      .in('id', slice);
    if (error) {
      throw new Error(
        `loadTopAbsentRange: section_students lookup failed: ${error.message}`
      );
    }
    return data ?? [];
  });

  type Joined = {
    id: string;
    section: { name: string } | { name: string }[] | null;
    student:
      | {
          first_name: string | null;
          last_name: string | null;
          student_number: string | null;
        }
      | {
          first_name: string | null;
          last_name: string | null;
          student_number: string | null;
        }[]
      | null;
  };
  const out: TopAbsentRow[] = [];
  for (const row of (data ?? []) as Joined[]) {
    const section = Array.isArray(row.section) ? row.section[0] : row.section;
    const student = Array.isArray(row.student) ? row.student[0] : row.student;
    const name =
      `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim() ||
      (student?.student_number ?? row.id);
    const bucket = counts.get(row.id)!;
    out.push({
      sectionStudentId: row.id,
      studentName: name,
      sectionName: section?.name ?? '—',
      absences: bucket.absences,
      lates: bucket.lates,
    });
  }
  out.sort((a, b) => b.absences - a.absences || b.lates - a.lates);
  return out.slice(0, limit);
}

export function getTopAbsentRange(
  input: RangeInput,
  limit = 10
): Promise<TopAbsentRow[]> {
  return unstable_cache(
    () => loadTopAbsentRangeUncached(input, limit),
    [
      'attendance',
      'top-absent',
      input.ayCode,
      input.from,
      input.to,
      String(limit),
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )();
}

// Day-type distribution — over the range.

export type DayTypePoint = { name: string; value: number };

async function loadDayTypeDistributionRangeUncached(
  input: RangeInput
): Promise<DayTypePoint[]> {
  const service = createServiceClient();
  // Resolve the AY's term ids first. school_calendar rows are scoped via
  // term_id; without this filter the donut would include calendar rows
  // from every AY whose dates fall in the range (e.g. AY9999 test +
  // AY2026 production overlapping in test environments).
  // ayId resolution uses request-scoped cache to dedupe across helpers.
  const ayId = await getAyIdByCode(input.ayCode);
  if (ayId == null) return [];

  const { data: termRows } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((termRows ?? []) as Array<{ id: string }>).map((t) => t.id);
  if (termIds.length === 0) return [];

  // Filter to the school-wide baseline (`audience='all'`) so the donut
  // counts each calendar date exactly once. Migration 037 (KD #76) lets
  // primary + secondary each have their own row for the same date; without
  // this filter, a date with both an `'all'` row and a `'primary'` override
  // would double-count. Audience-specific divergences are visible on
  // `/sis/calendar` via the audience filter — the registrar oversight donut
  // shows the global term shape.
  const { data } = await service
    .from('school_calendar')
    .select('day_type, date')
    .in('term_id', termIds)
    .eq('audience', 'all')
    .gte('date', input.from)
    .lte('date', input.to);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ day_type: string }>) {
    counts[row.day_type] = (counts[row.day_type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => ({
    name: DAY_TYPE_LABELS[k as keyof typeof DAY_TYPE_LABELS] ?? k,
    value: v,
  }));
}

export function getDayTypeDistributionRange(
  input: RangeInput
): Promise<DayTypePoint[]> {
  return unstable_cache(
    loadDayTypeDistributionRangeUncached,
    ['attendance', 'day-type', input.ayCode, input.from, input.to],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// PriorityPanel payload — top-of-fold "what should I act on right now?"
// answer for the operational Attendance dashboard. The registrar's first
// question landing on /attendance is "did all sections mark attendance
// today, and are any students over the compassionate quota?"
//
// Headline = unmarked sections for today (school days only).
// Chips    = top 4 unmarked sections + up to 2 compassionate over-quota.
// ──────────────────────────────────────────────────────────────────────────

export type AttendancePriorityInput = {
  ayCode: string;
  /**
   * Over-quota compassionate rows from `getCompassionateOverQuota` — a fast,
   * narrow query, NOT the ~180k-row `buildAllRowSets` scan. The priority
   * panel + hero lede must stay independent of that scan so they can render
   * before the deferred below-fold section resolves. Plain serializable
   * objects are safe inside unstable_cache args.
   */
  compassionate: CompassionateUsageRow[];
};

async function loadAttendancePriorityUncached(
  input: AttendancePriorityInput
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // Today's date in Asia/Singapore (matches HFSE operating TZ). ISO date.
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Singapore',
  });

  // Resolve current AY id so we can scope sections + the calendar lookup.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', input.ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) {
    return {
      eyebrow: 'Priority · today',
      title: 'No academic year configured',
      headline: {
        value: 0,
        label: 'set up AY in /sis/ay-setup',
        severity: 'info',
      },
      chips: [],
      iconKey: 'alert',
    };
  }

  // Confirm today is a school day. school_calendar lacks an ay_code column;
  // it joins to AY via terms.academic_year_id. Filter terms to this AY,
  // then look up today's row at audience='all' (the school-wide baseline).
  // Per KD #76 a date can have multiple rows (one per audience) — the
  // registrar priority check uses the baseline; level-specific overrides
  // are honored by the per-section attendance writer (KD #50 precedence).
  const { data: termRows } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = (termRows ?? []).map((r) => r.id as string);

  let dayType: string | null = null;
  if (termIds.length > 0) {
    const { data: calRow } = await service
      .from('school_calendar')
      .select('day_type')
      .in('term_id', termIds)
      .eq('date', today)
      .eq('audience', 'all')
      .maybeSingle();
    dayType = (calRow?.day_type as string | undefined) ?? null;
  }

  const isSchoolDay = dayType === 'school_day' || dayType === 'hbl';

  // Compassionate over-quota — passed in to avoid refetching.
  const overQuota = input.compassionate.filter((r) => r.isOverQuota);

  if (!isSchoolDay) {
    // No school today → headline collapses; surface compassionate-quota
    // chips so the panel still has signal when a registrar checks in.
    const compassionateChips = overQuota.slice(0, 4).map((r) => ({
      label: `${r.studentName} (${r.sectionName})`,
      count: r.used,
      href: `/attendance/${r.sectionId}`,
      severity: 'warn' as const,
    }));
    return {
      eyebrow: 'Priority · today',
      title:
        overQuota.length > 0
          ? `${overQuota.length} students over compassionate quota`
          : 'No school today',
      headline: {
        value: 0,
        label:
          overQuota.length > 0
            ? 'attendance not required'
            : 'attendance not required',
        severity: overQuota.length > 0 ? 'warn' : 'good',
      },
      chips: compassionateChips,
      iconKey: 'alert',
    };
  }

  // All sections in current AY.
  const { data: sectionsData } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId);
  const sections = (sectionsData ?? []) as Array<{ id: string; name: string }>;

  // Sections with at least one attendance_daily row for today.
  const sectionIds = sections.map((s) => s.id);
  const markedSectionIds = new Set<string>();
  if (sectionIds.length > 0) {
    // attendance_daily references section_students (not sections directly).
    // Resolve the section_student ids that belong to these sections, then
    // ask which of them have a row for today.
    const { data: ssRows } = await service
      .from('section_students')
      .select('id, section_id')
      .in('section_id', sectionIds);
    const ssToSection = new Map<string, string>();
    for (const row of (ssRows ?? []) as Array<{
      id: string;
      section_id: string;
    }>) {
      ssToSection.set(row.id, row.section_id);
    }
    const ssIds = Array.from(ssToSection.keys());

    if (ssIds.length > 0) {
      // Chunk to respect URL length limits (mirrors loadDailyRowsUncached).
      const chunks: string[][] = [];
      for (let i = 0; i < ssIds.length; i += 100)
        chunks.push(ssIds.slice(i, i + 100));
      for (const chunk of chunks) {
        const { data } = await service
          .from('attendance_daily')
          .select('section_student_id')
          .eq('date', today)
          .in('section_student_id', chunk);
        for (const row of (data ?? []) as Array<{
          section_student_id: string;
        }>) {
          const secId = ssToSection.get(row.section_student_id);
          if (secId) markedSectionIds.add(secId);
        }
      }
    }
  }

  const unmarked = sections.filter((s) => !markedSectionIds.has(s.id));

  const topUnmarkedChips = unmarked.slice(0, 4).map((s) => ({
    label: s.name,
    count: 0, // binary: section either marked or hasn't — count is just "0 recorded so far"
    href: `/attendance/${s.id}`,
    severity: 'bad' as const,
  }));

  // Add up to 2 compassionate over-quota chips if there's room.
  const remaining = Math.max(0, 5 - topUnmarkedChips.length);
  const compassionateChips = overQuota.slice(0, remaining).map((r) => ({
    label: `${r.studentName} (${r.sectionName})`,
    count: r.used,
    href: `/attendance/${r.sectionId}`,
    severity: 'warn' as const,
  }));

  const total = unmarked.length;
  const severity: 'bad' | 'warn' | 'good' =
    unmarked.length > 0 ? 'bad' : overQuota.length > 0 ? 'warn' : 'good';

  return {
    eyebrow: 'Priority · today',
    title:
      total === 0 && overQuota.length === 0
        ? "Today's attendance is in"
        : total === 0
          ? `${overQuota.length} students over compassionate quota`
          : 'Sections still need to mark attendance today',
    headline: {
      value: total,
      label:
        total === 0
          ? 'all sections marked'
          : `of ${sections.length} sections still pending`,
      severity,
    },
    chips: [...topUnmarkedChips, ...compassionateChips],
    cta:
      total > 0
        ? { label: 'Open section picker', href: '/attendance/sections' }
        : undefined,
    iconKey: 'alert',
  };
}

export function getAttendancePriority(
  input: AttendancePriorityInput
): Promise<PriorityPayload> {
  // Cache key includes today's UTC date so it rolls over at UTC midnight
  // (8am SGT). Operational data — 60s revalidate keeps the panel fresh
  // while sections are marking in.
  return unstable_cache(
    loadAttendancePriorityUncached,
    [
      'attendance',
      'priority',
      input.ayCode,
      new Date().toISOString().slice(0, 10),
    ],
    { tags: tag(input.ayCode), revalidate: 60 }
  )(input);
}

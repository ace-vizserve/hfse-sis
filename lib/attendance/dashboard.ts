import { unstable_cache } from 'next/cache';
import { AlertTriangle } from 'lucide-react';

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

type DailyRow = {
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

  const { data: ss } = await service
    .from('section_students')
    .select('id')
    .in('section_id', sectionIds);
  const studentRowIds = (ss ?? []).map((r) => r.id as string);
  if (studentRowIds.length === 0) return [];

  // attendance_daily can be large — we fetch in chunks of 1000 IDs to keep
  // each PostgREST call bounded.
  const chunks: string[][] = [];
  for (let i = 0; i < studentRowIds.length; i += 1000) {
    chunks.push(studentRowIds.slice(i, i + 1000));
  }
  const all: DailyRow[] = [];
  for (const chunk of chunks) {
    const { data } = await service
      .from('attendance_daily')
      .select('date, status, ex_reason, section_student_id')
      .in('section_student_id', chunk);
    for (const row of (data ?? []) as DailyRow[]) all.push(row);
  }
  return all;
}

function loadDailyRows(ayCode: string): Promise<DailyRow[]> {
  return unstable_cache(
    () => loadDailyRowsUncached(ayCode),
    ['attendance', 'daily-raw', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

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

function slice(rows: DailyRow[], from: string, to: string): DailyRow[] {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

function kpisFor(rows: DailyRow[]): AttendanceKpis {
  let present = 0,
    late = 0,
    excused = 0,
    absent = 0,
    nc = 0;
  for (const r of rows) {
    switch (r.status) {
      case 'P': present += 1; break;
      case 'L': late += 1; break;
      case 'EX': excused += 1; break;
      case 'A': absent += 1; break;
      case 'NC': nc += 1; break;
    }
  }
  const encoded = present + late + excused + absent;
  const attendancePct = encoded > 0 ? ((present + late + excused) / encoded) * 100 : 0;
  return { attendancePct, encodedDays: encoded, present, late, excused, absent, nc };
}

async function loadAttendanceKpisRangeUncached(
  input: RangeInput,
): Promise<RangeResult<AttendanceKpis>> {
  const rows = await loadDailyRows(input.ayCode);
  const current = kpisFor(slice(rows, input.from, input.to));
  const comparison = kpisFor(slice(rows, input.cmpFrom, input.cmpTo));
  return {
    current,
    comparison,
    delta: computeDelta(current.attendancePct, comparison.attendancePct),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getAttendanceKpisRange(
  input: RangeInput,
): Promise<RangeResult<AttendanceKpis>> {
  return unstable_cache(
    loadAttendanceKpisRangeUncached,
    ['attendance', 'kpis-range', input.ayCode, input.from, input.to, input.cmpFrom, input.cmpTo],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
  )(input);
}

// Daily attendance % series (for TrendChart overlay).

export type DailyAttendancePoint = { x: string; y: number };

function dailyPctSeries(rows: DailyRow[], from: string, to: string): DailyAttendancePoint[] {
  const fromDate = parseLocalDate(from);
  if (!fromDate) return [];
  const length = daysInRange({ from, to });
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    labels.push(toISODate(d));
  }
  const byDate = new Map<string, { encoded: number; attended: number }>();
  for (const l of labels) byDate.set(l, { encoded: 0, attended: 0 });
  for (const r of rows) {
    if (!byDate.has(r.date)) continue;
    const bucket = byDate.get(r.date)!;
    if (r.status === 'NC') continue;
    bucket.encoded += 1;
    if (r.status === 'P' || r.status === 'L' || r.status === 'EX') bucket.attended += 1;
  }
  return labels.map((x) => {
    const b = byDate.get(x)!;
    return { x, y: b.encoded > 0 ? (b.attended / b.encoded) * 100 : 0 };
  });
}

async function loadDailyAttendanceRangeUncached(
  input: RangeInput,
): Promise<RangeResult<DailyAttendancePoint[]>> {
  const rows = await loadDailyRows(input.ayCode);
  const current = dailyPctSeries(slice(rows, input.from, input.to), input.from, input.to);
  const comparison = dailyPctSeries(slice(rows, input.cmpFrom, input.cmpTo), input.cmpFrom, input.cmpTo);
  const currentAvg =
    current.length > 0 ? current.reduce((s, p) => s + p.y, 0) / current.length : 0;
  const comparisonAvg =
    comparison.length > 0 ? comparison.reduce((s, p) => s + p.y, 0) / comparison.length : 0;
  return {
    current,
    comparison,
    delta: computeDelta(currentAvg, comparisonAvg),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getDailyAttendanceRange(
  input: RangeInput,
): Promise<RangeResult<DailyAttendancePoint[]>> {
  return unstable_cache(
    loadDailyAttendanceRangeUncached,
    ['attendance', 'daily-pct', input.ayCode, input.from, input.to, input.cmpFrom, input.cmpTo],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
  )(input);
}

// EX reason breakdown — donut-ready.

export type ExReasonMix = { name: string; value: number };

async function loadExReasonMixRangeUncached(input: RangeInput): Promise<ExReasonMix[]> {
  const rows = await loadDailyRows(input.ayCode);
  const windowed = slice(rows, input.from, input.to).filter((r) => r.status === 'EX');
  const counts: Record<string, number> = {};
  for (const r of windowed) {
    const key = r.ex_reason || 'Other';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const LABEL: Record<string, string> = {
    mc: 'MC',
    compassionate: 'Compassionate',
    school_activity: 'School activity',
    Other: 'Other',
  };
  return Object.entries(counts).map(([k, v]) => ({ name: LABEL[k] ?? k, value: v }));
}

export function getExReasonMixRange(input: RangeInput): Promise<ExReasonMix[]> {
  return unstable_cache(
    loadExReasonMixRangeUncached,
    ['attendance', 'ex-reason-mix', input.ayCode, input.from, input.to],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
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
  limit: number,
): Promise<TopAbsentRow[]> {
  const rows = await loadDailyRows(input.ayCode);
  const windowed = slice(rows, input.from, input.to);
  const counts = new Map<string, { absences: number; lates: number }>();
  for (const r of windowed) {
    if (r.status !== 'A' && r.status !== 'L') continue;
    const bucket = counts.get(r.section_student_id) ?? { absences: 0, lates: 0 };
    if (r.status === 'A') bucket.absences += 1;
    else bucket.lates += 1;
    counts.set(r.section_student_id, bucket);
  }
  const ids = Array.from(counts.keys());
  if (ids.length === 0) return [];

  const service = createServiceClient();
  const { data } = await service
    .from('section_students')
    .select(
      'id, section:sections(name), student:students(first_name, last_name, student_number)',
    )
    .in('id', ids);

  type Joined = {
    id: string;
    section: { name: string } | { name: string }[] | null;
    student:
      | { first_name: string | null; last_name: string | null; student_number: string | null }
      | { first_name: string | null; last_name: string | null; student_number: string | null }[]
      | null;
  };
  const out: TopAbsentRow[] = [];
  for (const row of (data ?? []) as Joined[]) {
    const section = Array.isArray(row.section) ? row.section[0] : row.section;
    const student = Array.isArray(row.student) ? row.student[0] : row.student;
    const name = `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim() || (student?.student_number ?? row.id);
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
  limit = 10,
): Promise<TopAbsentRow[]> {
  return unstable_cache(
    () => loadTopAbsentRangeUncached(input, limit),
    ['attendance', 'top-absent', input.ayCode, input.from, input.to, String(limit)],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
  )();
}

// Day-type distribution — over the range.

export type DayTypePoint = { name: string; value: number };

async function loadDayTypeDistributionRangeUncached(
  input: RangeInput,
): Promise<DayTypePoint[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('school_calendar')
    .select('day_type, date')
    .gte('date', input.from)
    .lte('date', input.to);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ day_type: string }>) {
    counts[row.day_type] = (counts[row.day_type] ?? 0) + 1;
  }
  const LABEL: Record<string, string> = {
    school_day: 'School day',
    hbl: 'HBL',
    public_holiday: 'Public holiday',
    school_holiday: 'School holiday',
    no_class: 'No class',
  };
  return Object.entries(counts).map(([k, v]) => ({ name: LABEL[k] ?? k, value: v }));
}

export function getDayTypeDistributionRange(
  input: RangeInput,
): Promise<DayTypePoint[]> {
  return unstable_cache(
    loadDayTypeDistributionRangeUncached,
    ['attendance', 'day-type', input.ayCode, input.from, input.to],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
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
   * Already-loaded compassionate rows from `buildAllRowSets`. Pass through to
   * avoid a duplicate fetch — same pattern as P-Files reusing
   * getExpiringDocuments. Plain serializable objects are safe inside
   * unstable_cache args.
   */
  compassionate: CompassionateUsageRow[];
};

async function loadAttendancePriorityUncached(
  input: AttendancePriorityInput,
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // Today's date in Asia/Singapore (matches HFSE operating TZ). ISO date.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

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
      headline: { value: 0, label: 'set up AY in /sis/ay-setup', severity: 'info' },
      chips: [],
      icon: AlertTriangle,
    };
  }

  // Confirm today is a school day. school_calendar lacks an ay_code column;
  // it joins to AY via terms.academic_year_id. Filter terms to this AY,
  // then look up the single row for today.
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
        label: overQuota.length > 0 ? 'attendance not required' : 'attendance not required',
        severity: overQuota.length > 0 ? 'warn' : 'good',
      },
      chips: compassionateChips,
      icon: AlertTriangle,
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
  let markedSectionIds = new Set<string>();
  if (sectionIds.length > 0) {
    // attendance_daily references section_students (not sections directly).
    // Resolve the section_student ids that belong to these sections, then
    // ask which of them have a row for today.
    const { data: ssRows } = await service
      .from('section_students')
      .select('id, section_id')
      .in('section_id', sectionIds);
    const ssToSection = new Map<string, string>();
    for (const row of (ssRows ?? []) as Array<{ id: string; section_id: string }>) {
      ssToSection.set(row.id, row.section_id);
    }
    const ssIds = Array.from(ssToSection.keys());

    if (ssIds.length > 0) {
      // Chunk to respect URL length limits (mirrors loadDailyRowsUncached).
      const chunks: string[][] = [];
      for (let i = 0; i < ssIds.length; i += 1000) chunks.push(ssIds.slice(i, i + 1000));
      for (const chunk of chunks) {
        const { data } = await service
          .from('attendance_daily')
          .select('section_student_id')
          .eq('date', today)
          .in('section_student_id', chunk);
        for (const row of (data ?? []) as Array<{ section_student_id: string }>) {
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
      label: total === 0 ? 'all sections marked' : `of ${sections.length} sections still pending`,
      severity,
    },
    chips: [...topUnmarkedChips, ...compassionateChips],
    cta:
      total > 0 ? { label: 'Open section picker', href: '/attendance/sections' } : undefined,
    icon: AlertTriangle,
  };
}

export function getAttendancePriority(
  input: AttendancePriorityInput,
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
    { tags: tag(input.ayCode), revalidate: 60 },
  )(input);
}

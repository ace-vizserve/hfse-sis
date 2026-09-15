import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import type { AttendanceStatus } from '@/lib/schemas/attendance';

// WHICH DAYS a student missed, per term — the half of the consolidated file the
// masterfile export did not carry.
//
// ── WHY ────────────────────────────────────────────────────────────────────
//
// Miss Joann, 2026-09-15 registrar training, on the consolidated file: it holds
// per student per term "attendance (days present, dates) and grades per
// subject", and it is _"importante sa lahat"_. She has since agreed the file is
// retired into the SIS. The masterfile export already carried grades, awards,
// comments and attendance COUNTS — School Days / Present / Late per term — but
// never a single date. With the spreadsheet gone, a date nobody can get is a
// date the school has lost.
//
// ── WHY THE EXCEPTIONS, NOT "DAYS PRESENT" ─────────────────────────────────
//
// A term is roughly 50 school days, so listing every present date would add
// ~200 dates per student to a sheet that already runs to dozens of columns, and
// nobody reads it. The days that get looked up are the ones a child was NOT
// simply present: absent, late, or excused. Those are few, they are what a
// parent phones about, and "everything else was a normal present day" is
// recoverable from the counts already in the export.
//
// ── WHY IT IS NOT IN `loadMasterfile` ──────────────────────────────────────
//
// ⚠ That payload is `unstable_cache`d, and Next's cache silently refuses to
// store anything over 2MB — this codebase has already shipped a loader whose
// 8,526-row payload meant the cache had never once stored and the page threw on
// every view. Dates are export-only: the on-screen dashboard does not show them,
// so they must not ride along in a cached payload that every view pays for.
//
// ⚠ Supersede is applied here, not assumed. `attendance_daily` is append-only
// and a correction is a NEW row, so the truth for a day is the LATEST
// `recorded_at` for that (date, period). A null status on the newest row means
// the mark was TAKEN BACK (migration 134) — that day is unmarked and must not
// appear as anything.

/** Statuses worth naming a date for. `P` is the normal day; `NC` is no class. */
const EXCEPTION_STATUSES = new Set<AttendanceStatus>(['A', 'L', 'EX']);

/** Short, unambiguous, and the same words the register uses. */
const EXCEPTION_LABEL: Record<string, string> = {
  A: 'absent',
  L: 'late',
  EX: 'excused',
};

type DailyRaw = {
  section_student_id: string;
  term_id: string;
  date: string;
  status: AttendanceStatus | null;
  period_id: string | null;
  recorded_at: string;
};

/** `2026-08-12` → `12 Aug`. Kept short — these sit many-to-a-cell. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const month = [
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
  ][Number(m) - 1];
  return `${Number(d)} ${month ?? m}`;
}

export type AttendanceDateIndex = {
  /** Key: `${studentId}|${termId}` → e.g. "12 Aug absent · 3 Sep late". */
  get(studentId: string, termId: string): string;
};

/**
 * Build the per-(student, term) exception-date index for a set of sections.
 *
 * Keyed on `studentId` rather than `section_student_id` so it lines up with the
 * masterfile's own rows — a transferred child has two enrolment rows and one
 * student, and KD #67 keeps the withdrawn one, so keying on the enrolment would
 * split their year across two cells.
 */
export async function loadAttendanceDates(
  sectionIds: string[],
  termIds: string[]
): Promise<AttendanceDateIndex> {
  const empty: AttendanceDateIndex = { get: () => '' };
  if (sectionIds.length === 0 || termIds.length === 0) return empty;

  const service = createServiceClient();

  const enrolments = (await fetchInChunks(sectionIds, (slice) =>
    fetchAllPages<{ id: string; student_id: string }>((from, to) =>
      service
        .from('section_students')
        .select('id, student_id')
        .in('section_id', slice)
        .order('id')
        .range(from, to)
    )
  )) as { id: string; student_id: string }[];

  if (enrolments.length === 0) return empty;
  const studentByEnrolment = new Map(
    enrolments.map((e) => [e.id, e.student_id])
  );

  const rows = (await fetchInChunks(
    enrolments.map((e) => e.id),
    (slice) =>
      fetchAllPages<DailyRaw>((from, to) =>
        service
          .from('attendance_daily')
          .select(
            'section_student_id, term_id, date, status, period_id, recorded_at'
          )
          .in('section_student_id', slice)
          .in('term_id', termIds)
          .order('id')
          .range(from, to)
      )
  )) as DailyRaw[];

  // Supersede: keep the newest row per (enrolment, date, period). Compared on
  // the ISO timestamp string, which sorts correctly and avoids constructing a
  // Date per row.
  const winners = new Map<string, DailyRaw>();
  for (const row of rows) {
    const key = `${row.section_student_id}|${row.date}|${row.period_id ?? ''}`;
    const held = winners.get(key);
    if (!held || row.recorded_at > held.recorded_at) winners.set(key, row);
  }

  // `${studentId}|${termId}` → dates, de-duplicated across periods of one day.
  const byCell = new Map<string, Map<string, string>>();
  for (const row of winners.values()) {
    if (row.status == null) continue; // mark taken back — not a day at all
    if (!EXCEPTION_STATUSES.has(row.status)) continue;

    const studentId = studentByEnrolment.get(row.section_student_id);
    if (!studentId) continue;

    const cellKey = `${studentId}|${row.term_id}`;
    let dates = byCell.get(cellKey);
    if (!dates) {
      dates = new Map<string, string>();
      byCell.set(cellKey, dates);
    }
    // A day marked per period can produce several rows. One date, one entry —
    // and an absence outranks a late on the same day, which is what a reader
    // checking "was this child in school" needs to see.
    const existing = dates.get(row.date);
    if (existing === 'A') continue;
    if (existing && row.status !== 'A') continue;
    dates.set(row.date, row.status);
  }

  const rendered = new Map<string, string>();
  for (const [cellKey, dates] of byCell) {
    const text = [...dates.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, status]) => `${shortDate(iso)} ${EXCEPTION_LABEL[status]}`)
      .join(' · ');
    rendered.set(cellKey, text);
  }

  return {
    get: (studentId, termId) => rendered.get(`${studentId}|${termId}`) ?? '',
  };
}

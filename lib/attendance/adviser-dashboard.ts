// Pure engine for the form class adviser's attendance dashboard.
//
// The registrar's /attendance answers "how is the school doing". An adviser has
// a different question and asks it every morning: IS TODAY MARKED. That is
// binary, it expires daily, and it is what this file computes.
//
// Everything here is pure — no Supabase, no `server-only` — so the rules that
// matter (what counts as marked, which past days slipped, what the headline
// says) are unit-testable without a database. The queries live in
// lib/attendance/adviser-dashboard-queries.ts, which composes these.
//
// SCOPE INVARIANT: every figure this produces belongs to sections the viewer
// ADVISES. Attendance is `is_adviser_for_section` at the database (migration
// 005), and the two attendance pages that read marks through the service client
// had to be gated by hand for exactly that reason (KD #163). Nothing
// school-wide may appear on this surface.

import type { AttendanceStatus } from '@/lib/schemas/attendance';

/** One mark, narrowed to what this engine needs. Field names mirror
 *  `DailyEntryRow` (lib/attendance/queries.ts) so callers pass rows straight
 *  through. Status is the stored letter code — P / L / EX / A / NC. */
export type MarkLite = {
  sectionStudentId: string;
  date: string;
  status: AttendanceStatus;
  recordedAt: string | null;
};

export type TodayTally = {
  /** Distinct students carrying a mark today, `NC` included — see below. */
  marked: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Students marked `NC` (no class). Counted as marked, shown separately. */
  noClass: number;
  /** Most recent `recordedAt` among today's marks, or null. */
  lastMarkedAt: string | null;
};

/**
 * Today's marks for one section, collapsed to a tally.
 *
 * Deduped per student, keeping the LATEST row — `attendance_daily` is
 * append-only for corrections (Hard Rule #6), so a corrected student has more
 * than one row for the same date and counting rows would both inflate `marked`
 * and count the superseded status. `getDailyForSection` already returns
 * newest-first, but this does not depend on that: it compares `recorded_at`
 * explicitly, because relying on the caller's ordering is how a silent
 * miscount gets introduced later.
 */
export function tallyToday(marks: readonly MarkLite[]): TodayTally {
  const latest = new Map<string, MarkLite>();
  for (const m of marks) {
    const prev = latest.get(m.sectionStudentId);
    if (!prev) {
      latest.set(m.sectionStudentId, m);
      continue;
    }
    if ((m.recordedAt ?? '') > (prev.recordedAt ?? '')) {
      latest.set(m.sectionStudentId, m);
    }
  }

  const tally: TodayTally = {
    marked: latest.size,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    noClass: 0,
    lastMarkedAt: null,
  };

  for (const m of latest.values()) {
    // The five stored codes (lib/schemas/attendance.ts). `EX` covers all three
    // excuse subtypes — the subtype drives the leave quotas, not this tally.
    if (m.status === 'P') tally.present += 1;
    else if (m.status === 'L') tally.late += 1;
    else if (m.status === 'A') tally.absent += 1;
    else if (m.status === 'EX') tally.excused += 1;
    else if (m.status === 'NC') tally.noClass += 1;

    if (
      m.recordedAt &&
      (!tally.lastMarkedAt || m.recordedAt > tally.lastMarkedAt)
    ) {
      tally.lastMarkedAt = m.recordedAt;
    }
  }

  return tally;
}

/**
 * School days that came and went without a single mark.
 *
 * `encodableDates` is the calendar's own list of days that ACCEPT marks —
 * `school_day` and `hbl` only (KD #50/#98), already audience-resolved. So a
 * public holiday can never appear here, which is the whole reason this takes
 * the calendar rather than walking the date range itself.
 *
 * `today` is excluded: an unmarked today is not a day that slipped, it is the
 * job the top of the page is asking for. Counting it in both places would
 * double-report the same task.
 *
 * A day with even one mark is treated as done. Partial marking is a real state
 * but it is not this signal — a half-marked day looks nothing like a forgotten
 * one, and conflating them would make the count untrustworthy.
 */
export function unmarkedSchoolDays(
  encodableDates: readonly string[],
  markedDates: ReadonlySet<string>,
  today: string
): string[] {
  return encodableDates.filter((d) => d < today && !markedDates.has(d)).sort();
}

export type SectionTodayState =
  | { kind: 'marked'; tally: TodayTally }
  | { kind: 'unmarked' }
  /** Today accepts no marks at all — a holiday, a break, or a no-class day. */
  | { kind: 'not-a-school-day' };

export type AdviserSection = {
  sectionId: string;
  sectionName: string;
  levelLabel: string | null;
  rosterCount: number;
  today: SectionTodayState;
  /** Past school days with no marks, oldest first. */
  unmarked: string[];
};

/**
 * The one sentence at the top.
 *
 * Deliberately names the class when exactly one is outstanding — "1 class needs
 * marking" makes the adviser open the page to find out which, which is the work
 * the sentence was supposed to save them.
 */
export function headlineFor(
  sections: readonly AdviserSection[],
  isSchoolDay: boolean,
  holidayLabel: string | null
): string {
  if (sections.length === 0) {
    return 'No classes are assigned to you yet.';
  }
  if (!isSchoolDay) {
    return holidayLabel
      ? `${holidayLabel} — no register today.`
      : 'No register today — not a school day.';
  }

  const outstanding = sections.filter((s) => s.today.kind === 'unmarked');
  if (outstanding.length === 0) {
    return sections.length === 1
      ? `${sections[0].sectionName} is marked for today.`
      : 'All your classes are marked for today.';
  }
  if (outstanding.length === 1) {
    return `${outstanding[0].sectionName} isn't marked yet.`;
  }
  return `${outstanding.length} of your classes aren't marked yet.`;
}

/** Supporting line under the headline. Empty string when there is nothing to add. */
export function subheadFor(
  sections: readonly AdviserSection[],
  isSchoolDay: boolean,
  nextSchoolDay: string | null
): string {
  if (sections.length === 0 || !isSchoolDay) {
    return nextSchoolDay ? `Next school day is ${nextSchoolDay}.` : '';
  }
  const done = sections.filter((s) => s.today.kind === 'marked');
  const outstanding = sections.filter((s) => s.today.kind === 'unmarked');

  if (outstanding.length === 0) {
    const last = done
      .map((s) =>
        s.today.kind === 'marked' ? s.today.tally.lastMarkedAt : null
      )
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);
    return last
      ? `Last one in at ${formatTime(last)}. Nothing outstanding.`
      : '';
  }
  if (done.length > 0) {
    return done.length === 1
      ? `${done[0].sectionName} is done.`
      : `${done.length} of your classes are already done.`;
  }
  return '';
}

/** `07:42` in Singapore time. Marks are stamped as UTC timestamps (KD #32). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });
}

/** `Tue 22 Jul` — for listing the days that slipped. */
export function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Singapore',
  });
}

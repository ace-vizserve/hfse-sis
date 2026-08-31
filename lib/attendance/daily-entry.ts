import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import {
  isEncodableDayType,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';

/**
 * A single student's mark for the day being edited.
 *
 * ⚠ THREE STATES, NOT TWO — the daily register marks the EXCEPTIONS, so the
 * absence of an entry already carries meaning:
 *
 *   (a) NOT IN the `marks` map          — the teacher has not touched this
 *                                          student, which by this register's
 *                                          convention means Present;
 *   (b) in the map with a status        — an explicit P / L / EX / A / NC;
 *   (c) in the map with `status: null`  — the teacher explicitly REMOVED the
 *                                          mark, returning the day to unmarked
 *                                          (migration 134).
 *
 * (a) and (c) look alike and mean opposite things: (a) submits 'P', (c) submits
 * nothing at all for that day. Never collapse them.
 */
export type DailyMark = {
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  /** Free-text "why" on an EX mark. Null when absent or not applicable. */
  exNote: string | null;
};

// One entry in the bulk PATCH /api/attendance/daily payload.
export type SubmitEntry = {
  sectionStudentId: string;
  termId: string;
  date: string;
  /**
   * `null` REMOVES the mark — the row is appended with no status, so the day
   * falls back out of every rollup (migration 134). A cleared entry carries
   * neither `exReason` nor `exNote`; the database refuses one that does.
   */
  status: AttendanceStatus | null;
  exReason?: ExReason;
  /**
   * Sent as an explicit `null` to CLEAR a note, and omitted when there is
   * nothing to say. The route distinguishes the two, so this cannot be
   * collapsed into `exNote?: string`.
   */
  exNote?: string | null;
};

/** Encodable school-day dates for the term, ascending. */
export function encodableDates(calendar: SchoolCalendarRow[]): string[] {
  return calendar
    .filter((c) => isEncodableDayType(c.dayType, c.hblOverlay))
    .map((c) => c.date)
    .sort();
}

/**
 * Default date to open the view on. `today` is a yyyy-MM-dd string.
 * - today, if encodable
 * - else the nearest encodable day before today
 * - else the first encodable day (today precedes all)
 * - null if there are no encodable days
 */
export function pickDefaultDate(
  encodable: string[],
  today: string
): string | null {
  if (encodable.length === 0) return null;
  if (encodable.includes(today)) return today;
  const before = encodable.filter((d) => d < today);
  if (before.length > 0) return before[before.length - 1];
  return encodable[0];
}

/**
 * Latest mark per student for `date` (input rows are latest-first per the
 * query).
 *
 * A row whose status is missing is a day that was CLEARED (migration 134). It
 * is kept in the map, carrying a null status, so the panel re-opens showing
 * state (c) — "the mark was removed" — rather than state (a), "nobody has
 * touched this student yet". Dropping it would make a re-submit write Present.
 */
export function loadedMarksForDate(
  daily: DailyEntryRow[],
  date: string
): Map<string, DailyMark> {
  const map = new Map<string, DailyMark>();
  for (const r of daily) {
    if (r.date !== date) continue;
    if (map.has(r.sectionStudentId)) continue; // first seen = latest (query order)
    map.set(r.sectionStudentId, {
      status: r.status,
      exReason: r.exReason,
      // Carried back deliberately: without it, re-submitting an unchanged day
      // would compare against a note-less baseline and clear every note.
      exNote: r.exNote,
    });
  }
  return map;
}

/** Is this student markable on `date`? (active, joined on/before the date). */
function isEligible(e: WideGridEnrolment, date: string): boolean {
  if (e.withdrawn) return false;
  if (e.enrollmentDate && e.enrollmentDate > date) return false;
  return true;
}

/**
 * Whether the stored mark already equals the target, so the submit can skip it.
 *
 * `exNote` MUST be part of this. It was left out at first and the failure is
 * silent and total: a teacher who edits only the note gets an empty write set
 * and the toast "No changes to submit", with their typing discarded. Compare
 * normalised — the UI hands back `''` for an emptied input while the ledger
 * stores `null`, and those mean the same thing.
 *
 * `status` may be null on EITHER side — a cleared target, or a day already on
 * file as cleared — and `===` compares those correctly. What it must NOT do is
 * treat a missing `a` as equal to a cleared `b`: "no row on file" and "a row
 * saying unmarked" are different, and the caller handles that case before
 * asking.
 */
function sameMark(a: DailyMark | undefined, b: DailyMark): boolean {
  if (a == null) return false;
  const note = (v: string | null) => (v == null || v === '' ? null : v);
  return (
    a.status === b.status &&
    a.exReason === b.exReason &&
    note(a.exNote) === note(b.exNote)
  );
}

/**
 * Mark-the-exceptions write set: every eligible student gets `P` unless the
 * teacher set an explicit mark. Students whose target already matches what's
 * on file are skipped (idempotent re-submit — append-only ledger stays clean).
 *
 * Handles all three states described on `DailyMark`:
 *   (a) no entry in `marks`     -> submits 'P'  (the register's convention)
 *   (b) an entry with a status  -> submits that mark
 *   (c) an entry with `status: null` (the teacher removed the mark)
 *                               -> submits `status: null`, or NOTHING at all
 *                                  when the student had no mark on file to
 *                                  remove.
 */
export function computeSubmitEntries(input: {
  roster: WideGridEnrolment[];
  marks: Map<string, DailyMark>;
  loaded: Map<string, DailyMark>;
  termId: string;
  date: string;
  /**
   * Enrolments whose day is covered by an APPROVED parent filing. They are
   * left alone rather than defaulted to Present — see the guard below.
   */
  excusedByFiling?: ReadonlySet<string>;
}): SubmitEntry[] {
  const { roster, marks, loaded, termId, date, excusedByFiling } = input;
  const out: SubmitEntry[] = [];
  for (const e of roster) {
    if (!isEligible(e, date)) continue;

    // ⚠ DO NOT MARK A CHILD PRESENT ON A DAY THE SCHOOL APPROVED AS EXCUSED.
    //
    // The `?? {status:'P'}` below is this register's convention — you mark the
    // exceptions and everyone else is present — and it is normally safe
    // because `marks` seeds from `loaded`, so a student the approval already
    // marked EX is in the map and `sameMark` skips them.
    //
    // But AN APPROVED FILING DOES NOT GUARANTEE A MARK EXISTS. Two ways it
    // doesn't: `lib/declarations/register.ts` leaves the filing approved and
    // only stamps `register_write_error` when the write throws (KD #197 — a
    // failed register write never un-does the approval), and its
    // `if (days.length > 0)` guard writes nothing at all when the filed range
    // expands to zero school days, while still reporting success. In both
    // cases there is nothing in `loaded` to seed from, so an untouched row
    // would submit Present over a day the school agreed the child was away —
    // and nobody is told, because this needs no human error to happen.
    //
    // Not touching the row is the whole fix: no entry is emitted, so the day
    // keeps saying what it already says. A teacher who DELIBERATELY picks a
    // mark here is still obeyed — that is a considered act, and it is the
    // other, louder half of this problem, which is not settled yet.
    if (!marks.has(e.enrolmentId) && excusedByFiling?.has(e.enrolmentId)) {
      continue;
    }

    const target: DailyMark = marks.get(e.enrolmentId) ?? {
      status: 'P',
      exReason: null,
      exNote: null,
    };
    const previous = loaded.get(e.enrolmentId);

    // (c) Removing a mark from a student who has none on file writes nothing.
    // There is no day to undo, and an unmarked day is what a cleared row would
    // have produced anyway — so this would append a row that says exactly what
    // the ledger already says.
    if (target.status == null && previous == null) continue;

    if (sameMark(previous, target)) continue;

    // (c) A cleared day carries no excuse. Both keys are omitted rather than
    // sent as null: the row is appended fresh, and
    // `attendance_daily_cleared_has_no_reason_chk` refuses a reason or a note
    // beside a missing status.
    if (target.status == null) {
      out.push({ sectionStudentId: e.enrolmentId, termId, date, status: null });
      continue;
    }

    // A note only travels with EX. An emptied input arrives as '' and must be
    // sent as an explicit null so the route can tell "clear this" from "no
    // opinion" — omitting the key would silently preserve the old note.
    const note =
      target.status === 'EX' && target.exNote != null && target.exNote !== ''
        ? target.exNote
        : null;
    const hadNote = previous?.exNote != null && previous.exNote !== '';

    out.push({
      sectionStudentId: e.enrolmentId,
      termId,
      date,
      status: target.status,
      ...(target.status === 'EX' && target.exReason
        ? { exReason: target.exReason }
        : {}),
      ...(note != null ? { exNote: note } : hadNote ? { exNote: null } : {}),
    });
  }
  return out;
}

/**
 * Live tally for the header strip.
 *
 * `unmarked` and `cleared` are SEPARATE and must stay that way. `unmarked` is
 * state (a) — nobody has touched the student, so they submit as Present, and
 * the submit bar counts them among the present. `cleared` is state (c) — the
 * teacher removed the mark on purpose, so that day records nothing and the
 * student must not be counted present.
 */
export function tally(input: {
  roster: WideGridEnrolment[];
  marks: Map<string, DailyMark>;
  date: string;
}): {
  P: number;
  L: number;
  A: number;
  EX: number;
  unmarked: number;
  cleared: number;
} {
  const { roster, marks, date } = input;
  const t = { P: 0, L: 0, A: 0, EX: 0, unmarked: 0, cleared: 0 };
  for (const e of roster) {
    if (!isEligible(e, date)) continue;
    const m = marks.get(e.enrolmentId);
    if (!m) {
      t.unmarked += 1;
      continue;
    }
    if (m.status == null) {
      t.cleared += 1;
      continue;
    }
    t[m.status === 'NC' ? 'unmarked' : m.status] += 1;
  }
  return t;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeAnnualGrade } from '@/lib/compute/annual';
import { getEncodableDatesForTerm } from '@/lib/attendance/calendar';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { DEFAULT_SCHOOL_CONFIG, type SchoolConfig } from '@/lib/sis/school-config';

// Fully-resolved report card payload for one student in the current academic
// year. Staff (`/markbook/report-cards/[studentId]`) and parent
// (`/parent/report-cards/[studentId]`) views both call this.

export type Cell = { quarterly: number | null; letter: string | null; is_na: boolean };

export type SubjectRow = {
  subject: { id: string; code: string; name: string; is_examinable: boolean };
  t1: Cell;
  t2: Cell;
  t3: Cell;
  t4: Cell;
  annual: number | null;
};

export type Term = {
  id: string;
  term_number: number;
  label: string;
  /**
   * Free-text virtue theme set per term in SIS Admin. Renders as the
   * parenthetical on T1–T3 report cards: "Form Class Adviser's Comments
   * (HFSE Virtues: {virtue_theme})". NULL for terms where Joann hasn't
   * configured a theme (or for T4, which has no comment section).
   */
  virtue_theme: string | null;
};

export type AttendanceRecord = {
  term_id: string;
  school_days: number | null;
  days_present: number | null;
  days_late: number | null;
};

export type CommentRecord = { term_id: string; comment: string | null };

export type ReportCardPayload = {
  ay: { id: string; label: string };
  terms: Term[];
  student: {
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
    full_name: string;
  };
  section: {
    id: string;
    name: string;
    form_class_adviser: string | null;
  };
  level: { id: string; code: string; label: string; level_type: string };
  enrollment_status: string;
  subjects: SubjectRow[];
  attendance: AttendanceRecord[];
  comments: CommentRecord[];
  // School-wide rendered text: signature names + PEI reg number. Sourced
  // from the singleton `school_config` row (editable at
  // /sis/admin/school-config). Always populated — defaults to empty strings
  // + 30-day publication window when unset.
  schoolConfig: SchoolConfig;
};

export type BuildReportCardError =
  | { kind: 'student_not_found' }
  | { kind: 'no_current_ay' }
  | { kind: 'not_enrolled_this_ay'; ayLabel: string }
  | { kind: 'level_not_found' };

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

const empty: Cell = { quarterly: null, letter: null, is_na: false };

export async function buildReportCard(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ ok: true; payload: ReportCardPayload } | { ok: false; error: BuildReportCardError }> {
  const { data: student } = await supabase
    .from('students')
    .select('id, student_number, last_name, first_name, middle_name')
    .eq('id', studentId)
    .single();
  if (!student) return { ok: false, error: { kind: 'student_not_found' } };

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, label')
    .eq('is_current', true)
    .single();
  if (!ay) return { ok: false, error: { kind: 'no_current_ay' } };

  const { data: terms } = await supabase
    .from('terms')
    .select('id, term_number, label, virtue_theme')
    .eq('academic_year_id', ay.id)
    .order('term_number');
  const termList = (terms ?? []) as Term[];

  const { data: enrolments } = await supabase
    .from('section_students')
    .select(
      `id, enrollment_status, created_at,
       section:sections!inner(id, name, form_class_adviser, academic_year_id,
         level:levels(id, code, label, level_type))`,
    )
    .eq('student_id', studentId);

  type LevelLite = { id: string; code: string; label: string; level_type: string };
  type SectionLite = {
    id: string;
    name: string;
    form_class_adviser: string | null;
    academic_year_id: string;
    level: LevelLite | LevelLite[] | null;
  };
  type Enrolment = {
    id: string;
    enrollment_status: string;
    created_at: string | null;
    section: SectionLite | SectionLite[] | null;
  };

  // Collect every enrolment in the current AY. Per KD #67, mid-year section
  // transfers atomically withdraw the old section_students row and insert a
  // new one — so a transferred student has TWO rows for the same AY (one
  // `withdrawn`, one `active`). The report card represents the student, not
  // the section, so we union grade entries + attendance across both rows
  // (and drop the section_id filter on writeups, which are per-student-per-
  // term per the migration-018 unique constraint).
  const ayEnrolments = ((enrolments ?? []) as Enrolment[])
    .map((e) => ({ ...e, section: first(e.section) }))
    .filter((e): e is { id: string; enrollment_status: string; created_at: string | null; section: SectionLite } =>
      !!e.section && e.section.academic_year_id === ay.id,
    );
  if (ayEnrolments.length === 0) {
    return { ok: false, error: { kind: 'not_enrolled_this_ay', ayLabel: ay.label } };
  }

  // Pick the "primary" enrolment for the report header (section name, FCA,
  // level). Status priority: active > late_enrollee > withdrawn. Tie-break
  // by created_at desc so the most recently created row wins (covers the
  // post-transfer scenario where the new row is the operationally relevant
  // one even if the old withdrawn row was created earlier).
  const STATUS_RANK: Record<string, number> = {
    active: 0,
    late_enrollee: 1,
    withdrawn: 2,
  };
  const sortedEnrolments = ayEnrolments.slice().sort((a, b) => {
    const sa = STATUS_RANK[a.enrollment_status] ?? 3;
    const sb = STATUS_RANK[b.enrollment_status] ?? 3;
    if (sa !== sb) return sa - sb;
    // Tie-break: most recent first (created_at desc).
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  const primary = sortedEnrolments[0];
  const section = primary.section;
  const level = first(section.level);
  if (!level) return { ok: false, error: { kind: 'level_not_found' } };

  // For grade-entry / attendance / writeup union: collect every distinct
  // section_student_id and section_id this student touched in the current AY.
  const allEnrolmentIds = ayEnrolments.map((e) => e.id);
  const allSectionIds = Array.from(new Set(ayEnrolments.map((e) => e.section.id)));

  const { data: configs } = await supabase
    .from('subject_configs')
    .select('subject:subjects(id, code, name, is_examinable)')
    .eq('academic_year_id', ay.id)
    .eq('level_id', level.id);

  type CfgRow = {
    subject:
      | { id: string; code: string; name: string; is_examinable: boolean }
      | { id: string; code: string; name: string; is_examinable: boolean }[]
      | null;
  };
  const subjects = ((configs ?? []) as CfgRow[])
    .map((c) => first(c.subject))
    .filter((s): s is { id: string; code: string; name: string; is_examinable: boolean } => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Grading sheets across every section the student touched this AY (so a
  // transferred student's old-section sheets are visible too). Term filter
  // keeps the result tight even when the student has multiple sections.
  const { data: sheets } = await supabase
    .from('grading_sheets')
    .select('id, term_id, subject_id, section_id')
    .in('section_id', allSectionIds)
    .in('term_id', termList.map((t) => t.id));

  const sheetList = (sheets ?? []) as Array<{
    id: string;
    term_id: string;
    subject_id: string;
    section_id: string;
  }>;

  // Grade entries across every enrolment row this student has in this AY.
  // For a non-transferred student this is the single (sheet × enrolment)
  // pair we used to query directly; for a transferred student it's the
  // union of both old + new section_student_ids.
  const { data: entries } = sheetList.length > 0
    ? await supabase
        .from('grade_entries')
        .select('grading_sheet_id, section_student_id, quarterly_grade, letter_grade, is_na')
        .in('grading_sheet_id', sheetList.map((s) => s.id))
        .in('section_student_id', allEnrolmentIds)
    : { data: [] };

  type EntryRow = {
    grading_sheet_id: string;
    section_student_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
  };
  const allEntries = (entries ?? []) as EntryRow[];

  // Pick the most informative entry for a given (subject, term) when the
  // student has multiple — prefer entries with a non-null grade or a
  // deliberate is_na flag, then break ties by preferring the primary
  // (active) enrolment. Returns null when nothing exists.
  function pickBestEntry(candidates: EntryRow[]): EntryRow | null {
    if (candidates.length === 0) return null;
    const filled = candidates.filter(
      (e) => e.quarterly_grade != null || e.letter_grade != null || e.is_na,
    );
    const pool = filled.length > 0 ? filled : candidates;
    return pool.find((e) => e.section_student_id === primary.id) ?? pool[0];
  }

  const subjectRows: SubjectRow[] = subjects.map((sub) => {
    const byTerm: Record<number, Cell> = {};
    for (const t of termList) {
      // Find every sheet covering this (term, subject) across the student's
      // sections, then every entry against any of the student's enrolments.
      const sheetIds = sheetList
        .filter((s) => s.term_id === t.id && s.subject_id === sub.id)
        .map((s) => s.id);
      const candidates = allEntries.filter((e) => sheetIds.includes(e.grading_sheet_id));
      const entry = pickBestEntry(candidates);
      byTerm[t.term_number] = entry
        ? {
            quarterly: entry.quarterly_grade ?? null,
            letter: entry.letter_grade ?? null,
            is_na: Boolean(entry.is_na),
          }
        : empty;
    }
    const annual = sub.is_examinable
      ? computeAnnualGrade(
          byTerm[1]?.quarterly ?? null,
          byTerm[2]?.quarterly ?? null,
          byTerm[3]?.quarterly ?? null,
          byTerm[4]?.quarterly ?? null,
        )
      : null;
    return {
      subject: sub,
      t1: byTerm[1] ?? empty,
      t2: byTerm[2] ?? empty,
      t3: byTerm[3] ?? empty,
      t4: byTerm[4] ?? empty,
      annual,
    };
  });

  // Attendance: union per-student counts across every enrolment row in
  // this AY so a transferred student's pre + post-transfer days both show
  // on their report card. (`attendance_records` is unique per
  // `(term_id, section_student_id)`, so for a non-transferred student each
  // term has at most one row and the sum is just that row's value.)
  //
  // NOTE on school_days: the rolled-up `attendance_records.school_days`
  // counts the student's *recorded* daily rows (excluding NC). On a
  // report card we need the term's *total* school days (the denominator
  // — i.e., the number of teaching days in the term per the school
  // calendar) regardless of whether attendance has been entered yet. We
  // override school_days below with the school_calendar count.
  const { data: attendanceRaw } = await supabase
    .from('attendance_records')
    .select('term_id, days_present, days_late')
    .in('section_student_id', allEnrolmentIds)
    .in('term_id', termList.map((t) => t.id));

  type AttendanceRow = {
    term_id: string;
    days_present: number | null;
    days_late: number | null;
  };
  const studentDaysByTerm = new Map<
    string,
    { days_present: number | null; days_late: number | null }
  >();
  for (const r of (attendanceRaw ?? []) as AttendanceRow[]) {
    const cur = studentDaysByTerm.get(r.term_id);
    // Sum nullables — null + null = null, null + N = N.
    const sumNullable = (a: number | null, b: number | null) =>
      a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    if (!cur) {
      studentDaysByTerm.set(r.term_id, {
        days_present: r.days_present,
        days_late: r.days_late,
      });
    } else {
      studentDaysByTerm.set(r.term_id, {
        days_present: sumNullable(cur.days_present, r.days_present),
        days_late: sumNullable(cur.days_late, r.days_late),
      });
    }
  }

  // Per-term school_days = count of school_calendar rows in the term where
  // day_type IN ('school_day','hbl'), with audience precedence applied for
  // the student's level type (KD #50 + #76). When the calendar isn't
  // configured for a term yet the helper returns 0 — fall back to the
  // student-recorded count from `attendance_records` so the report card
  // doesn't mis-render as 0 / N during early-term setup.
  const levelType = levelTypeForAudienceLookup(level.code);
  const calendarSchoolDaysByTerm = new Map<string, number>();
  await Promise.all(
    termList.map(async (t) => {
      const dates = await getEncodableDatesForTerm(t.id, levelType);
      calendarSchoolDaysByTerm.set(t.id, dates.length);
    }),
  );

  // Fallback recorded-days count per term — needed only when the calendar
  // helper returns 0 for a term (legacy / unconfigured). Matches the
  // pre-fix behavior of reading `attendance_records.school_days`.
  const { data: recordedSchoolDaysRaw } = await supabase
    .from('attendance_records')
    .select('term_id, school_days')
    .in('section_student_id', allEnrolmentIds)
    .in('term_id', termList.map((t) => t.id));
  const recordedSchoolDaysByTerm = new Map<string, number>();
  for (const r of (recordedSchoolDaysRaw ?? []) as Array<{
    term_id: string;
    school_days: number | null;
  }>) {
    recordedSchoolDaysByTerm.set(
      r.term_id,
      (recordedSchoolDaysByTerm.get(r.term_id) ?? 0) + (r.school_days ?? 0),
    );
  }

  const attendance: AttendanceRecord[] = termList.map((t) => {
    const studentDays = studentDaysByTerm.get(t.id) ?? {
      days_present: null,
      days_late: null,
    };
    const calendarCount = calendarSchoolDaysByTerm.get(t.id) ?? 0;
    const schoolDays =
      calendarCount > 0
        ? calendarCount
        : recordedSchoolDaysByTerm.get(t.id) ?? null;
    return {
      term_id: t.id,
      school_days: schoolDays,
      days_present: studentDays.days_present,
      days_late: studentDays.days_late,
    };
  });

  // KD #49: FCA comments on T1–T3 report cards come from `evaluation_writeups`.
  // The table is uniquely keyed on `(term_id, student_id)` (migration 018) so
  // dropping the `section_id` filter is safe — at most one row per (student,
  // term) regardless of which section authored it. This lets a T1 writeup
  // authored under the OLD section show up after a mid-year transfer.
  const { data: writeups } = await supabase
    .from('evaluation_writeups')
    .select('term_id, writeup')
    .eq('student_id', student.id)
    .in('term_id', termList.map((t) => t.id));
  const comments: CommentRecord[] = ((writeups ?? []) as Array<{
    term_id: string;
    writeup: string | null;
  }>).map((w) => ({ term_id: w.term_id, comment: w.writeup }));

  const fullName = [student.last_name, student.first_name, student.middle_name]
    .filter(Boolean)
    .join(', ');

  // School-wide config (singleton, id=1). Uses its own service-role helper
  // to sidestep RLS; falls back to defaults if the row is missing for any
  // reason so the report card still renders.
  const { getSchoolConfig } = await import('@/lib/sis/school-config');
  const schoolConfig = await getSchoolConfig().catch(() => DEFAULT_SCHOOL_CONFIG);

  return {
    ok: true,
    payload: {
      ay: { id: ay.id, label: ay.label },
      terms: termList,
      student: { ...student, full_name: fullName },
      section: {
        id: section.id,
        name: section.name,
        form_class_adviser: section.form_class_adviser,
      },
      level,
      enrollment_status: primary.enrollment_status,
      subjects: subjectRows,
      attendance,
      comments,
      schoolConfig,
    },
  };
}

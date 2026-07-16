import type { SupabaseClient } from '@supabase/supabase-js';
import { computeAnnualGrade } from '@/lib/compute/annual';
import {
  isEnrolledForTerm,
  termEnrolment,
} from '@/lib/report-card/enrolment-coverage';
import {
  resolveNonExaminableLetter,
  deriveAnnualLetterForNonExam,
} from '@/lib/compute/letter-grade';
import { getEncodableDatesForTerm } from '@/lib/attendance/calendar';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import {
  DEFAULT_SCHOOL_CONFIG,
  type SchoolConfig,
} from '@/lib/sis/school-config';
import {
  resolveReportSubjects,
  type ReportMapEntry,
  type ReportTargetMeta,
} from '@/lib/report-card/resolve-report-subjects';

// Fully-resolved report card payload for one student in the current academic
// year. Staff (`/markbook/report-cards/[studentId]`) and parent
// (`/parent/report-cards/[studentId]`) views both call this.

export type Cell = {
  quarterly: number | null;
  letter: string | null;
  is_na: boolean;
};

export type SubjectRow = {
  subject: { id: string; code: string; name: string; is_examinable: boolean };
  t1: Cell;
  t2: Cell;
  t3: Cell;
  t4: Cell;
  annual: number | null;
  /** Resolved year-end letter for non-examinable: override ?? derived. Always null for examinable. */
  annual_letter: string | null;
  /** Raw DB value of grade_entries.annual_letter_grade (null if not explicitly set). */
  annual_letter_override: string | null;
  /** Auto-derived annual letter from term quarterly scores, ignoring any override. */
  annual_letter_derived: string | null;
  /** T4 grade_entry.id — null if no T4 entry exists yet. Used by the report-card edit control. */
  t4_entry_id: string | null;
  /** T4 grading_sheet.id — null if no T4 sheet exists. Used by the report-card edit control. */
  t4_sheet_id: string | null;
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
  start_date: string;
  end_date: string;
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

const first = <T>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const empty: Cell = { quarterly: null, letter: null, is_na: false };

// Batch-print optimisation: the section batch-print page
// (app/(markbook)/markbook/report-cards/section/[sectionId]/print) calls
// buildReportCard once per student in the SAME section — every one of those
// students shares the same level, and `getEncodableDatesForTerm` doesn't
// vary by student, only by (term, levelType). Passing a pre-fetched map here
// lets a batch caller resolve each (term, levelType) pair's encodable dates
// ONCE and reuse them across every buildReportCard call in the batch,
// instead of this function's internal per-student N-term fan-out repeating
// identical calendar queries. Optional — when omitted, behavior (and query
// count) for a single-student build is byte-identical to before this
// parameter existed. Mirrors the `PreloadedSyncSnapshot` pattern in
// lib/sync/students.ts (a request-scoped object passed by the caller, never
// a module-level/global cache).
export type PreloadedCalendarDates = {
  // Keyed by `${termId}:${levelType ?? 'none'}` — matches exactly how this
  // function itself derives its cache key below, so a set of dates fetched
  // for one levelType is never mistakenly reused for another.
  byTermAndLevel: Map<string, string[]>;
};

export async function buildReportCard(
  supabase: SupabaseClient,
  studentId: string,
  preloadedCalendar?: PreloadedCalendarDates
): Promise<
  | { ok: true; payload: ReportCardPayload }
  | { ok: false; error: BuildReportCardError }
> {
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
    .select('id, term_number, label, virtue_theme, start_date, end_date')
    .eq('academic_year_id', ay.id)
    .order('term_number');
  const termList = (terms ?? []) as Term[];

  const { data: enrolments } = await supabase
    .from('section_students')
    .select(
      `id, enrollment_status, created_at, enrollment_date, withdrawal_date,
       section:sections!inner(id, name, form_class_adviser, academic_year_id,
         level:levels(id, code, label, level_type))`
    )
    .eq('student_id', studentId);

  type LevelLite = {
    id: string;
    code: string;
    label: string;
    level_type: string;
  };
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
    enrollment_date: string | null;
    withdrawal_date: string | null;
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
    .filter(
      (
        e
      ): e is {
        id: string;
        enrollment_status: string;
        created_at: string | null;
        enrollment_date: string | null;
        withdrawal_date: string | null;
        section: SectionLite;
      } => !!e.section && e.section.academic_year_id === ay.id
    );
  if (ayEnrolments.length === 0) {
    return {
      ok: false,
      error: { kind: 'not_enrolled_this_ay', ayLabel: ay.label },
    };
  }

  // Per-term enrolment coverage (KD #67 transfer-safe: union of all rows).
  // Drives N.A. for terms the student wasn't enrolled in (late enrollee pre-join
  // / post-withdrawal) on both attendance and grades.
  const coverage = ayEnrolments.map((e) => ({
    start: e.enrollment_date,
    end: e.withdrawal_date,
  }));
  const enrolledByTermNumber = new Map<number, boolean>();
  for (const t of termList) {
    enrolledByTermNumber.set(
      t.term_number,
      isEnrolledForTerm(coverage, t.start_date, t.end_date)
    );
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

  // Form class adviser — resolved LIVE from teacher_assignments, matching
  // lib/markbook/publish-readiness.ts's existing rationale: the denormalized
  // `sections.form_class_adviser` mirror is best-effort-written on assign
  // and never cleared on unassign (app/api/teacher-assignments/*), so it can
  // silently drift from who's actually assigned. Do not reach for the
  // mirror column here even though it's still selected above.
  const { data: adviserRow } = await supabase
    .from('teacher_assignments')
    .select('teacher_user_id')
    .eq('section_id', section.id)
    .eq('role', 'form_adviser')
    .maybeSingle();
  let formClassAdviser: string | null = null;
  if (adviserRow?.teacher_user_id) {
    const { getStaffDisplayNameById } = await import('@/lib/auth/staff-list');
    const nameById = new Map(await getStaffDisplayNameById());
    formClassAdviser =
      nameById.get(adviserRow.teacher_user_id as string) ??
      (adviserRow.teacher_user_id as string);
  }

  // For grade-entry / attendance / writeup union: collect every distinct
  // section_student_id and section_id this student touched in the current AY.
  const allEnrolmentIds = ayEnrolments.map((e) => e.id);
  const allSectionIds = Array.from(
    new Set(ayEnrolments.map((e) => e.section.id))
  );

  // "Which subjects appear on this report card" is a level-membership
  // question — migration 080 dropped subject_configs.level_id, so this
  // resolves via subject_level_offerings instead (Pattern A).
  const { data: configs } = await supabase
    .from('subject_level_offerings')
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
    .filter(
      (
        s
      ): s is {
        id: string;
        code: string;
        name: string;
        is_examinable: boolean;
      } => !!s
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Report-card grouping map (migration 080, KD reference: subject_report_map
  // wiring task). Global — no AY or level filter, since a mapping is a
  // catalog-shape property, not a per-year one; the target subject (e.g.
  // "Mother Tongue" once real fan-in exists) may not itself appear in this
  // level's `subject_level_offerings` at all — it's only ever a display
  // target, never directly offered. Two plain lookups rather than a
  // `subjects!<fk>(...)` embed hint: no precedent for that embed syntax
  // exists anywhere in this codebase today (the sibling admin route at
  // app/api/sis/admin/subjects/[configId]/report-map/route.ts and
  // lib/sis/subjects/queries.ts::listSubjectReportMap both already do two
  // separate `.from('subjects')` lookups for the same table), so this
  // mirrors that established, easily-testable pattern instead of an
  // unverified one. Every subject is seeded self-mapped (migration 080), so
  // in production today this resolves to a full self-map and
  // resolveReportSubjects is a no-op.
  const { data: reportMapRaw } = await supabase
    .from('subject_report_map')
    .select('subject_id, report_subject_id');
  const reportMap: ReportMapEntry[] = (reportMapRaw ?? []) as ReportMapEntry[];

  const reportTargets = new Map<string, ReportTargetMeta>();
  if (reportMap.length > 0) {
    const targetIds = Array.from(
      new Set(reportMap.map((r) => r.report_subject_id))
    );
    const { data: targetRows } = await supabase
      .from('subjects')
      .select('id, code, name, is_examinable')
      .in('id', targetIds);
    for (const t of (targetRows ?? []) as ReportTargetMeta[]) {
      reportTargets.set(t.id, t);
    }
  }

  // Grading sheets across every section the student touched this AY (so a
  // transferred student's old-section sheets are visible too). Term filter
  // keeps the result tight even when the student has multiple sections.
  const { data: sheets } = await supabase
    .from('grading_sheets')
    .select('id, term_id, subject_id, section_id')
    .in('section_id', allSectionIds)
    .in(
      'term_id',
      termList.map((t) => t.id)
    );

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
  const { data: entries } =
    sheetList.length > 0
      ? await supabase
          .from('grade_entries')
          .select(
            'id, grading_sheet_id, section_student_id, quarterly_grade, letter_grade, is_na, annual_letter_grade'
          )
          .in(
            'grading_sheet_id',
            sheetList.map((s) => s.id)
          )
          .in('section_student_id', allEnrolmentIds)
      : { data: [] };

  type EntryRow = {
    id: string;
    grading_sheet_id: string;
    section_student_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
    annual_letter_grade: string | null;
  };
  const allEntries = (entries ?? []) as EntryRow[];

  // Pick the most informative entry for a given (subject, term) when the
  // student has multiple — prefer entries with a non-null grade or a
  // deliberate is_na flag, then break ties by preferring the primary
  // (active) enrolment. Returns null when nothing exists.
  function pickBestEntry(candidates: EntryRow[]): EntryRow | null {
    if (candidates.length === 0) return null;
    const filled = candidates.filter(
      (e) => e.quarterly_grade != null || e.letter_grade != null || e.is_na
    );
    const pool = filled.length > 0 ? filled : candidates;
    return pool.find((e) => e.section_student_id === primary.id) ?? pool[0];
  }

  const subjectRows: SubjectRow[] = subjects.map((sub) => {
    const byTerm: Record<number, Cell> = {};
    let annual_letter_override: string | null = null;
    let t4_entry_id: string | null = null;
    let t4_sheet_id: string | null = null;
    for (const t of termList) {
      // Find every sheet covering this (term, subject) across the student's
      // sections, then every entry against any of the student's enrolments.
      const sheetIds = sheetList
        .filter((s) => s.term_id === t.id && s.subject_id === sub.id)
        .map((s) => s.id);
      const candidates = allEntries.filter((e) =>
        sheetIds.includes(e.grading_sheet_id)
      );
      const entry = pickBestEntry(candidates);
      byTerm[t.term_number] = entry
        ? {
            quarterly: entry.quarterly_grade ?? null,
            letter: sub.is_examinable
              ? null
              : resolveNonExaminableLetter({
                  isNa: Boolean(entry.is_na),
                  letterOverride: entry.letter_grade,
                  quarterly: entry.quarterly_grade,
                }),
            is_na: Boolean(entry.is_na),
          }
        : empty;
      if (t.term_number === 4 && !sub.is_examinable && entry) {
        annual_letter_override = entry.annual_letter_grade ?? null;
        t4_entry_id = entry.id;
        t4_sheet_id = entry.grading_sheet_id;
      }
    }
    // Terms the student wasn't enrolled for → N.A., so computeAnnualGrade (and
    // the non-exam annual) exclude them and renormalize the remaining weights to
    // 100% instead of treating a missing term as incomplete. quarterly forced
    // null guards the rare stray-grade-on-a-non-enrolled-term case.
    for (const t of termList) {
      if (enrolledByTermNumber.get(t.term_number) === false) {
        byTerm[t.term_number] = { quarterly: null, letter: null, is_na: true };
      }
    }
    const annual_letter_derived = !sub.is_examinable
      ? deriveAnnualLetterForNonExam(
          [1, 2, 3, 4].map((n) => ({
            quarterly: byTerm[n]?.quarterly ?? null,
            isNa: byTerm[n]?.is_na ?? false,
          }))
        )
      : null;
    const annual_letter = !sub.is_examinable ? annual_letter_override : null;
    const annual = sub.is_examinable
      ? computeAnnualGrade(
          byTerm[1]?.quarterly ?? null,
          byTerm[2]?.quarterly ?? null,
          byTerm[3]?.quarterly ?? null,
          byTerm[4]?.quarterly ?? null,
          [
            byTerm[1]?.is_na ?? false,
            byTerm[2]?.is_na ?? false,
            byTerm[3]?.is_na ?? false,
            byTerm[4]?.is_na ?? false,
          ]
        )
      : null;
    return {
      subject: sub,
      t1: byTerm[1] ?? empty,
      t2: byTerm[2] ?? empty,
      t3: byTerm[3] ?? empty,
      t4: byTerm[4] ?? empty,
      annual,
      annual_letter,
      annual_letter_override,
      annual_letter_derived,
      t4_entry_id,
      t4_sheet_id,
    };
  });

  // Fold graded subjects into their report-card display identity per
  // subject_report_map (migration 080). Pure + generic — see
  // lib/report-card/resolve-report-subjects.ts for the algorithm; today
  // (every subject self-mapped) this returns subjectRows unchanged.
  const reportSubjectRows = resolveReportSubjects(
    subjectRows,
    reportMap,
    reportTargets
  );

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
    .in(
      'term_id',
      termList.map((t) => t.id)
    );

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
  const calendarDatesByTerm = new Map<string, string[]>();
  await Promise.all(
    termList.map(async (t) => {
      const cacheKey = `${t.id}:${levelType ?? 'none'}`;
      const cached = preloadedCalendar?.byTermAndLevel.get(cacheKey);
      if (cached) {
        calendarDatesByTerm.set(t.id, cached);
        return;
      }
      const dates = await getEncodableDatesForTerm(t.id, levelType);
      calendarDatesByTerm.set(t.id, dates);
      preloadedCalendar?.byTermAndLevel.set(cacheKey, dates);
    })
  );

  // Fallback recorded-days count per term — needed only when the calendar
  // helper returns 0 for a term (legacy / unconfigured). Matches the
  // pre-fix behavior of reading `attendance_records.school_days`.
  const { data: recordedSchoolDaysRaw } = await supabase
    .from('attendance_records')
    .select('term_id, school_days')
    .in('section_student_id', allEnrolmentIds)
    .in(
      'term_id',
      termList.map((t) => t.id)
    );
  const recordedSchoolDaysByTerm = new Map<string, number>();
  for (const r of (recordedSchoolDaysRaw ?? []) as Array<{
    term_id: string;
    school_days: number | null;
  }>) {
    recordedSchoolDaysByTerm.set(
      r.term_id,
      (recordedSchoolDaysByTerm.get(r.term_id) ?? 0) + (r.school_days ?? 0)
    );
  }

  const attendance: AttendanceRecord[] = [];
  for (const t of termList) {
    const { enrolled, enrolledSchoolDays } = termEnrolment(
      coverage,
      t,
      calendarDatesByTerm.get(t.id) ?? []
    );
    // Not enrolled this term → omit the record. The document renders N.A. for a
    // missing term record, and computeAttendancePercentage then sums only
    // enrolled terms (do NOT push a null-school_days record — that nulls the
    // whole cumulative %).
    if (!enrolled) continue;
    const studentDays = studentDaysByTerm.get(t.id) ?? {
      days_present: null,
      days_late: null,
    };
    // Clamped calendar count; fall back to the recorded (already prorated)
    // rollup count only when the calendar is unconfigured for the term.
    const schoolDays =
      enrolledSchoolDays > 0
        ? enrolledSchoolDays
        : (recordedSchoolDaysByTerm.get(t.id) ?? null);
    attendance.push({
      term_id: t.id,
      school_days: schoolDays,
      days_present: studentDays.days_present,
      days_late: studentDays.days_late,
    });
  }

  // KD #49: FCA comments on T1–T3 report cards come from `evaluation_writeups`.
  // The table is uniquely keyed on `(term_id, student_id)` (migration 018) so
  // dropping the `section_id` filter is safe — at most one row per (student,
  // term) regardless of which section authored it. This lets a T1 writeup
  // authored under the OLD section show up after a mid-year transfer.
  const { data: writeups } = await supabase
    .from('evaluation_writeups')
    .select('term_id, writeup')
    .eq('student_id', student.id)
    .in(
      'term_id',
      termList.map((t) => t.id)
    );
  const comments: CommentRecord[] = (
    (writeups ?? []) as Array<{
      term_id: string;
      writeup: string | null;
    }>
  ).map((w) => ({ term_id: w.term_id, comment: w.writeup }));

  const fullName = [student.last_name, student.first_name, student.middle_name]
    .filter(Boolean)
    .join(', ');

  // School-wide config (singleton, id=1). Uses its own service-role helper
  // to sidestep RLS; falls back to defaults if the row is missing for any
  // reason so the report card still renders.
  const { getSchoolConfig } = await import('@/lib/sis/school-config');
  const schoolConfig = await getSchoolConfig().catch(
    () => DEFAULT_SCHOOL_CONFIG
  );

  return {
    ok: true,
    payload: {
      ay: { id: ay.id, label: ay.label },
      terms: termList,
      student: { ...student, full_name: fullName },
      section: {
        id: section.id,
        name: section.name,
        form_class_adviser: formClassAdviser,
      },
      level,
      enrollment_status: primary.enrollment_status,
      subjects: reportSubjectRows,
      attendance,
      comments,
      schoolConfig,
    },
  };
}

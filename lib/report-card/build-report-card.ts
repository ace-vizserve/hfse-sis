import type { SupabaseClient } from '@supabase/supabase-js';
import { computeAnnualGrade } from '@/lib/compute/annual';
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
      `id, enrollment_status,
       section:sections!inner(id, name, form_class_adviser, academic_year_id,
         level:levels(id, code, label, level_type))`,
    )
    .eq('student_id', studentId);

  type Enrolment = {
    id: string;
    enrollment_status: string;
    section:
      | {
          id: string;
          name: string;
          form_class_adviser: string | null;
          academic_year_id: string;
          level:
            | { id: string; code: string; label: string; level_type: string }
            | { id: string; code: string; label: string; level_type: string }[]
            | null;
        }
      | {
          id: string;
          name: string;
          form_class_adviser: string | null;
          academic_year_id: string;
          level:
            | { id: string; code: string; label: string; level_type: string }
            | { id: string; code: string; label: string; level_type: string }[]
            | null;
        }[]
      | null;
  };

  const enrolment = ((enrolments ?? []) as Enrolment[])
    .map((e) => ({ ...e, section: first(e.section) }))
    .find((e) => e.section?.academic_year_id === ay.id);
  if (!enrolment || !enrolment.section) {
    return { ok: false, error: { kind: 'not_enrolled_this_ay', ayLabel: ay.label } };
  }

  const section = enrolment.section;
  const level = first(section.level);
  if (!level) return { ok: false, error: { kind: 'level_not_found' } };

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

  const { data: sheets } = await supabase
    .from('grading_sheets')
    .select('id, term_id, subject_id')
    .eq('section_id', section.id)
    .in('term_id', termList.map((t) => t.id));

  const sheetList = (sheets ?? []) as Array<{ id: string; term_id: string; subject_id: string }>;

  const { data: entries } = sheetList.length > 0
    ? await supabase
        .from('grade_entries')
        .select('grading_sheet_id, quarterly_grade, letter_grade, is_na')
        .in('grading_sheet_id', sheetList.map((s) => s.id))
        .eq('section_student_id', enrolment.id)
    : { data: [] };

  type EntryRow = {
    grading_sheet_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
  };
  const entriesBySheet = new Map(
    ((entries ?? []) as EntryRow[]).map((e) => [e.grading_sheet_id, e]),
  );

  const subjectRows: SubjectRow[] = subjects.map((sub) => {
    const byTerm: Record<number, Cell> = {};
    for (const t of termList) {
      const sheet = sheetList.find((s) => s.term_id === t.id && s.subject_id === sub.id);
      const entry = sheet ? entriesBySheet.get(sheet.id) : null;
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

  const { data: attendance } = await supabase
    .from('attendance_records')
    .select('term_id, school_days, days_present, days_late')
    .eq('section_student_id', enrolment.id)
    .in('term_id', termList.map((t) => t.id));

  // KD #49: FCA comments on T1–T3 report cards come exclusively from
  // `evaluation_writeups`. We read `writeup` here and expose it as the
  // same `comment` field the template has always consumed, so the render
  // path stays unchanged. Migration 018 backfilled historical
  // `report_card_comments` rows, so this query returns the same data for
  // pre-migration terms and continues to work for new ones.
  const { data: writeups } = await supabase
    .from('evaluation_writeups')
    .select('term_id, writeup')
    .eq('section_id', section.id)
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
      enrollment_status: enrolment.enrollment_status,
      subjects: subjectRows,
      attendance: (attendance ?? []) as AttendanceRecord[],
      comments,
      schoolConfig,
    },
  };
}

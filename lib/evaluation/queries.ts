import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Server-only reads for the Student Evaluation module. All via
// service-role client — reads bypass RLS (pages gate by role upstream via
// getSessionUser + layout check).

export type EvaluationWriteupRow = {
  id: string;
  term_id: string;
  section_id: string;
  student_id: string;
  writeup: string | null;
  submitted: boolean;
  submitted_at: string | null;
};

export type EvaluationTermConfig = {
  termId: string;
  virtueTheme: string | null;
  isOpen: boolean;
  openedAt: string | null;
};

export type EvaluationRosterStudent = {
  section_student_id: string;
  student_id: string;
  index_number: number;
  student_number: string;
  student_name: string;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  writeup: string | null;
  submitted: boolean;
  submitted_at: string | null;
};

// Fetches the term-level config (virtue theme + window open state) for a
// single term. `virtueTheme` lives on `terms`; `isOpen`+`openedAt` live on
// `evaluation_terms` (null if Joann has never opened the window).
export async function getEvaluationTermConfig(termId: string): Promise<EvaluationTermConfig | null> {
  const service = createServiceClient();

  const { data: term, error: termErr } = await service
    .from('terms')
    .select('id, virtue_theme')
    .eq('id', termId)
    .maybeSingle();
  if (termErr || !term) return null;

  const { data: evalTerm } = await service
    .from('evaluation_terms')
    .select('is_open, opened_at')
    .eq('term_id', termId)
    .maybeSingle();

  return {
    termId: term.id,
    virtueTheme: (term.virtue_theme as string | null) ?? null,
    isOpen: (evalTerm?.is_open as boolean | undefined) ?? false,
    openedAt: (evalTerm?.opened_at as string | null | undefined) ?? null,
  };
}

// Roster + writeup state for one section × term. Joins section_students →
// students → evaluation_writeups so the client gets one row per enrolled
// student with their current writeup draft (or nulls if not started).
// Excludes withdrawn students.
export async function getSectionRoster(
  sectionId: string,
  termId: string,
): Promise<EvaluationRosterStudent[]> {
  const service = createServiceClient();

  const { data: enrolments, error } = await service
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)',
    )
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn')
    .order('index_number');
  if (error || !enrolments) return [];

  const studentIds = enrolments
    .map((r) => {
      const s = r.student as { id?: string } | { id: string }[] | null;
      if (Array.isArray(s)) return s[0]?.id;
      return s?.id;
    })
    .filter((id): id is string => !!id);

  const writeupsByStudent = new Map<string, EvaluationWriteupRow>();
  if (studentIds.length > 0) {
    const { data: writeups } = await service
      .from('evaluation_writeups')
      .select('id, term_id, section_id, student_id, writeup, submitted, submitted_at')
      .eq('term_id', termId)
      .in('student_id', studentIds);
    for (const w of (writeups ?? []) as EvaluationWriteupRow[]) {
      writeupsByStudent.set(w.student_id, w);
    }
  }

  return enrolments.map((r) => {
    const s = r.student as
      | { id: string; student_number: string; last_name: string; first_name: string; middle_name: string | null }
      | { id: string; student_number: string; last_name: string; first_name: string; middle_name: string | null }[]
      | null;
    const stu = Array.isArray(s) ? s[0] : s;
    const studentId = stu?.id ?? '';
    const w = writeupsByStudent.get(studentId) ?? null;
    return {
      section_student_id: r.id as string,
      student_id: studentId,
      index_number: r.index_number as number,
      student_number: stu?.student_number ?? '',
      student_name: stu
        ? [stu.last_name, stu.first_name, stu.middle_name].filter(Boolean).join(', ')
        : '(missing student)',
      enrollment_status: r.enrollment_status as EvaluationRosterStudent['enrollment_status'],
      writeup: w?.writeup ?? null,
      submitted: w?.submitted ?? false,
      submitted_at: w?.submitted_at ?? null,
    };
  });
}

// Returns writeup submission progress per section in the given term.
// Used by the /evaluation/sections picker page.
export type SectionWriteupProgress = {
  section_id: string;
  active_count: number;
  submitted_count: number;
};

export async function getWriteupProgressByTerm(
  termId: string,
  sectionIds: string[],
): Promise<Record<string, SectionWriteupProgress>> {
  const out: Record<string, SectionWriteupProgress> = {};
  if (sectionIds.length === 0) return out;

  const service = createServiceClient();

  const { data: enrolments } = await service
    .from('section_students')
    .select('section_id, enrollment_status')
    .in('section_id', sectionIds)
    .neq('enrollment_status', 'withdrawn');

  for (const row of (enrolments ?? []) as Array<{ section_id: string }>) {
    const b = (out[row.section_id] ??= {
      section_id: row.section_id,
      active_count: 0,
      submitted_count: 0,
    });
    b.active_count++;
  }

  const { data: writeups } = await service
    .from('evaluation_writeups')
    .select('section_id, submitted')
    .eq('term_id', termId)
    .eq('submitted', true)
    .in('section_id', sectionIds);

  for (const row of (writeups ?? []) as Array<{ section_id: string }>) {
    const b = (out[row.section_id] ??= {
      section_id: row.section_id,
      active_count: 0,
      submitted_count: 0,
    });
    b.submitted_count++;
  }

  return out;
}

// Which sections does this user advise? Returns the section_id set. For
// teachers, scoped to `teacher_assignments.role='form_adviser'`.
export async function listFormAdviserSectionIds(userId: string): Promise<Set<string>> {
  const service = createServiceClient();
  const { data } = await service
    .from('teacher_assignments')
    .select('section_id')
    .eq('teacher_user_id', userId)
    .eq('role', 'form_adviser');
  return new Set((data ?? []).map((r) => r.section_id as string));
}

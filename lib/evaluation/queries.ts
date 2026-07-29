import 'server-only';

import { fetchAllPages } from '@/lib/supabase/paginate';
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
export async function getEvaluationTermConfig(
  termId: string
): Promise<EvaluationTermConfig | null> {
  const service = createServiceClient();

  const { data: term, error: termErr } = await service
    .from('terms')
    .select('id, virtue_theme')
    .eq('id', termId)
    .maybeSingle();
  if (termErr || !term) return null;

  return {
    termId: term.id,
    virtueTheme: (term.virtue_theme as string | null) ?? null,
  };
}

// Roster + writeup state for one section × term. Joins section_students →
// students → evaluation_writeups so the client gets one row per enrolled
// student with their current writeup draft (or nulls if not started).
// Excludes withdrawn students.
export async function getSectionRoster(
  sectionId: string,
  termId: string
): Promise<EvaluationRosterStudent[]> {
  const service = createServiceClient();

  const { data: enrolments, error } = await service
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)'
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
      .select(
        'id, term_id, section_id, student_id, writeup, submitted, submitted_at'
      )
      .eq('term_id', termId)
      .in('student_id', studentIds);
    for (const w of (writeups ?? []) as EvaluationWriteupRow[]) {
      writeupsByStudent.set(w.student_id, w);
    }
  }

  return enrolments.map((r) => {
    const s = r.student as
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }[]
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
        ? [stu.last_name, stu.first_name, stu.middle_name]
            .filter(Boolean)
            .join(', ')
        : '(missing student)',
      enrollment_status:
        r.enrollment_status as EvaluationRosterStudent['enrollment_status'],
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
  sectionIds: string[]
): Promise<Record<string, SectionWriteupProgress>> {
  const out: Record<string, SectionWriteupProgress> = {};
  if (sectionIds.length === 0) return out;

  const service = createServiceClient();

  // Paginated + throwing, not `const { data } = await ...`: a whole-AY call
  // passes every section, so this is one row per active student. Silently
  // truncating at the 1000-row cap would under-count `active_count` — a
  // wrong-but-plausible denominator, the same failure shape as the write-up
  // query below.
  const enrolments = await fetchAllPages<{
    section_id: string;
    student_id: string;
  }>((from, to) =>
    service
      .from('section_students')
      .select('section_id, student_id, enrollment_status')
      .in('section_id', sectionIds)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );

  // Map each active student to their CURRENT section so submitted write-ups are
  // credited by the live roster, not by evaluation_writeups.section_id — that
  // denormalized tag doesn't follow a mid-year transfer (KD #67), so counting by
  // it mis-attributes a transferred student's write-up to their old section.
  const sectionByStudent = new Map<string, string>();
  for (const row of enrolments) {
    const b = (out[row.section_id] ??= {
      section_id: row.section_id,
      active_count: 0,
      submitted_count: 0,
    });
    b.active_count++;
    sectionByStudent.set(row.student_id, row.section_id);
  }

  if (sectionByStudent.size > 0) {
    // Deliberately NOT filtered by `.in('student_id', roster)`. PostgREST puts
    // `.in()` values in the URL query string, so a whole-AY roster (~400 uuids
    // ≈ 15KB) made the request fail outright with `TypeError: fetch failed` —
    // and because the error was discarded, the caller read it as "no rows" and
    // rendered 0/N for every section for months. Fetch the term's write-ups
    // and intersect against the roster in JS instead: one term is a few
    // hundred rows, and the roster filter costs nothing here.
    //
    // `fetchAllPages` also throws on a PostgREST error instead of returning it.
    // That matters as much as the URL fix: a swallowed error here produces a
    // plausible-looking zero rather than an obvious break, which is exactly how
    // this stayed invisible.
    const writeups = await fetchAllPages<{
      student_id: string;
      writeup: string | null;
    }>((from, to) =>
      service
        .from('evaluation_writeups')
        .select('student_id, writeup')
        .eq('term_id', termId)
        .eq('submitted', true)
        .range(from, to)
    );

    for (const row of writeups) {
      // A `submitted` flag with empty content is not a real write-up — match the
      // publish-readiness "missing" definition so these counts agree.
      if (!row.writeup || row.writeup.trim().length === 0) continue;
      const sectionId = sectionByStudent.get(row.student_id);
      if (sectionId && out[sectionId]) out[sectionId].submitted_count++;
    }
  }

  return out;
}

// Which sections does this user advise? Returns the section_id set. For
// teachers, scoped to `teacher_assignments.role='form_adviser'`.
export async function listFormAdviserSectionIds(
  userId: string
): Promise<Set<string>> {
  const service = createServiceClient();
  const { data } = await service
    .from('teacher_assignments')
    .select('section_id')
    .eq('teacher_user_id', userId)
    .eq('role', 'form_adviser');
  return new Set((data ?? []).map((r) => r.section_id as string));
}

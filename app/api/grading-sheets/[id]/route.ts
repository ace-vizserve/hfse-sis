import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

// GET /api/grading-sheets/[id]
// Returns the full sheet: config, section+level, term, subject, and all
// grade_entries joined to section_students + students, ordered by index.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const supabase = await createClient();

  const { data: sheet, error: sheetErr } = await supabase
    .from('grading_sheets')
    .select(
      `id, teacher_name, is_locked, ww_totals, pt_totals, qa_total,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(id, code, label, level_type)),
       subject_config:subject_configs(display_name, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`
    )
    .eq('id', id)
    .single();
  if (sheetErr || !sheet) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }

  const { data: entries, error: entErr } = await supabase
    .from('grade_entries')
    .select(
      `id, ww_scores, pt_scores, qa_score,
       ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade,
       letter_grade, is_na,
       section_student:section_students(
         id, index_number, enrollment_status,
         student:students(student_number, last_name, first_name, middle_name)
       )`
    )
    .eq('grading_sheet_id', id);
  if (entErr)
    return NextResponse.json({ error: entErr.message }, { status: 500 });

  // Sort by index_number client-side since the join doesn't order.
  type EntryRow = typeof entries extends (infer U)[] | null ? U : never;
  const sorted = ((entries ?? []) as EntryRow[]).slice().sort((a, b) => {
    const ai = Array.isArray(a.section_student)
      ? a.section_student[0]
      : a.section_student;
    const bi = Array.isArray(b.section_student)
      ? b.section_student[0]
      : b.section_student;
    return (ai?.index_number ?? 0) - (bi?.index_number ?? 0);
  });

  // Resolve the subject's name for THIS sheet's academic year before the
  // payload leaves (migration 137). Doing it here rather than leaving it to
  // each consumer is what stops the API and the page it feeds disagreeing —
  // and the config carrying the name is the same row the weights come from,
  // so it costs nothing.
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  type SubjectLite = { id: string; code: string; name: string };
  type ConfigLite = { display_name: string | null };
  const raw = sheet as unknown as {
    subject: SubjectLite | SubjectLite[] | null;
    subject_config: ConfigLite | ConfigLite[] | null;
  };
  const subj = one(raw.subject);
  const sheetOut = subj
    ? {
        ...sheet,
        subject: {
          ...subj,
          name: subjectDisplayName(subj, one(raw.subject_config)),
        },
      }
    : sheet;

  return NextResponse.json({ sheet: sheetOut, entries: sorted });
}

// Loads the current grading-DB state needed to plan a sync against admissions.
// Scoped to a single academic year (only sections/enrollments for that year).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GradingSnapshot } from '@/lib/sync/students';
import { fetchAllPages } from '@/lib/supabase/paginate';

export async function loadGradingSnapshot(
  supabase: SupabaseClient,
  ayCode: string
): Promise<GradingSnapshot> {
  const { data: ay, error: ayErr } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .single();
  if (ayErr || !ay) throw new Error(`Academic year ${ayCode} not found`);

  // `students` IS THE ONE READ HERE THAT NOTHING BOUNDS.
  //
  // Every other read in this function is scoped: `sections` to one academic
  // year, `section_students` to that year's sections, `levels` to a fixed 11
  // rows. `students` is the whole table across every year the school has ever
  // run, and it only ever grows — 760 rows measured in production 2026-08-30,
  // against PostgREST's 1,000-row cap. One more intake crosses it.
  //
  // Crossing it would not raise anything. The response comes back short with no
  // error and no flag, and `lib/sync/students.ts:110` turns this list into
  // `studentByNumber`, the map that answers "do we already have this student".
  // A student missing from a truncated snapshot reads as a student who does not
  // exist, on both callers — `app/api/students/sync/stats` (which would report
  // the wrong number of new students) and `app/api/students/sync` (which acts
  // on that answer). Paging is a few hundred bytes of code against that.
  const [levelsRes, sectionsRes, students] = await Promise.all([
    supabase.from('levels').select('id, label'),
    supabase
      .from('sections')
      .select('id, level_id, name')
      .eq('academic_year_id', ay.id),
    fetchAllPages<GradingSnapshot['students'][number]>((from, to) =>
      supabase
        .from('students')
        .select('id, student_number, last_name, first_name, middle_name')
        // Offset paging needs a deterministic sort or a row can land on two
        // pages or on none. `student_number` is the stable student id
        // (Hard Rule #4) and is what the consumer keys on.
        .order('student_number')
        .range(from, to)
    ),
  ]);

  if (levelsRes.error) throw new Error(levelsRes.error.message);
  if (sectionsRes.error) throw new Error(sectionsRes.error.message);

  // NOT PAGED, and measured rather than assumed: this is bounded by one year's
  // roster, not by the table. Production 2026-08-30 — AY2025 414 rows over 22
  // sections, AY2026 407 over 21, AY2027 1. The `.in()` filter carries at most
  // ~22 uuids, nowhere near the ~396 the URL budget allows
  // (lib/supabase/paginate.ts). It would take a school 2.5x this size to reach
  // the cap, and if that happens `sections` grows first and visibly.
  const sectionIds = (sectionsRes.data ?? []).map((s) => s.id);
  let enrollments: GradingSnapshot['enrollments'] = [];
  if (sectionIds.length > 0) {
    const { data, error } = await supabase
      .from('section_students')
      .select('id, section_id, student_id, index_number, enrollment_status')
      .in('section_id', sectionIds);
    if (error) throw new Error(error.message);
    enrollments = (data ?? []) as GradingSnapshot['enrollments'];
  }

  return {
    levels: levelsRes.data ?? [],
    sections: (sectionsRes.data ?? []) as GradingSnapshot['sections'],
    students,
    enrollments,
  };
}

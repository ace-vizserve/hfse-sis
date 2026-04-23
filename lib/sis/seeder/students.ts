import type { SupabaseClient } from '@supabase/supabase-js';

import { pickNames } from './names';

// Auto-seeder for the test academic year. Fires on switch-to-Test from
// /sis/admin/settings when the target AY has zero section-students.
//
// Hard-coded defaults by design — the whole point of the Settings UX is
// "flip to Test, get a working UAT dataset, no further clicking." Change
// `STUDENTS_PER_SECTION` here if 10/section turns out to be too many/few.

const STUDENTS_PER_SECTION = 10;

export type SeedResult = {
  students_inserted: number;
  section_count: number;
  section_ids: string[];
};

// Slugifies a section name into a segment safe for student_number
// (uppercase, A-Z0-9 only; spaces/punct collapse to `-`).
function slugSegment(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SectionRow = {
  id: string;
  name: string;
  level_id: string;
  levels: { code: string } | { code: string }[] | null;
};

// Seeds the given academic year with STUDENTS_PER_SECTION test students
// per section across every level that has sections. Idempotent-ish: any
// section that already has students is skipped entirely (we never mix
// seed rows into a partially-filled section to keep teardown trivial).
export async function seedTestAy(
  service: SupabaseClient,
  ayId: string,
  ayCode: string,
): Promise<SeedResult> {
  // Pull every section in this AY with its level code (for the
  // student_number slug). `levels.code` is e.g. 'P1' or 'S2'.
  const { data: sectionRows, error: sectionsErr } = await service
    .from('sections')
    .select('id, name, level_id, levels(code)')
    .eq('academic_year_id', ayId)
    .order('name');

  if (sectionsErr || !sectionRows) {
    throw new Error(`seed: failed to list sections — ${sectionsErr?.message ?? 'no data'}`);
  }

  const sections = sectionRows as unknown as SectionRow[];
  if (sections.length === 0) {
    return { students_inserted: 0, section_count: 0, section_ids: [] };
  }

  // Skip sections that already have any enrolments so teardown stays
  // "DELETE FROM students WHERE student_number LIKE 'TEST-%'".
  const { data: existingEnrol, error: enrolErr } = await service
    .from('section_students')
    .select('section_id')
    .in('section_id', sections.map((s) => s.id));
  if (enrolErr) {
    throw new Error(`seed: failed to check existing enrolments — ${enrolErr.message}`);
  }
  const occupiedSectionIds = new Set(
    (existingEnrol ?? []).map((r) => (r as { section_id: string }).section_id),
  );
  const emptySections = sections.filter((s) => !occupiedSectionIds.has(s.id));

  if (emptySections.length === 0) {
    return { students_inserted: 0, section_count: 0, section_ids: [] };
  }

  // Build the insert payloads.
  const studentInserts: Array<{
    student_number: string;
    first_name: string;
    last_name: string;
  }> = [];
  type Enrol = {
    section_id: string;
    student_number: string;
    index_number: number;
  };
  const enrolPlans: Enrol[] = [];

  for (const section of emptySections) {
    const levelCode = Array.isArray(section.levels)
      ? section.levels[0]?.code
      : section.levels?.code;
    const sectionSlug = `${levelCode ?? 'X'}-${slugSegment(section.name)}`;
    const names = pickNames(`${ayCode}:${section.id}`, STUDENTS_PER_SECTION);

    for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
      const seq = String(i + 1).padStart(2, '0');
      const studentNumber = `TEST-${ayCode}-${sectionSlug}-${seq}`;
      studentInserts.push({
        student_number: studentNumber,
        first_name: names[i].first_name,
        last_name: names[i].last_name,
      });
      enrolPlans.push({
        section_id: section.id,
        student_number: studentNumber,
        index_number: i + 1,
      });
    }
  }

  // Bulk insert students. `student_number` is unique; we use an upsert
  // on conflict with ignoreDuplicates so a partial re-run doesn't 23505.
  const { data: insertedStudents, error: insertErr } = await service
    .from('students')
    .upsert(studentInserts, { onConflict: 'student_number', ignoreDuplicates: false })
    .select('id, student_number');
  if (insertErr || !insertedStudents) {
    throw new Error(`seed: students insert failed — ${insertErr?.message ?? 'no data'}`);
  }

  const idByNumber = new Map(
    insertedStudents.map((r) => [
      (r as { student_number: string }).student_number,
      (r as { id: string }).id,
    ]),
  );

  const enrolInserts = enrolPlans.map((e) => ({
    section_id: e.section_id,
    student_id: idByNumber.get(e.student_number)!,
    index_number: e.index_number,
    enrollment_status: 'active' as const,
    enrollment_date: new Date().toISOString().slice(0, 10),
  }));

  const { error: enrolInsertErr } = await service
    .from('section_students')
    .insert(enrolInserts);
  if (enrolInsertErr) {
    throw new Error(`seed: section_students insert failed — ${enrolInsertErr.message}`);
  }

  return {
    students_inserted: studentInserts.length,
    section_count: emptySections.length,
    section_ids: emptySections.map((s) => s.id),
  };
}

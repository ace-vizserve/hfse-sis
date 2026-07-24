import type { SupabaseClient } from '@supabase/supabase-js';

export type TeacherSectionRow = { sectionName: string; roleTag: string };

type RawRow = {
  role: 'form_adviser' | 'subject_teacher';
  section: { id: string; name: string } | { id: string; name: string }[] | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * A teacher's own (section, role/subject) assignments with real names, for
 * the account page's "Your sections" sub-section — mirrors the reference
 * screenshot's "Teams: role · member count" rows. One row per assignment;
 * a teacher with 2 subjects in the same section gets 2 rows (not deduped)
 * since each is a distinct, separately-meaningful assignment.
 */
export async function getTeacherSections(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherSectionRow[]> {
  const { data } = await supabase
    .from('teacher_assignments')
    .select('role, section:sections(id, name), subject:subjects(id, name)')
    .eq('teacher_user_id', userId);

  return ((data ?? []) as RawRow[]).map((row) => {
    const section = one(row.section);
    const subject = one(row.subject);
    return {
      sectionName: section?.name ?? '—',
      roleTag:
        row.role === 'form_adviser' ? 'Form adviser' : (subject?.name ?? '—'),
    };
  });
}

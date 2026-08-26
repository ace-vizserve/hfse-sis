import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';

export type TeacherSectionRow = { sectionName: string; roleTag: string };

type RawRow = {
  role: AssignmentRole;
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
  const [{ data }, covering] = await Promise.all([
    supabase
      .from('teacher_assignments')
      .select('role, section:sections(id, name), subject:subjects(id, name)')
      .eq('teacher_user_id', userId),
    // Classes this teacher is currently standing in on. "Your sections" is the
    // one place a substitute should find the class they were asked to take —
    // without it they are told to go to a class that does not appear on their
    // own profile. Tagged as cover so it never reads as a permanent posting.
    loadActiveCoverRows(supabase, userId),
  ]);

  const held: TeacherSectionRow[] = ((data ?? []) as RawRow[]).map((row) => {
    const section = one(row.section);
    const subject = one(row.subject);
    return {
      sectionName: section?.name ?? '—',
      roleTag: roleTagFor(row.role, subject?.name ?? null),
    };
  });

  return [...held, ...covering];
}

async function loadActiveCoverRows(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherSectionRow[]> {
  const { data } = await supabase
    .from('teacher_assignments')
    .select('role, section:sections(id, name), subject:subjects(id, name)')
    .eq('relief_teacher_user_id', userId);

  return ((data ?? []) as RawRow[]).flatMap((a) => {
    if (!a) return [];
    const section = one(a.section);
    const subject = one(a.subject);
    const what = roleTagFor(a.role, subject?.name ?? null);
    return [
      {
        sectionName: section?.name ?? '—',
        roleTag: `${what} — covering`,
      },
    ];
  });
}

// What a teacher sees beside a class in their own list: advisers get the role,
// subject teachers get the subject. A co role has to say so — without it a
// co-adviser reads as "—" (no subject to fall back on) and a co-teacher is
// indistinguishable from the teacher who actually owns the sheet.
function roleTagFor(role: AssignmentRole, subjectName: string | null): string {
  if (role === 'form_adviser') return 'Form adviser';
  if (role === 'co_adviser') return 'Co-adviser';
  const subject = subjectName ?? '—';
  return role === 'co_teacher' ? `${subject} — co-teacher` : subject;
}

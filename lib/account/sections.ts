import type { SupabaseClient } from '@supabase/supabase-js';
import { sgToday } from '@/lib/dates';

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
      roleTag:
        row.role === 'form_adviser' ? 'Form adviser' : (subject?.name ?? '—'),
    };
  });

  return [...held, ...covering];
}

type CoverRawRow = {
  assignment:
    | {
        role: 'form_adviser' | 'subject_teacher';
        section:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
        subject:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }
    | Array<{
        role: 'form_adviser' | 'subject_teacher';
        section:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
        subject:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }>
    | null;
};

async function loadActiveCoverRows(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherSectionRow[]> {
  const today = sgToday();
  const { data } = await supabase
    .from('assignment_reliefs')
    .select(
      `assignment:teacher_assignments!inner(
         role, section:sections(id, name), subject:subjects(id, name)
       )`
    )
    .eq('relief_teacher_user_id', userId)
    .lte('started_on', today)
    .or(`ended_on.is.null,ended_on.gte.${today}`);

  return ((data ?? []) as CoverRawRow[]).flatMap((row) => {
    const a = Array.isArray(row.assignment)
      ? row.assignment[0]
      : row.assignment;
    if (!a) return [];
    const section = one(a.section);
    const subject = one(a.subject);
    const what =
      a.role === 'form_adviser' ? 'Form adviser' : (subject?.name ?? '—');
    return [
      {
        sectionName: section?.name ?? '—',
        roleTag: `${what} — covering`,
      },
    ];
  });
}

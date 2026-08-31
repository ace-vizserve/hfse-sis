import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';
import { subjectDisplayNameResolver } from '@/lib/sis/subjects/display-names-for-ay';

export type TeacherSectionRow = { sectionName: string; roleTag: string };

type RawRow = {
  role: AssignmentRole;
  section:
    | { id: string; name: string; academic_year_id: string }
    | { id: string; name: string; academic_year_id: string }[]
    | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** The name to show for one row — see subjectDisplayNameResolver. */
function nameFor(
  row: RawRow,
  resolve: (
    ayId: string | null | undefined,
    subject: { id: string; name: string }
  ) => string
): string | null {
  const subject = one(row.subject);
  if (!subject) return null;
  return resolve(one(row.section)?.academic_year_id, subject);
}

async function resolverFor(supabase: SupabaseClient, rows: RawRow[]) {
  return subjectDisplayNameResolver(
    supabase,
    rows.map((r) => one(r.section)?.academic_year_id),
    rows.map((r) => one(r.subject)?.id)
  );
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
      .select(
        'role, section:sections(id, name, academic_year_id), subject:subjects(id, name)'
      )
      .eq('teacher_user_id', userId),
    // Classes this teacher is currently standing in on. "Your sections" is the
    // one place a substitute should find the class they were asked to take —
    // without it they are told to go to a class that does not appear on their
    // own profile. Tagged as cover so it never reads as a permanent posting.
    loadActiveCoverRows(supabase, userId),
  ]);

  const heldRows = (data ?? []) as RawRow[];
  const resolve = await resolverFor(supabase, heldRows);
  const held: TeacherSectionRow[] = heldRows.map((row) => ({
    sectionName: one(row.section)?.name ?? '—',
    roleTag: roleTagFor(row.role, nameFor(row, resolve)),
  }));

  return [...held, ...covering];
}

async function loadActiveCoverRows(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherSectionRow[]> {
  const { data } = await supabase
    .from('teacher_assignments')
    .select(
      'role, section:sections(id, name, academic_year_id), subject:subjects(id, name)'
    )
    .eq('relief_teacher_user_id', userId);

  const coverRows = (data ?? []) as RawRow[];
  const resolve = await resolverFor(supabase, coverRows);
  return coverRows.flatMap((a) => {
    if (!a) return [];
    const what = roleTagFor(a.role, nameFor(a, resolve));
    return [
      {
        sectionName: one(a.section)?.name ?? '—',
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

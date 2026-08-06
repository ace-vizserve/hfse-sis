import type { SupabaseClient } from '@supabase/supabase-js';

// Audit context for teacher-assignment create/remove entries.
//
// Why this exists: the audit humanizer hides every `*_id` key and every raw
// UUID value (lib/audit/humanize.ts::shouldSkipKey) — correctly, because a UUID
// tells a school admin nothing. But the assignment routes used to log ONLY ids
// plus `role`, so a removal rendered as "Teacher assignment removed — Role:
// subject_teacher": no teacher, no class, and a database word. Storing the
// display names alongside the ids is the established convention (see
// `section.create`, which logs both `level_id` and the human `name`/`ay_code`).
//
// The ids stay in the context. They are invisible in the rendered line but are
// what makes an entry traceable if a name is later corrected.

export type AssignmentAuditRow = {
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
};

type LevelLite = { code: string | null; label: string | null };

/**
 * Build the `context` for an `assignment.create` / `assignment.delete` audit
 * row — ids as before, plus resolved `teacher_name` / `section_name` /
 * `subject_name` and any extra fields (the change reason and notes).
 *
 * Best-effort by design: a lookup that fails degrades to the raw id rather than
 * failing the mutation, matching how the rest of the assignment routes treat
 * their side-effects. Never throws.
 */
export async function buildAssignmentAuditContext(
  service: SupabaseClient,
  row: AssignmentAuditRow,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    teacher_user_id: row.teacher_user_id,
    section_id: row.section_id,
    subject_id: row.subject_id,
    role: row.role,
    ...extra,
  };

  try {
    const [{ getStaffDisplayNameById }, sectionRes, subjectRes] =
      await Promise.all([
        import('@/lib/auth/staff-list'),
        service
          .from('sections')
          .select('name, level:levels(code, label)')
          .eq('id', row.section_id)
          .maybeSingle(),
        row.subject_id
          ? service
              .from('subjects')
              .select('name')
              .eq('id', row.subject_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    const nameById = new Map(await getStaffDisplayNameById());
    const teacherName = nameById.get(row.teacher_user_id);
    if (teacherName) base.teacher_name = teacherName;

    const section = sectionRes.data as {
      name: string;
      level: LevelLite | LevelLite[] | null;
    } | null;
    if (section?.name) {
      const level = Array.isArray(section.level)
        ? section.level[0]
        : section.level;
      // "P4 Diligence" reads the way staff say it; the bare virtue name alone
      // ("Diligence") is ambiguous across levels.
      base.section_name = level?.code
        ? `${level.code} ${section.name}`
        : section.name;
    }

    const subject = subjectRes.data as { name: string } | null;
    if (subject?.name) base.subject_name = subject.name;
  } catch {
    // Swallow — the ids above are already recorded, and a missing display name
    // must never block an assignment change.
  }

  return base;
}

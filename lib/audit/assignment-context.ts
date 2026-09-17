import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';

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
  role: AssignmentRole;
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

/**
 * Build the `context` for an `assignment.relief.start` / `assignment.relief.end`
 * audit row.
 *
 * Since migration 117 cover IS the assignment row — `relief_teacher_user_id` on
 * `teacher_assignments` — so this takes that row and adds the substitute's name
 * on top of the class and subject its sibling already resolves. The result
 * answers "who covered whose class, and which class" from the audit log alone.
 *
 * The audit log is now the ONLY record of a finished cover, since clearing the
 * column leaves nothing behind. That is deliberate, and it is why the substitute
 * is resolved to a name here rather than left as a uuid.
 *
 * Best-effort in the same way as its sibling: never throws, degrades to raw ids.
 */
export async function buildReliefAuditContext(
  service: SupabaseClient,
  assignment: AssignmentAuditRow & { id: string },
  reliefTeacherUserId: string | null,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    assignment_id: assignment.id,
    relief_teacher_user_id: reliefTeacherUserId,
    ...extra,
  };

  try {
    const assignmentContext = await buildAssignmentAuditContext(
      service,
      assignment
    );
    // `teacher_name` from the assignment is the person BEING covered. Rename it
    // so a reader can't mistake it for the substitute.
    const { teacher_name, teacher_user_id, ...rest } = assignmentContext;
    Object.assign(base, rest);
    if (teacher_user_id) base.covered_teacher_user_id = teacher_user_id;
    if (teacher_name) base.covered_teacher_name = teacher_name;

    if (reliefTeacherUserId) {
      const { getStaffDisplayNameById } = await import('@/lib/auth/staff-list');
      const nameById = new Map(await getStaffDisplayNameById());
      const reliefName = nameById.get(reliefTeacherUserId);
      if (reliefName) base.relief_teacher_name = reliefName;
    }
  } catch {
    // Swallow — the ids are already recorded, and a missing display name must
    // never block cover being arranged or ended.
  }

  return base;
}

/** The cover a row held BEFORE a relief write overwrote or cleared it. */
export type PreviousRelief = {
  relief_teacher_user_id: string | null;
  relief_started_on: string | null;
  relief_ended_on: string | null;
  relief_reason: string | null;
};

/**
 * Flat `previous_relief_*` keys describing the cover a relief write replaced or
 * ended. The assignment row keeps nothing once cover is overwritten, so without
 * these a "cover ended" entry could not say whose cover it was, and a
 * re-booking would silently erase the substitute it replaced.
 *
 * Returns `{}` when the row carried no cover. `nameById` may be passed to reuse
 * an already-loaded staff map. Never throws.
 */
export async function buildPreviousReliefContext(
  previous: PreviousRelief | null,
  nameById?: Map<string, string>
): Promise<Record<string, unknown>> {
  if (!previous?.relief_teacher_user_id) return {};
  const out: Record<string, unknown> = {
    previous_relief_teacher_user_id: previous.relief_teacher_user_id,
    previous_relief_started_on: previous.relief_started_on ?? null,
    previous_relief_ended_on: previous.relief_ended_on ?? null,
    previous_relief_reason: previous.relief_reason ?? null,
  };
  try {
    const names =
      nameById ??
      new Map(
        await (await import('@/lib/auth/staff-list')).getStaffDisplayNameById()
      );
    const name = names.get(previous.relief_teacher_user_id);
    if (name) out.previous_relief_teacher_name = name;
  } catch {
    // Best-effort — the id is recorded.
  }
  return out;
}

/** "P4 Diligence" / "P4 Diligence · Mathematics" — the way staff name a class. */
export function classLabel(
  sectionName: string | null | undefined,
  levelCode: string | null | undefined,
  subjectName?: string | null
): string | null {
  if (!sectionName) return null;
  const section = levelCode ? `${levelCode} ${sectionName}` : sectionName;
  return subjectName ? `${section} · ${subjectName}` : section;
}

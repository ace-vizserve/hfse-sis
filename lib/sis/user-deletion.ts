import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';

// Which tables a user-deletion check should query, scoped to the account's
// CURRENT role (spec §4, docs/superpowers/specs/2026-07-24-user-account-deletion-design.md).
// Grounded in each writer route's real requireRole gate — or, where the
// route's gate is broader than the actual writer logic, the narrower
// in-code check (e.g. lib/change-requests/decide.ts only ever lets a
// school_admin land in reviewed_by/primary_reviewed_by/secondary_reviewed_by,
// regardless of that route's 4-role requireRole array).
//
// Deliberately excludes `audit_log` — a brand-new mistake account will
// almost always have a `user.login`/`user.create` row there, and blocking
// on that would defeat this feature's purpose. `audit_log.actor_email` is a
// plain text column with no real FK, so a dangling actor_id is harmless.
const ROLE_FOOTPRINT_COLUMNS: Record<
  Role,
  Array<{ table: string; column: string }>
> = {
  teacher: [
    { table: 'teacher_assignments', column: 'teacher_user_id' },
    // A teacher who has stood in for an absent colleague. Migration 112
    // declares no cross-schema FK (the convention this table's own parent,
    // teacher_assignments, follows), so this registry is the only thing
    // stopping a delete from leaving a cover pointing at nobody.
    { table: 'assignment_reliefs', column: 'relief_teacher_user_id' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
  ],
  academic_coordinator: [
    // Cover worked BEFORE this account was promoted. This list is scoped to
    // the account's CURRENT role, so leaving relief under `teacher` alone
    // would mean a teacher who once covered a class, then became a
    // coordinator, deletes cleanly and strands the cover row.
    { table: 'assignment_reliefs', column: 'relief_teacher_user_id' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
  ],
  school_admin: [
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'grade_change_requests', column: 'reviewed_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'grade_change_requests', column: 'primary_approver_id' },
    { table: 'grade_change_requests', column: 'secondary_approver_id' },
    { table: 'grade_change_requests', column: 'primary_reviewed_by' },
    { table: 'grade_change_requests', column: 'secondary_reviewed_by' },
    { table: 'approver_assignments', column: 'user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'school_config', column: 'updated_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
    // Holds staff.manage_relief (migration 113) — so this role is who
    // arranges and ends cover. `relief_teacher_user_id` is here too for the
    // same promoted-account reason as the coordinator block above.
    { table: 'assignment_reliefs', column: 'created_by' },
    { table: 'assignment_reliefs', column: 'ended_by' },
    { table: 'assignment_reliefs', column: 'relief_teacher_user_id' },
  ],
  superadmin: [
    { table: 'approver_assignments', column: 'created_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'p_file_revisions', column: 'replaced_by_user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'school_config', column: 'updated_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
    { table: 'assignment_reliefs', column: 'created_by' },
    { table: 'assignment_reliefs', column: 'ended_by' },
    { table: 'assignment_reliefs', column: 'relief_teacher_user_id' },
  ],
  p_file_officer: [
    { table: 'p_file_revisions', column: 'replaced_by_user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
  ],
  admissions: [{ table: 'p_file_outreach', column: 'created_by_user_id' }],
};

// Union of every role's columns, deduped — used when a role can't be
// resolved (shouldn't happen in practice; fail toward checking more, not
// less, per spec §5 step 5).
const ALL_FOOTPRINT_COLUMNS: Array<{ table: string; column: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ table: string; column: string }> = [];
  for (const cols of Object.values(ROLE_FOOTPRINT_COLUMNS)) {
    for (const c of cols) {
      const key = `${c.table}.${c.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  }
  return out;
})();

// Returns the deduped list of table names that have at least one row
// referencing `userId`, scoped to `role`'s relevant tables. Empty array
// means the account has zero recorded activity and is safe to delete.
//
// Fails closed: a query error counts as a match (blocks deletion) rather
// than being silently ignored — a destructive action should never proceed
// on an inconclusive check.
export async function getUserFootprint(
  service: SupabaseClient,
  userId: string,
  role: Role | null
): Promise<string[]> {
  // An unrecognized role (stale data, corruption) falls back to checking
  // every table rather than throwing — same "unknown → check everything"
  // intent as the explicit null-role case below.
  const columns =
    (role && ROLE_FOOTPRINT_COLUMNS[role]) || ALL_FOOTPRINT_COLUMNS;

  const results = await Promise.all(
    columns.map(async ({ table, column }) => {
      const { data, error } = await service
        .from(table)
        .select('id')
        .eq(column, userId)
        .limit(1);
      if (error) return table; // fail closed
      return data && data.length > 0 ? table : null;
    })
  );

  return Array.from(new Set(results.filter((t): t is string => t !== null)));
}

// True when `targetId` is a superadmin AND no OTHER superadmin exists in
// `users`. Pure array logic — no Supabase dependency — so the one guard
// that must never be wrong (get it backwards and every superadmin account
// becomes deletable, locking the school out of /sis/admin permanently) has
// a real unit test.
export function isLastSuperadmin(
  users: Array<{ id: string; role: string | null }>,
  targetId: string
): boolean {
  const target = users.find((u) => u.id === targetId);
  if (!target || target.role !== 'superadmin') return false;
  return !users.some((u) => u.id !== targetId && u.role === 'superadmin');
}

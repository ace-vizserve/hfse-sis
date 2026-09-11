import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';
import { repointWaitingStages } from '@/lib/approvals/materialise';

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
    // A teacher currently standing in for an absent colleague. Migration 117
    // declares no cross-schema FK (the convention this column's neighbour
    // teacher_user_id follows), so this registry is the only thing stopping a
    // delete from leaving a cover pointing at nobody.
    { table: 'teacher_assignments', column: 'relief_teacher_user_id' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
  ],
  academic_coordinator: [
    // Cover taken on BEFORE this account was promoted. This list is scoped to
    // the account's CURRENT role, so leaving relief under `teacher` alone
    // would mean a teacher covering a class, then promoted to coordinator,
    // deletes cleanly and strands the cover.
    { table: 'teacher_assignments', column: 'relief_teacher_user_id' },
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
    // Here for the same promoted-account reason as the coordinator block
    // above. Who ARRANGED a cover is no longer a column anywhere — since
    // migration 117 that lives only in `audit_log`, which this registry
    // deliberately excludes (see the header).
    { table: 'teacher_assignments', column: 'relief_teacher_user_id' },
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
    { table: 'teacher_assignments', column: 'relief_teacher_user_id' },
  ],
  admissions: [
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    // Inherited from the retired `p_file_officer` block (2026-09-10). Not
    // bookkeeping: admissions now holds `documents_*.upload`, so replacing a
    // document stamps THEIR id here, and a footprint that omitted it would let
    // the account delete cleanly and strand the revision.
    { table: 'p_file_revisions', column: 'replaced_by_user_id' },
  ],
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

// ── Approval steps the account is named on ────────────────────────────────
//
// ⚠ NOT A FOOTPRINT, AND NOT A REASON TO REFUSE THE DELETE. Being named on a
// step is configuration, not activity: `approval_stage_approvers.user_id`
// cascades on delete (migration 126), so the account simply leaves the step.
//
// ⚠ BUT THE REQUESTS ALREADY ON THOSE STEPS DO NOT FOLLOW BY THEMSELVES. Each
// copied the step's people in when it was filed, so a deleted person stays in
// every in-flight pool — and on an "Everyone must approve" step that is a yes
// that can never come, stalling every request on it with nothing on screen to
// say why. So the route reads the steps BEFORE deleting (the cascade removes
// the rows that say which they were) and re-points them AFTER, exactly as
// taking somebody off a step on the approvers screen does.

/** The configured approval steps this account is named on, deduped. */
export async function listApprovalStagesNamingUser(
  service: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await service
    .from('approval_stage_approvers')
    .select('stage_id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return [
    ...new Set(
      ((data ?? []) as Array<{ stage_id: string }>).map((r) => r.stage_id)
    ),
  ];
}

/**
 * Bring the requests on each step in line once the account is gone.
 *
 * `actor` is the admin who deleted the account: a step that needed only the
 * deleted person's yes finishes as a result, and what that sets moving runs on
 * their name (the audit row still names the last real approval).
 *
 * ⚠ NEVER THROWS. The account is already deleted; a step that fails to
 * re-point is logged and brought in line by the next edit to it on the
 * approvers screen — reporting the whole delete as failed would invite a
 * retry against an account that no longer exists.
 */
export async function repointStagesAfterUserDeletion(
  service: SupabaseClient,
  stageIds: readonly string[],
  actor: NonNullable<Parameters<typeof repointWaitingStages>[2]>
): Promise<void> {
  for (const stageId of stageIds) {
    try {
      await repointWaitingStages(service, stageId, actor);
    } catch (e) {
      console.error(
        '[user-deletion] could not update requests on an approval step after deleting the account:',
        stageId,
        e instanceof Error ? e.message : String(e)
      );
    }
  }
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

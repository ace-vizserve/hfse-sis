import type { SupabaseClient, User } from '@supabase/supabase-js';

// Comprehensive audit action taxonomy. Any mutation that touches real data
// should log one of these via `logAction()`. Matches the `action` column
// values expected by the audit-log UI; keep them in sync.
//
// Single source of truth: `AuditAction` is DERIVED from this const array
// (not the other way around) so there is one list, not a type + a separate
// runtime mirror that could drift. `ALL_AUDIT_ACTIONS` is what
// __tests__/audit/allowlist-coverage.test.ts enumerates to confirm every
// action is reachable from at least one module's /audit-log page.
export const ALL_AUDIT_ACTIONS = [
  'sheet.create',
  'sheet.bulk_create',
  'sheet.lock',
  'sheet.unlock',
  'sheet.unlock_force_with_pending_crs',
  'sheet.unlock_force_deadline_passed',
  'sheet.lock_overdue_batch',
  'sheet.labels.update',
  'entry.update',
  'totals.update',
  'student.sync',
  'student.add',
  'student.section.transfer',
  'student.withdrawal.cascade',
  'student.reenrolment.cascade',
  'sis.student.assign_section',
  'sis.student.auto_sync_batch',
  'enrolment.metadata.update',
  'assignment.create',
  'assignment.delete',
  // Cover for an absent teacher — arranged and ended. Separate actions rather
  // than one `relief.update`, so the audit log can answer "who is covering
  // right now" and "how long did that cover run" without reading a diff.
  'assignment.relief.start',
  'assignment.relief.end',
  'section.create',
  'section.rename',
  'section.delete',
  'section.realphabetize',
  'section.index.generate',
  'section.subject.assign',
  'section.subject.remove',
  'section.subjects.load_defaults',
  'section.subjects.attach_many',
  'section.track.assign',
  'section.schedule.update',
  'attendance.update',
  'attendance.daily.update',
  'attendance.daily.correct',
  'attendance.import.bulk',
  'attendance.calendar.upsert',
  'attendance.calendar.delete',
  'attendance.calendar.autoseed',
  'attendance.calendar.copy_from_prior_ay',
  'attendance.event.create',
  'attendance.event.update',
  'attendance.event.delete',
  'comment.update',
  'publication.create',
  'publication.delete',
  'grade_change_requested',
  'grade_change_approved',
  'grade_change_rejected',
  'grade_change_cancelled',
  'grade_change_applied',
  'grade_change_undo_rejection',
  'grade_correction',
  'pfile.upload',
  'pfile.reminder.sent',
  'pfile.reminder.bulk',
  'pfile.mark.promised',
  'admissions.reminder.sent',
  'admissions.reminder.bulk',
  'admissions.mark.promised',
  'sis.profile.update',
  'sis.family.update',
  'sis.stage.update',
  'sis.stp.update',
  'sis.precourse.update',
  'sis.discount_code.create',
  'sis.discount_code.update',
  'sis.discount_code.expire',
  'sis.document.approve',
  'sis.document.reject',
  'sis.documents.auto-expire',
  'sis.documents.auto-revive',
  'sis.allowance.update',
  'sis.vl_allowance.update',
  'sis.house.update',
  'sis.level.create',
  // 'level.create'/'level.update'/'level.delete'/'level.offering.toggle'
  // backed the Grade Levels admin CRUD (KD #153) — removed by migration 086
  // alongside the whole page. Retained here for back-compat with historical
  // audit_log rows (Hard Rule #6, append-only); no code emits them anymore.
  'level.create',
  'level.update',
  'level.delete',
  'level.offering.toggle',
  'level.alias.create',
  'ay.create',
  'ay.switch_current',
  'ay.accepting_applications.toggle',
  'ay.delete',
  'ay.term_dates.update',
  'ay.term_virtue.update',
  'ay.term_grading_lock.update',
  'evaluation.writeup.save',
  'evaluation.writeup.submit',
  'evaluation.writeup.resubmit',
  'evaluation.checklist_item.create',
  'evaluation.checklist_item.update',
  'evaluation.checklist_item.delete',
  'evaluation.checklist_item.reorder',
  'evaluation.checklist_item.copy_from',
  'evaluation.checklist_response.save',
  'evaluation.subject_comment.save',
  'evaluation.ptc_feedback.save',
  'ay.copy_teacher_assignments',
  'approver.assign',
  'approver.revoke',
  'subject_config.update',
  'subject_config.create',
  'subject_level_offering.toggle',
  'subject_report_map.update',
  'subject.catalog.update',
  'template.section.create',
  'template.section.update',
  'template.section.delete',
  'template.subject_config.create',
  'template.subject_config.update',
  'template.subject_config.delete',
  'template.subject_config.bulk_delete',
  'subject.create',
  'template.apply',
  'school_config.update',
  'user.invite',
  'user.create',
  'user.info.update',
  'user.role.update',
  // Which capabilities a ROLE holds (public.role_permissions, migration 101) —
  // distinct from user.role.update, which is which role a PERSON holds.
  'role.permissions.update',
  'user.disable',
  'user.enable',
  'user.delete',
  // 'environment.switch'/'environment.seed'/'environment.topup'/
  // 'environment.demo_accounts_removed' backed the test-AY Environment
  // switcher (KD #52) — removed once the test AYs themselves were gone from
  // the database and testing moved to real AY2026 with throwaway accounts.
  // Retained here for back-compat with historical audit_log rows (Hard Rule
  // #6, append-only); no code emits them anymore.
  'environment.switch',
  'environment.seed',
  'environment.topup',
  'environment.demo_accounts_removed',
  'grade_entry.annual_letter.update',
  'classroom.note.save',
  // Disciplinary records (#7). Filing and later edits are separate actions
  // because they answer different questions — "who reported this" is a fact
  // about the incident, "who changed it afterwards" is a fact about the
  // record. Neither context ever carries the narrative itself; see the write
  // routes and migration 120.
  'discipline.record.file',
  'discipline.record.update',
  // Parent-filed absence and travel declarations (#6, migration 125) and the
  // ordered approval that decides them (126/127). The DECISION is logged, never
  // the words: neither the parent's note nor the approver's reason reaches
  // audit_log, for the reason migration 109 set out for `ex_note` — the log is
  // readable by every is_registrar_or_above() user, is append-only, and this
  // material is medical-adjacent and about a child. Presence only.
  'declaration.approve',
  'declaration.reject',
  // The configuration of an ordered flow: which steps exist, in what order,
  // and who is on the ones that name people. Distinct from `approver.assign`,
  // which belongs to the older pooled change-request flow.
  'approval_stage.create',
  'approval_stage.update',
  'approval_stage.delete',
  'approval_stage.approver.assign',
  'approval_stage.approver.revoke',
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
  // Somebody with two jobs changed which view they are looking at the app
  // through. Written from app/api/account/active-role/route.ts — the one route
  // that owns the lens — so the log can line "switched to Teacher view at
  // 09:14" up against everything done afterwards.
  //
  // ⚠ THIS IS WHY THERE IS NO `actor_view` COLUMN. Recording the view on every
  // audit row would mean 111 call sites reading the lens, most of them API
  // routes, and `__tests__/auth/active-role-never-authorises.test.ts` bans an
  // API route from naming it — a guard no test can replace, because nothing
  // can tell "reads the lens to log it" from "reads the lens to decide". One
  // entry from the one route that already holds the value says the same thing.
  'user.view.switch',
] as const;

export type AuditAction = (typeof ALL_AUDIT_ACTIONS)[number];

export type AuditEntityType =
  | 'grading_sheet'
  | 'grade_entry'
  | 'section'
  | 'section_student'
  | 'teacher_assignment'
  | 'assignment_relief'
  | 'attendance_record'
  | 'attendance_daily'
  | 'school_calendar'
  | 'calendar_event'
  | 'report_card_comment'
  | 'report_card_publication'
  | 'sync_batch'
  | 'grade_change_request'
  | 'enrolment_document'
  | 'enrolment_application'
  | 'enrolment_status'
  | 'discount_code'
  | 'academic_year'
  | 'term'
  | 'level'
  | 'approver_assignment'
  | 'subject_config'
  | 'subject_level_offering'
  | 'subject_report_map'
  | 'template_section'
  | 'template_subject_config'
  | 'template_subject_level_offering'
  | 'template_application'
  | 'subject'
  | 'school_config'
  | 'user_account'
  | 'evaluation_writeup'
  | 'evaluation_term'
  | 'evaluation_checklist_item'
  | 'evaluation_checklist_response'
  | 'evaluation_subject_comment'
  | 'evaluation_ptc_feedback'
  | 'classroom_note'
  | 'student_discipline_record'
  | 'student_declaration'
  | 'approval_request'
  | 'approval_stage'
  | 'approval_stage_approver'
  // The entity is the ROLE whose permissions changed, so entity_id is the role
  // name — not a uuid. entity_id is `text` since migration 043.
  | 'role_permissions';

// WHO acted, and in what capacity.
//
// ⚠ `role` IS REQUIRED, AND THAT IS THE ENFORCEMENT. Nothing enumerates the
// 111 `logAction` call sites, so an optional field would give silent gaps
// forever — a route added next year would simply not pass one and nobody would
// find out. Required means TypeScript names every site that does not supply it.
//
// It is the role that AUTHORISED the write — the JWT claim `requireRole()` /
// `requireCapability()` checked — and NEVER the active view. See
// migration 141's header, and the `user.view.switch` note above for why the
// view is logged once, at the switch, rather than on every row.
//
// `null` is a real answer, not a placeholder: a nightly sweep or a background
// freshener has no person behind it. It must not be spelled `''` — see
// `toAuditRow`.
type AuditActor = { role: string | null } & (
  | Pick<User, 'id' | 'email'>
  | { id: string | null; email: string | null }
);

type LogActionParams = {
  service: SupabaseClient;
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  context?: Record<string, unknown>;
};

export type AuditRow = {
  actor_id: string | null;
  actor_email: string;
  actor_role: string | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  context: Record<string, unknown>;
};

// The ONE place a `public.audit_log` row is shaped. Both the single-row
// (`logAction`) and the batched (`logActions`) writers go through here, so the
// two paths cannot drift — `__tests__/audit/log-actions-batch.test.ts` pins 30
// rows byte-identical between them.
export function toAuditRow(
  actor: AuditActor,
  row: Omit<LogActionParams, 'service' | 'actor'>
): AuditRow {
  return {
    actor_id: actor.id,
    actor_email: actor.email ?? '(unknown)',
    // ⚠ EMPTY STRING COLLAPSES TO NULL, and the coercion belongs here rather
    // than at the one call site that can produce it. The signed-token approval
    // path (`lib/change-requests/decide.ts`) scrapes its role out of
    // `app_metadata` with a `?? ''` fallback, so "" means "we never found
    // one". Stored as-is it would be a third state nobody filters for: not a
    // role, but not null either, so `actor_role is null` would miss it and a
    // dropdown would offer a blank option. One funnel, one rule.
    actor_role: actor.role === '' ? null : actor.role,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId ?? null,
    context: row.context ?? {},
  };
}

// Writes one row to `public.audit_log`. Never throws — audit failures must
// not break user actions. Errors are logged to the console and swallowed.
//
// Uses the service-role client (bypasses RLS write-deny policy from 004).
export async function logAction(params: LogActionParams): Promise<void> {
  const { service, actor, action, entityType, entityId, context } = params;
  try {
    const { error } = await service
      .from('audit_log')
      .insert(toAuditRow(actor, { action, entityType, entityId, context }));
    if (error) {
      console.error('[audit] failed to write log row', {
        action,
        entityType,
        entityId,
        error: error.message,
      });
    }
  } catch (e) {
    console.error('[audit] unexpected error writing log row', {
      action,
      entityType,
      entityId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// Convenience wrapper when multiple rows need to be written for one action
// (e.g. entries PATCH that touches several fields in one request, ~25-30 per
// class register submit, 200 on a teacher-assignment bulk create, ~125 on a
// year lock).
//
// ONE array insert, mirroring `writeAuditRows` in
// `lib/audit/log-grade-change.ts` — the established precedent for a batched
// audit write in this codebase.
//
// ⚠ WHY THE PER-ROW FALLBACK EXISTS, and why it is not dead code. An array
// insert is ALL-OR-NOTHING: one row PostgREST rejects (an `action` value the
// enum has not seen, context that will not serialise) discards the other 199
// alongside it. `logAction` has never thrown and never lost a row for a
// neighbour's fault, and a silently incomplete audit trail is worse than a
// slow one — so a REJECTED batch is retried row by row, which lands every good
// row and isolates the bad one in the console. Pinned by
// `__tests__/audit/log-actions-batch.test.ts`.
//
// ⚠ AND WHY ONLY ONE OF THE TWO FAILURE PATHS TAKES IT. The two are not the
// same failure and must not share a branch:
//
//   * A RETURNED `error` is the server's own answer. PostgREST ran the
//     statement, the statement failed, and nothing was committed — so there is
//     nothing to duplicate and the per-row retry is strictly a repair.
//   * A THROWN error is a TRANSPORT failure, and it is ambiguous by nature. A
//     socket that dies, a fetch that aborts, a gateway timeout: each of those
//     can arrive AFTER the insert has already committed. We cannot tell from
//     here which side of the commit we are on.
//
// `audit_log` has no unique constraint and no dedupe (nor should it — Hard Rule
// #6 makes it append-only, and a dedupe would be an update path). So retrying a
// throw would, whenever the statement had in fact landed, write every row a
// SECOND time: a class register submit's ~30 marks appearing twice in the log
// and twice in the Activity panel (KD #200, which derives its events on read
// and would faithfully show both). A duplicated audit trail is a wrong record;
// a missing one is a gap that other evidence can still close. Between the two
// we take the gap, log it loudly enough to be actioned, and return.
//
// Hard Rule #6: this is append-only. It inserts; it never updates or upserts.
// fallow-ignore-next-line unused-export
export async function logActions(
  service: SupabaseClient,
  actor: { id: string; email: string | null; role: string | null },
  rows: Array<Omit<LogActionParams, 'service' | 'actor'>>
): Promise<void> {
  if (rows.length === 0) return;

  try {
    const { error } = await service
      .from('audit_log')
      .insert(rows.map((row) => toAuditRow(actor, row)));
    if (!error) return;

    console.error('[audit] batch insert failed, falling back to per-row', {
      rows: rows.length,
      error: error.message,
    });
  } catch (e) {
    // NO RETRY HERE — see the note above the function. A throw cannot be
    // placed relative to the commit, so retrying risks duplicating every row
    // into an append-only table that has no way to remove them. Returning
    // honours this function's never-throw contract; the caller's own write is
    // unaffected either way.
    console.error(
      '[audit] batch insert THREW — audit rows may or may not have landed, NOT retrying',
      {
        rows: rows.length,
        actions: [...new Set(rows.map((r) => r.action))],
        error: e instanceof Error ? e.message : String(e),
        why: 'a thrown (transport) error can arrive after the insert committed; a per-row retry would double every row in an append-only log',
      }
    );
    return;
  }

  // Fallback only, and reached ONLY from the returned-`error` branch above —
  // the statement failed server-side, so nothing committed and there is nothing
  // to duplicate. `logAction` swallows its own errors, so a bad row is reported
  // and skipped while every good row still lands.
  await Promise.all(rows.map((row) => logAction({ service, actor, ...row })));
}

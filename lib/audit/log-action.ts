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
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
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
  // The entity is the ROLE whose permissions changed, so entity_id is the role
  // name — not a uuid. entity_id is `text` since migration 043.
  | 'role_permissions';

type LogActionParams = {
  service: SupabaseClient;
  actor:
    | Pick<User, 'id' | 'email'>
    | { id: string | null; email: string | null };
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  context?: Record<string, unknown>;
};

// Writes one row to `public.audit_log`. Never throws — audit failures must
// not break user actions. Errors are logged to the console and swallowed.
//
// Uses the service-role client (bypasses RLS write-deny policy from 004).
export async function logAction(params: LogActionParams): Promise<void> {
  const { service, actor, action, entityType, entityId, context } = params;
  try {
    const { error } = await service.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email ?? '(unknown)',
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      context: context ?? {},
    });
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
// (e.g. entries PATCH that touches several fields in one request).
// fallow-ignore-next-line unused-export
export async function logActions(
  service: SupabaseClient,
  actor: { id: string; email: string | null },
  rows: Array<Omit<LogActionParams, 'service' | 'actor'>>
): Promise<void> {
  await Promise.all(rows.map((row) => logAction({ service, actor, ...row })));
}

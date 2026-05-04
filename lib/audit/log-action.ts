import type { SupabaseClient, User } from '@supabase/supabase-js';

// Comprehensive audit action taxonomy. Any mutation that touches real data
// should log one of these via `logAction()`. Matches the `action` column
// values expected by the audit-log UI; keep them in sync.
export type AuditAction =
  | 'sheet.create'
  | 'sheet.bulk_create'
  | 'sheet.lock'
  | 'sheet.unlock'
  | 'entry.update'
  | 'totals.update'
  | 'student.sync'
  | 'student.add'
  | 'student.section.transfer'
  | 'enrolment.metadata.update'
  | 'assignment.create'
  | 'assignment.delete'
  | 'section.create'
  | 'section.rename'
  | 'attendance.update'
  | 'attendance.daily.update'
  | 'attendance.daily.correct'
  | 'attendance.import.bulk'
  | 'attendance.calendar.upsert'
  | 'attendance.calendar.delete'
  | 'attendance.calendar.autoseed'
  | 'attendance.calendar.copy_from_prior_ay'
  | 'attendance.event.create'
  | 'attendance.event.update'
  | 'attendance.event.delete'
  | 'comment.update'
  | 'publication.create'
  | 'publication.delete'
  | 'grade_change_requested'
  | 'grade_change_approved'
  | 'grade_change_rejected'
  | 'grade_change_cancelled'
  | 'grade_change_applied'
  | 'grade_correction'
  | 'pfile.upload'
  | 'pfile.reminder.sent'
  | 'pfile.reminder.bulk'
  | 'pfile.mark.promised'
  | 'admissions.reminder.sent'
  | 'admissions.reminder.bulk'
  | 'admissions.mark.promised'
  | 'sis.profile.update'
  | 'sis.family.update'
  | 'sis.stage.update'
  | 'sis.discount_code.create'
  | 'sis.discount_code.update'
  | 'sis.discount_code.expire'
  | 'sis.document.approve'
  | 'sis.document.reject'
  | 'sis.documents.auto-expire'
  | 'sis.documents.auto-revive'
  | 'sis.allowance.update'
  | 'ay.create'
  | 'ay.switch_current'
  | 'ay.accepting_applications.toggle'
  | 'ay.delete'
  | 'ay.term_dates.update'
  | 'ay.term_virtue.update'
  | 'ay.term_grading_lock.update'
  | 'evaluation.writeup.save'
  | 'evaluation.writeup.submit'
  | 'evaluation.term.open'
  | 'evaluation.term.close'
  | 'evaluation.checklist_item.create'
  | 'evaluation.checklist_item.update'
  | 'evaluation.checklist_item.delete'
  | 'evaluation.checklist_response.save'
  | 'evaluation.subject_comment.save'
  | 'evaluation.ptc_feedback.save'
  | 'ay.copy_teacher_assignments'
  | 'approver.assign'
  | 'approver.revoke'
  | 'subject_config.update'
  | 'template.section.create'
  | 'template.section.update'
  | 'template.section.delete'
  | 'template.subject_config.create'
  | 'template.subject_config.update'
  | 'template.subject_config.delete'
  | 'template.subject_config.bulk_delete'
  | 'subject.create'
  | 'template.apply'
  | 'school_config.update'
  | 'user.invite'
  | 'user.role.update'
  | 'user.disable'
  | 'user.enable'
  | 'environment.switch'
  | 'environment.seed';

export type AuditEntityType =
  | 'grading_sheet'
  | 'grade_entry'
  | 'section'
  | 'section_student'
  | 'teacher_assignment'
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
  | 'approver_assignment'
  | 'subject_config'
  | 'template_section'
  | 'template_subject_config'
  | 'template_application'
  | 'subject'
  | 'school_config'
  | 'user_account'
  | 'evaluation_writeup'
  | 'evaluation_term'
  | 'evaluation_checklist_item'
  | 'evaluation_checklist_response'
  | 'evaluation_subject_comment'
  | 'evaluation_ptc_feedback';

type LogActionParams = {
  service: SupabaseClient;
  actor: Pick<User, 'id' | 'email'> | { id: string | null; email: string | null };
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
export async function logActions(
  service: SupabaseClient,
  actor: { id: string; email: string | null },
  rows: Array<Omit<LogActionParams, 'service' | 'actor'>>,
): Promise<void> {
  await Promise.all(
    rows.map((row) => logAction({ service, actor, ...row })),
  );
}

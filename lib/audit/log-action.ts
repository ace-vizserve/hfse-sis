import type { SupabaseClient, User } from '@supabase/supabase-js';

// Comprehensive audit action taxonomy. Any mutation that touches real data
// should log one of these via `logAction()`. Matches the `action` column
// values expected by the audit-log UI; keep them in sync.
export type AuditAction =
  | 'sheet.create'
  | 'sheet.lock'
  | 'sheet.unlock'
  | 'entry.update'
  | 'totals.update'
  | 'student.sync'
  | 'student.add'
  | 'assignment.create'
  | 'assignment.delete'
  | 'attendance.update'
  | 'comment.update'
  | 'publication.create'
  | 'publication.delete'
  | 'grade_change_requested'
  | 'grade_change_approved'
  | 'grade_change_rejected'
  | 'grade_change_cancelled'
  | 'grade_change_applied'
  | 'grade_correction';

export type AuditEntityType =
  | 'grading_sheet'
  | 'grade_entry'
  | 'section_student'
  | 'teacher_assignment'
  | 'attendance_record'
  | 'report_card_comment'
  | 'report_card_publication'
  | 'sync_batch'
  | 'grade_change_request';

type LogActionParams = {
  service: SupabaseClient;
  actor: Pick<User, 'id' | 'email'> | { id: string; email: string | null };
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

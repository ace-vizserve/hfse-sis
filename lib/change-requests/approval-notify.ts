import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAdviserPools } from '@/lib/approvals/resolve';
import { fetchLabels } from '@/lib/change-requests/labels';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';
import { notifyStepTurn } from '@/lib/notifications/email-change-request';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  type GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * Who is on one step of a grade change's approval, with their email addresses.
 *
 * ⚠ A FORM ADVISER STEP IS WORKED OUT NOW, NOT READ FROM THE LADDER. The ladder
 * stores the class for that step and no people (migration 126), because the
 * adviser genuinely changes — a teacher covering the class this week is the
 * right person, and `approval_advance` asks `is_section_adviser` at the moment
 * somebody acts. The email has to reach the same person the database will let
 * decide.
 */
export type GradeChangeStepRecipients = {
  flow: GradeChangeApprovalFlow;
  stageOrder: number;
  stageCount: number;
  stageLabel: string;
  recipients: Array<{ id: string; email: string }>;
};

export async function loadGradeChangeStepRecipients(
  service: SupabaseClient,
  opts: {
    flow: GradeChangeApprovalFlow;
    gradeChangeRequestId: string;
    stageOrder: number;
  }
): Promise<GradeChangeStepRecipients | null> {
  const { data: request, error: requestErr } = await service
    .from('approval_requests')
    .select('id, filed_by')
    .eq('flow', opts.flow)
    .eq('subject_type', GRADE_CHANGE_SUBJECT_TYPE)
    .eq('subject_id', opts.gradeChangeRequestId)
    .maybeSingle();
  if (requestErr) throw new Error(requestErr.message);
  const requestRow = request as { id: string; filed_by?: string | null } | null;
  const requestId = requestRow?.id;
  if (!requestId) return null;
  const filedBy = requestRow?.filed_by ?? null;

  const { data: stages, error: stageErr } = await service
    .from('approval_request_stages')
    .select('stage_order, label, resolver, approver_pool, section_id')
    .eq('request_id', requestId)
    .order('stage_order', { ascending: true });
  if (stageErr) throw new Error(stageErr.message);

  const rows = (stages ?? []) as unknown as Array<{
    stage_order: number;
    label: string;
    resolver: 'named' | 'form_adviser';
    approver_pool: string[] | null;
    section_id: string | null;
  }>;
  const stage = rows.find((s) => s.stage_order === opts.stageOrder);
  if (!stage) return null;

  let people: string[];
  if (stage.resolver === 'named') {
    people = stage.approver_pool ?? [];
  } else if (stage.section_id) {
    const pools = await resolveAdviserPools(service, [stage.section_id]);
    people = pools.get(stage.section_id) ?? [];
  } else {
    people = [];
  }

  // ⚠ NEVER THE TEACHER WHO FILED IT. An email with Approve and Decline buttons
  // they cannot use is noise at best; a form adviser step would otherwise
  // mail the filer whenever they advise the class.
  const recipients = (
    await Promise.all(
      [...new Set(people)]
        .filter((id) => id !== filedBy)
        .map(async (id) => {
          try {
            const { data, error } = await service.auth.admin.getUserById(id);
            if (error || !data?.user?.email) return null;
            return { id, email: data.user.email };
          } catch {
            return null;
          }
        })
    )
  ).filter((r): r is { id: string; email: string } => r !== null);

  return {
    flow: opts.flow,
    stageOrder: stage.stage_order,
    stageCount: rows.length,
    stageLabel: stage.label,
    recipients,
  };
}

export type NotificationStatus = 'sent' | 'partial' | 'failed';

/** Same reading as the filing route has always given (sent / partial / failed). */
export function notificationStatusFor(res: {
  sent: number;
  failed: number;
}): NotificationStatus {
  // (0, 0) means RESEND_API_KEY was unset OR there were no recipients —
  // either way nothing actually went out, so don't claim 'sent'.
  if (res.sent === 0) return 'failed';
  return res.failed === 0 ? 'sent' : 'partial';
}

/**
 * Email the people on a step that is now waiting, and record how that went on
 * `grade_change_requests.notification_status`.
 *
 * Never throws: an email is a courtesy nudge and the approval itself is already
 * recorded. A failure is written as 'failed' so the row does not sit at
 * 'pending', which would read as "not tried yet".
 */
export async function sendGradeChangeStepEmails(
  service: SupabaseClient,
  opts: { gradeChangeRequestId: string; step: GradeChangeStepRecipients }
): Promise<NotificationStatus> {
  let status: NotificationStatus = 'failed';
  try {
    const { data: row, error } = await service
      .from('grade_change_requests')
      .select(
        'id, grading_sheet_id, grade_entry_id, field_changed, current_value, proposed_value, reason_category, justification, requested_by_email, requested_at'
      )
      .eq('id', opts.gradeChangeRequestId)
      .maybeSingle();
    if (error || !row) {
      throw new Error(error?.message ?? 'grade change request not found');
    }
    const req = row as unknown as {
      id: string;
      grading_sheet_id: string;
      grade_entry_id: string;
      field_changed: string;
      current_value: string | null;
      proposed_value: string;
      reason_category: string;
      justification: string;
      requested_by_email: string;
      requested_at: string;
    };
    const labels = await fetchLabels(
      service as Parameters<typeof fetchLabels>[0],
      req.grading_sheet_id,
      req.grade_entry_id
    );
    const res = await notifyStepTurn(
      {
        id: req.id,
        grading_sheet_id: req.grading_sheet_id,
        field_changed: req.field_changed,
        current_value: req.current_value,
        proposed_value: req.proposed_value,
        reason_category: req.reason_category,
        justification: req.justification,
        requested_by_email: req.requested_by_email,
        requested_at: req.requested_at,
        student_label: labels.student_label,
        sheet_label: labels.sheet_label,
      },
      {
        board: opts.step.flow === GRADE_CHANGE_AEB_APPROVAL_FLOW,
        stageOrder: opts.step.stageOrder,
        stageCount: opts.step.stageCount,
        stageLabel: opts.step.stageLabel,
      },
      opts.step.recipients
    );
    status = notificationStatusFor(res);
  } catch (e) {
    console.error(
      '[change-requests] step email failed',
      opts.gradeChangeRequestId,
      e instanceof Error ? e.message : String(e)
    );
    status = 'failed';
  }

  const { error: writeErr } = await service
    .from('grade_change_requests')
    .update({ notification_status: status })
    .eq('id', opts.gradeChangeRequestId);
  if (writeErr) {
    console.error(
      '[change-requests] notification_status update failed',
      writeErr.message
    );
  }
  return status;
}

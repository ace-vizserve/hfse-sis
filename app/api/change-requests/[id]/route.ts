import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import { ChangeRequestActionSchema } from '@/lib/schemas/change-request';
import {
  notifyRequestApproved,
  notifyRequestRejected,
} from '@/lib/notifications/email-change-request';
import {
  fetchLabels,
  fetchRegistrarEmails,
} from '../route';

// PATCH /api/change-requests/[id]
// Body: { action: 'approve' | 'reject' | 'cancel', decision_note?: string }
//
// Transitions:
//   approve  — admin+ only. pending → approved. decision_note optional.
//              Fires notifyRequestApproved() to teacher + registrar.
//   reject   — admin+ only. pending → rejected. decision_note required.
//              Fires notifyRequestRejected() to teacher.
//   cancel   — original requester only. pending → cancelled. No notifications.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['teacher', 'registrar', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = ChangeRequestActionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'invalid body' },
      { status: 400 },
    );
  }
  const { action, decision_note } = parsed.data;

  const service = createServiceClient();

  const { data: existing, error: fetchError } = await service
    .from('grade_change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 });
  }
  if (existing.status !== 'pending') {
    return NextResponse.json(
      { error: `cannot ${action} a request in status "${existing.status}"` },
      { status: 400 },
    );
  }

  // Authorization per action
  if (action === 'approve' || action === 'reject') {
    if (auth.role !== 'admin' && auth.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'only admin/superadmin can approve or reject' },
        { status: 403 },
      );
    }
  } else if (action === 'cancel') {
    if (existing.requested_by !== auth.user.id) {
      return NextResponse.json(
        { error: 'only the original requester can cancel this request' },
        { status: 403 },
      );
    }
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {};
  let auditAction: AuditAction;

  if (action === 'approve') {
    update.status = 'approved';
    update.reviewed_by = auth.user.id;
    update.reviewed_by_email = auth.user.email ?? '(unknown)';
    update.reviewed_at = nowIso;
    update.decision_note = decision_note ?? null;
    auditAction = 'grade_change_approved';
  } else if (action === 'reject') {
    update.status = 'rejected';
    update.reviewed_by = auth.user.id;
    update.reviewed_by_email = auth.user.email ?? '(unknown)';
    update.reviewed_at = nowIso;
    update.decision_note = decision_note ?? null;
    auditAction = 'grade_change_rejected';
  } else {
    update.status = 'cancelled';
    auditAction = 'grade_change_cancelled';
  }

  const { data: updated, error: updateError } = await service
    .from('grade_change_requests')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message ?? 'update failed' },
      { status: 500 },
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: auditAction,
    entityType: 'grade_change_request',
    entityId: id,
    context: {
      grading_sheet_id: updated.grading_sheet_id,
      grade_entry_id: updated.grade_entry_id,
      field: updated.field_changed,
      proposed: updated.proposed_value,
      decision_note: updated.decision_note ?? null,
    },
  });

  // Fire-and-forget notifications for approve/reject. Cancel is silent.
  if (action === 'approve' || action === 'reject') {
    void (async () => {
      try {
        const labels = await fetchLabels(service, updated.grading_sheet_id, updated.grade_entry_id);
        const summary = {
          id: updated.id,
          grading_sheet_id: updated.grading_sheet_id,
          field_changed: updated.field_changed,
          current_value: updated.current_value,
          proposed_value: updated.proposed_value,
          reason_category: updated.reason_category,
          justification: updated.justification,
          requested_by_email: updated.requested_by_email,
          requested_at: updated.requested_at,
          reviewed_by_email: updated.reviewed_by_email,
          decision_note: updated.decision_note,
          student_label: labels.student_label,
          sheet_label: labels.sheet_label,
        };
        if (action === 'approve') {
          const registrarEmails = await fetchRegistrarEmails(service);
          await notifyRequestApproved(summary, updated.requested_by_email, registrarEmails);
        } else {
          await notifyRequestRejected(summary, updated.requested_by_email);
        }
      } catch (e) {
        console.error('[change-requests] notify decision failed', e);
      }
    })();
  }

  return NextResponse.json({ request: updated });
}

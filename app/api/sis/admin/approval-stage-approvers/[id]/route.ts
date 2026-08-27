import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { removeStageApprover } from '@/lib/approvals/config';

// DELETE /api/sis/admin/approval-stage-approvers/[id] — take somebody off a step.
//
// ⚠ FORWARD-ONLY, like migration 013's rule for the older flow. Removing
// somebody here does not pull them out of requests already in flight: those
// carry their own frozen copy of the pool, so a decision somebody is part-way
// through stays theirs to finish.

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  try {
    const removed = await removeStageApprover(service, id);
    if (!removed) {
      return NextResponse.json(
        { error: 'That person is no longer on this step.' },
        { status: 404 }
      );
    }

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'approval_stage.approver.revoke',
      entityType: 'approval_stage_approver',
      entityId: id,
      context: { stage_id: removed.stageId, user_id: removed.userId },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] revoke failed:', reason);
    return NextResponse.json(
      { error: 'Could not remove that person. Please try again.' },
      { status: 500 }
    );
  }
}

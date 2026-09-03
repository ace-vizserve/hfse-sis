import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { removeStageApprover } from '@/lib/approvals/config';

// DELETE /api/sis/admin/approval-stage-approvers/[id] — take somebody off a step.
//
// ⚠ THIS REACHES REQUESTS ALREADY WAITING, and an earlier version of this
// comment said the opposite. It described the removal as forward-only, on the
// reasoning that a frozen pool leaves "a decision somebody is part-way through
// theirs to finish". That reasoning does not survive contact with the two
// cases it covers:
//
//   - a stage somebody has ALREADY decided is untouched either way, because
//     `repointWaitingStages` only rewrites undecided rows. The record of who
//     could decide something stays part of the record of the decision.
//   - a stage still waiting is one where NOBODY has acted, so there is no
//     decision in flight to protect — and leaving the removed person on it is
//     the failure, not the safeguard. If they left the school, that request
//     now waits on somebody who will never open it.
//
// Mr Ace, 2026-08-27: the approvers are not a static list. Taking somebody off
// a step takes them off the requests that are still waiting for them.

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
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'approval_stage.approver.revoke',
      entityType: 'approval_stage_approver',
      entityId: id,
      context: {
        stage_id: removed.stageId,
        user_id: removed.userId,
        applies_to_level_type: removed.appliesToLevelType,
        // How many requests still waiting were moved off them.
        repointed_waiting: removed.repointed,
      },
    });

    return NextResponse.json({ ok: true, repointed: removed.repointed });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] revoke failed:', reason);
    return NextResponse.json(
      { error: 'Could not remove that person. Please try again.' },
      { status: 500 }
    );
  }
}

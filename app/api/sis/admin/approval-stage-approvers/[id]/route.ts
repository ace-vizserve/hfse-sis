import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import {
  ApprovalConfigPartialError,
  removeStageApprover,
} from '@/lib/approvals/config';
import {
  APPROVER_LEVEL_SCOPE_LABELS,
  STAGED_FLOW_LABELS,
  type ApproverLevelScope,
} from '@/lib/schemas/approval-flows';
import { listStaffUsers } from '@/lib/sis/users/queries';

type RemovedApprover = {
  stageId: string;
  userId: string;
  appliesToLevelType: ApproverLevelScope | null;
};

// Who was taken off which step — names, not only ids. Best-effort: a failed
// lookup degrades to the ids, which are always recorded.
async function revokeContext(
  service: ReturnType<typeof createServiceClient>,
  removed: RemovedApprover,
  repointed: number | null
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    stage_id: removed.stageId,
    user_id: removed.userId,
    applies_to_level_type: removed.appliesToLevelType,
    applies_to_label: removed.appliesToLevelType
      ? (APPROVER_LEVEL_SCOPE_LABELS[removed.appliesToLevelType] ??
        removed.appliesToLevelType)
      : null,
    // How many requests still waiting were moved off them. null when the
    // removal committed but bringing waiting requests in line failed.
    repointed_waiting: repointed,
  };
  try {
    const [{ data: stage }, staff] = await Promise.all([
      service
        .from('approval_stages')
        .select('label, flow, stage_order')
        .eq('id', removed.stageId)
        .maybeSingle(),
      listStaffUsers(),
    ]);
    const s = stage as {
      label: string;
      flow: string;
      stage_order: number;
    } | null;
    if (s) {
      out.stage_label = s.label;
      out.stage_order = s.stage_order;
      out.flow = s.flow;
      out.flow_label =
        STAGED_FLOW_LABELS[s.flow as keyof typeof STAGED_FLOW_LABELS] ?? s.flow;
    }
    const person = staff.find((u) => u.id === removed.userId);
    if (person) {
      out.email = person.email;
      out.display_name = person.display_name;
    }
  } catch {
    // Ids are recorded above.
  }
  return out;
}

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
  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  try {
    // ⚠ The actor goes in, not just into the audit row. Taking the last
    // hold-out off an "Everyone must approve" step finishes that step for
    // every request already waiting on it, and whatever that sets moving is
    // recorded as this person's doing.
    const removed = await removeStageApprover(service, id, actor);
    if (!removed) {
      return NextResponse.json(
        { error: 'That person is no longer on this step.' },
        { status: 404 }
      );
    }

    await logAction({
      service,
      actor,
      action: 'approval_stage.approver.revoke',
      entityType: 'approval_stage_approver',
      entityId: id,
      context: await revokeContext(service, removed, removed.repointed),
    });

    // Taking the last person off a step turns the /sis readiness strip from
    // ready to not-ready (`getSystemHealth`, lib/sis/health.ts).
    revalidateTag('sis-health', 'max');

    return NextResponse.json({ ok: true, repointed: removed.repointed });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] revoke failed:', reason);
    if (e instanceof ApprovalConfigPartialError) {
      // The person IS off the step — only bringing waiting requests in line
      // failed. Record the removal that is live before reporting the failure.
      await logAction({
        service,
        actor,
        action: 'approval_stage.approver.revoke',
        entityType: 'approval_stage_approver',
        entityId: id,
        context: {
          ...(await revokeContext(
            service,
            e.committed as RemovedApprover,
            null
          )),
          partial: true,
          failed_step: e.failedStep,
          error: reason,
        },
      });
      revalidateTag('sis-health', 'max');
    }
    return NextResponse.json(
      { error: 'Could not remove that person. Please try again.' },
      { status: 500 }
    );
  }
}

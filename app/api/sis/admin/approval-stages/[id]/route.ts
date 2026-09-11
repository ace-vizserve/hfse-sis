import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import {
  APPROVAL_RULE_LABELS,
  UpdateApprovalStageSchema,
  type ApprovalRule,
} from '@/lib/schemas/approval-flows';
import {
  EVERYONE_NEEDS_NAMED_PEOPLE,
  deactivateStage,
  moveStage,
  renameStage,
  setStageRule,
} from '@/lib/approvals/config';

// PATCH  /api/sis/admin/approval-stages/[id] — rename, move up / down, or say
//                                              whether one person or everyone
//                                              on the step must approve
// DELETE /api/sis/admin/approval-stages/[id] — retire a step
//
// ⚠ DELETE DEACTIVATES, IT DOES NOT DELETE. Requests in flight carry their own
// copy of the ladder (lib/approvals/materialise.ts), so a real delete would not
// break them — but it would erase what the flow used to be, and an approval
// nobody can explain a year later is not much of an approval.
//
// ⚠ CHANGING "ANY ONE" / "EVERYONE" REACHES EVERY REQUEST NOT YET PAST THE
// STEP, including one sitting on it right now (`setStageRule` →
// `repointWaitingStages` → migration 146's `approval_repoint_request_stage`,
// under the request lock). Relaxing to "any one" finishes a live step somebody
// has already approved. So the rule change is audited like every other stage
// edit, with the setting before and after, and the number of requests it
// brought in line; a step it finishes gets its own audit row from the
// subject's handler.

async function readStage(
  service: ReturnType<typeof createServiceClient>,
  id: string
) {
  const { data } = await service
    .from('approval_stages')
    .select('id, flow, stage_order, label, resolver, approval_rule, is_active')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as {
    id: string;
    flow: string;
    stage_order: number;
    label: string;
    resolver: string;
    approval_rule: ApprovalRule | null;
    is_active: boolean;
  } | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateApprovalStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const service = createServiceClient();
  const existing = await readStage(service, id);
  if (!existing) {
    return NextResponse.json(
      { error: 'That step no longer exists.' },
      { status: 404 }
    );
  }

  const nextRule = parsed.data.approval_rule;
  // Refused BEFORE anything is written, so a request that also renames the
  // step does not half-succeed.
  if (nextRule === 'all' && existing.resolver !== 'named') {
    return NextResponse.json(
      { error: EVERYONE_NEEDS_NAMED_PEOPLE },
      { status: 400 }
    );
  }

  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  try {
    if (parsed.data.label !== undefined) {
      await renameStage(service, id, parsed.data.label);
    }
    let moved = true;
    if (parsed.data.move) {
      const result = await moveStage(service, id, parsed.data.move);
      moved = result.moved;
    }

    let rule: {
      changed: boolean;
      previous: ApprovalRule;
      repointed: number;
    } | null = null;
    if (nextRule !== undefined) {
      const result = await setStageRule(service, id, nextRule, actor);
      if (!result.ok) {
        // Both are races with the read above — the step was retired, or its
        // kind changed, between the two. Say what the screen can act on.
        return result.reason === 'needs_named_people'
          ? NextResponse.json(
              { error: EVERYONE_NEEDS_NAMED_PEOPLE },
              { status: 400 }
            )
          : NextResponse.json(
              { error: 'That step no longer exists.' },
              { status: 404 }
            );
      }
      rule = result;
    }

    await logAction({
      service,
      actor,
      action: 'approval_stage.update',
      entityType: 'approval_stage',
      entityId: id,
      context: {
        flow: existing.flow,
        stage_label: existing.label,
        ...(parsed.data.label !== undefined
          ? { new_label: parsed.data.label }
          : {}),
        ...(parsed.data.move ? { move: parsed.data.move, moved } : {}),
        ...(rule && nextRule !== undefined
          ? {
              approval_rule: nextRule,
              previous_approval_rule: rule.previous,
              // How many requests already waiting on this step were brought in
              // line — the same key the approver routes log.
              repointed_waiting: rule.repointed,
            }
          : {}),
      },
    });

    // A rename, a move or a rule change alters the steps `getSystemHealth`
    // (lib/sis/health.ts) caches for the /sis readiness strip and the hub's
    // attention feed, which name steps in their warnings.
    revalidateTag('sis-health', 'max');

    // Already first or last. Not an error — the control simply had nothing to
    // do — so say that rather than report a failure the user cannot act on.
    return NextResponse.json({
      ok: true,
      message: !moved
        ? parsed.data.move === 'up'
          ? 'That is already the first step.'
          : 'That is already the last step.'
        : rule && nextRule !== undefined
          ? ruleSavedMessage(
              existing.label,
              nextRule,
              rule.changed,
              rule.repointed
            )
          : 'Saved.',
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] update failed:', reason);
    return NextResponse.json(
      { error: 'Could not change that step. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * What the toast says after the setting changes.
 *
 * ⚠ THE SECOND SENTENCE IS TRUE SINCE MIGRATION 146 and only then: the change
 * reaches requests sitting on the step now, not only ones still on their way
 * to it. Relaxing to "any one" also finishes any of those somebody on the step
 * had already approved.
 */
function ruleSavedMessage(
  label: string,
  rule: ApprovalRule,
  changed: boolean,
  repointed: number
): string {
  if (!changed)
    return `“${label}” already reads “${APPROVAL_RULE_LABELS[rule]}”.`;
  const first =
    rule === 'all'
      ? `Saved. Everyone on “${label}” must now approve before it moves on.`
      : `Saved. Any one person on “${label}” can now approve it.`;
  if (repointed === 0) return first;
  const requests =
    repointed === 1
      ? 'The 1 request already at or heading to this step follows'
      : `The ${repointed} requests already at or heading to this step follow`;
  return rule === 'all'
    ? `${first} ${requests} the change too.`
    : `${first} ${requests} the change too, and any that someone on the step has already approved move on.`;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();
  const existing = await readStage(service, id);
  if (!existing) {
    return NextResponse.json(
      { error: 'That step no longer exists.' },
      { status: 404 }
    );
  }

  try {
    await deactivateStage(service, id);
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'approval_stage.delete',
      entityType: 'approval_stage',
      entityId: id,
      context: {
        flow: existing.flow,
        stage_label: existing.label,
        stage_order: existing.stage_order,
      },
    });
    // Retiring the last step, or the only empty one, moves the /sis readiness
    // strip (`getSystemHealth`, lib/sis/health.ts). Same tag as PATCH above.
    revalidateTag('sis-health', 'max');
    return NextResponse.json({ ok: true });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] retire failed:', reason);
    return NextResponse.json(
      { error: 'Could not remove that step. Please try again.' },
      { status: 500 }
    );
  }
}

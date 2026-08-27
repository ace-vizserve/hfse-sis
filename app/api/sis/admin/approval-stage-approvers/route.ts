import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { AssignStageApproverSchema } from '@/lib/schemas/approval-flows';
import { assignStageApprover } from '@/lib/approvals/config';
import { listStaffUsers } from '@/lib/sis/users/queries';

// POST /api/sis/admin/approval-stage-approvers — put somebody on a step.
//
// ⚠ ELIGIBILITY IS ANY STAFF ACCOUNT (Mr Ace, 2026-08-27), which is WIDER than
// the existing approver route's rule. That one requires `grade_changes.approve`
// — right for a flow about grades, wrong here, because the officer in charge
// who signs off an absence holds no grade capability at all and would simply
// not appear in the list.
//
// ⚠ THE STAFF-ROLE CHECK IS STILL LOAD-BEARING. `auth.users` is shared with
// roughly five hundred PARENT accounts, which are exactly the role-less rows.
// Without it a parent could be named as the approver of their own child's
// absence.

export async function POST(request: Request) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AssignStageApproverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Pick a person.' }, { status: 400 });
  }
  const { stage_id, user_id } = parsed.data;

  const service = createServiceClient();

  const staff = await listStaffUsers();
  const person = staff.find((u) => u.id === user_id);
  if (!person) {
    return NextResponse.json(
      {
        error:
          'That person does not have a staff account, so they cannot be an approver.',
      },
      { status: 400 }
    );
  }
  if (person.disabled) {
    return NextResponse.json(
      {
        error:
          'That account is switched off. Turn it back on before adding them here.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await assignStageApprover(service, {
      stageId: stage_id,
      userId: user_id,
      createdBy: auth.user.id,
    });

    if (result.alreadyAssigned) {
      // Idempotent success. The existing approver route treats a duplicate the
      // same way, for the same reason: a double-click is not a failure.
      return NextResponse.json({ ok: true, alreadyAssigned: true });
    }

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'approval_stage.approver.assign',
      entityType: 'approval_stage_approver',
      entityId: result.id,
      context: {
        stage_id,
        user_id,
        email: person.email,
        display_name: person.display_name,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] assign failed:', reason);
    // `assignStageApprover` throws a sentence for the one case a person can
    // actually act on — a step that works its people out from the class.
    return NextResponse.json(
      {
        error: reason.startsWith('That step')
          ? reason
          : 'Could not add that person. Please try again.',
      },
      { status: reason.startsWith('That step') ? 400 : 500 }
    );
  }
}

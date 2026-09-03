import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { UpdateApprovalStageSchema } from '@/lib/schemas/approval-flows';
import {
  deactivateStage,
  moveStage,
  renameStage,
} from '@/lib/approvals/config';

// PATCH  /api/sis/admin/approval-stages/[id] — rename, or move up / down
// DELETE /api/sis/admin/approval-stages/[id] — retire a step
//
// ⚠ DELETE DEACTIVATES, IT DOES NOT DELETE. Requests in flight carry their own
// copy of the ladder (lib/approvals/materialise.ts), so a real delete would not
// break them — but it would erase what the flow used to be, and an approval
// nobody can explain a year later is not much of an approval.

async function readStage(
  service: ReturnType<typeof createServiceClient>,
  id: string
) {
  const { data } = await service
    .from('approval_stages')
    .select('id, flow, stage_order, label, resolver, is_active')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as {
    id: string;
    flow: string;
    stage_order: number;
    label: string;
    resolver: string;
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

  try {
    if (parsed.data.label !== undefined) {
      await renameStage(service, id, parsed.data.label);
    }
    let moved = true;
    if (parsed.data.move) {
      const result = await moveStage(service, id, parsed.data.move);
      moved = result.moved;
    }

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
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
      },
    });

    // Already first or last. Not an error — the control simply had nothing to
    // do — so say that rather than report a failure the user cannot act on.
    return NextResponse.json({
      ok: true,
      message: !moved
        ? parsed.data.move === 'up'
          ? 'That is already the first step.'
          : 'That is already the last step.'
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

import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CreateApprovalStageSchema,
  STAGED_FLOW_LABELS,
} from '@/lib/schemas/approval-flows';
import { createStage, loadAllFlowConfigs } from '@/lib/approvals/config';

// GET  /api/sis/admin/approval-stages — every staged flow and its steps
// POST /api/sis/admin/approval-stages — add a step to the end of a flow
//
// ⚠ SAME CAPABILITY AS THE EXISTING APPROVER ROUTES, `approvers.manage`, and
// deliberately no new one. A capability is INERT until a matching
// `role_permissions` row exists in the live database (KD #166), so minting one
// here would ship a screen that silently refuses everybody until somebody
// remembers to run a grant. Reusing the existing capability also keeps one
// answer to "who decides who approves".
//
// ⚠ THE STEPS THEMSELVES ARE NOT SEEDED BY A MIGRATION. They are configuration
// naming real people, and a person's uuid does not belong in version control.

export async function GET() {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  try {
    const flows = await loadAllFlowConfigs(service);
    return NextResponse.json({ flows });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] list failed:', reason);
    return NextResponse.json(
      { error: 'Could not load the approval steps.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateApprovalStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the form.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  try {
    const stage = await createStage(service, {
      flow: parsed.data.flow,
      label: parsed.data.label,
      resolver: parsed.data.resolver,
      createdBy: auth.user.id,
    });

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'approval_stage.create',
      entityType: 'approval_stage',
      entityId: stage.id,
      context: {
        flow: stage.flow,
        flow_label: STAGED_FLOW_LABELS[stage.flow],
        stage_label: stage.label,
        stage_order: stage.stageOrder,
        resolver: stage.resolver,
      },
    });

    return NextResponse.json({ stage }, { status: 201 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[approval-stages] create failed:', reason);
    return NextResponse.json(
      { error: 'Could not add that step. Please try again.' },
      { status: 500 }
    );
  }
}

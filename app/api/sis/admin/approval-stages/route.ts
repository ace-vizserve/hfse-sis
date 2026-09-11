import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CreateApprovalStageSchema,
  STAGED_FLOW_LABELS,
} from '@/lib/schemas/approval-flows';
import {
  EVERYONE_NEEDS_NAMED_PEOPLE,
  createStage,
  loadAllFlowConfigs,
} from '@/lib/approvals/config';

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
    // The one refusal worth a sentence of its own: the form cannot point at a
    // single box for it, because it is two boxes disagreeing.
    const sent = (body ?? {}) as {
      approval_rule?: unknown;
      resolver?: unknown;
    };
    const everyoneOnAdviserStep =
      sent.approval_rule === 'all' && sent.resolver === 'form_adviser';
    return NextResponse.json(
      {
        error: everyoneOnAdviserStep
          ? EVERYONE_NEEDS_NAMED_PEOPLE
          : 'Please check the form.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  // ⚠ "Everyone must approve" on a form adviser step is refused by the schema
  // (and again by `createStage`, and again by the database). It never reaches
  // the write — a superadmin gets the reason in words instead of a 500.
  const approvalRule = parsed.data.approval_rule ?? 'any';

  const service = createServiceClient();
  try {
    const stage = await createStage(service, {
      flow: parsed.data.flow,
      label: parsed.data.label,
      resolver: parsed.data.resolver,
      approvalRule,
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
        // One of them, or all of them — part of what the step IS, so it is on
        // the record from the moment the step exists.
        approval_rule: stage.approvalRule,
      },
    });

    // The /sis readiness strip reports whether each grade-change approval has
    // its steps set up, and `getSystemHealth` (lib/sis/health.ts) caches that
    // school-wide. A new step can turn it from ready to not-ready.
    revalidateTag('sis-health', 'max');

    return NextResponse.json({ stage }, { status: 201 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (reason === EVERYONE_NEEDS_NAMED_PEOPLE) {
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    console.error('[approval-stages] create failed:', reason);
    return NextResponse.json(
      { error: 'Could not add that step. Please try again.' },
      { status: 500 }
    );
  }
}

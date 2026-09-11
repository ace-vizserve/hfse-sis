import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { DecideApprovalSchema } from '@/lib/schemas/approval-flows';
import { decideApproval } from '@/lib/approvals/decide';

// POST /api/approvals/[requestId]/decide — approve or turn down one step.
//
// ── WHO MAY CALL THIS ──────────────────────────────────────────────────────
//
// Any signed-in member of staff. There is deliberately NO capability gate, and
// that is not laziness:
//
//   * the two people on this flow are a form class adviser and an officer in
//     charge, and they hold no capability in common — the officer holds no
//     grade capability at all, which is exactly why the existing approver
//     picker's eligibility rule was the wrong one to reuse;
//   * a new capability would be INERT until a matching `role_permissions` row
//     exists in the live database (KD #166), so shipping one would ship a
//     feature that silently does nothing until somebody remembers to run a
//     grant. Migration 120 declined to mint one for the same reason.
//
// THE STAGE POOL IS THE PERMISSION. `approval_advance` re-checks it inside the
// lock and refuses anybody who is not on the step — see migration 127. The role
// check here only keeps out people with no business in the app at all.
//
// ── WHAT HAPPENS NEXT ──────────────────────────────────────────────────────
//
// Everything after the body is parsed lives in `lib/approvals/decide.ts`, and
// what a decision DOES to its subject lives in that subject's handler (for a
// declaration, `lib/declarations/approval-handler.ts`). This file only proves
// who is calling.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { requestId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = DecideApprovalSchema.safeParse(body);
  if (!parsed.success) {
    // ⚠ Say WHICH rule failed. A missing rejection reason is a mistake a real
    // approver makes on a real screen, and "Choose approve or turn down" would
    // be nonsense advice to somebody who has already chosen. The generic line
    // stays as the fallback for a genuinely malformed body.
    const first = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: first ?? 'Choose approve or turn down.' },
      { status: 400 }
    );
  }
  const { action, note } = parsed.data;

  const result = await decideApproval({
    service: createServiceClient(),
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    requestId,
    action,
    note: note && note.length > 0 ? note : null,
    via: 'in_app',
  });

  return NextResponse.json(result.body, { status: result.status });
}

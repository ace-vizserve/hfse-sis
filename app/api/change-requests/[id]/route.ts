import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { ChangeRequestActionSchema } from '@/lib/schemas/change-request';
import { decideChangeRequest } from '@/lib/change-requests/decide';

// PATCH /api/change-requests/[id]
// Body: { action: 'approve' | 'reject' | 'cancel', decision_note?: string }
//
// Transitions:
//   approve  — school_admin+ only. pending → approved. decision_note optional.
//              Fires notifyRequestApproved() to teacher + registrar.
//   reject   — school_admin+ only. pending → rejected. decision_note required.
//              Fires notifyRequestRejected() to teacher.
//   cancel   — original requester only. pending → cancelled. No notifications.
//
// The post-load decision logic (guards, update-building, optimistic update,
// audit + notifications) lives in lib/change-requests/decide.ts so the email
// one-click approve/reject route can share it. This handler only owns auth +
// body parsing + mapping the structured result to a NextResponse.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = ChangeRequestActionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'invalid body' },
      { status: 400 }
    );
  }
  const { action, decision_note } = parsed.data;

  const service = createServiceClient();

  const result = await decideChangeRequest({
    service,
    requestId: id,
    action,
    actingUser: {
      id: auth.user.id,
      email: auth.user.email,
      role: auth.role,
    },
    decisionNote: decision_note,
    via: 'in_app',
  });

  return NextResponse.json(
    result.ok ? { request: result.request } : { error: result.error },
    { status: result.httpStatus }
  );
}

import { NextResponse, type NextRequest } from 'next/server';

import { verifyActionToken } from '@/lib/change-requests/action-token';
import { decideChangeRequest } from '@/lib/change-requests/decide';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/change-requests/act
//
// The token-only one-click approve/reject endpoint behind the email
// quick-action buttons. Deliberately has NO requireRole() — the caller is an
// unauthenticated approver clicking a button in their inbox. Trust comes
// entirely from the signed action token (HMAC over requestId + action +
// approverId, keyed on CHANGE_REQUEST_ACTION_SECRET). It lives under /api/*
// so the proxy already skips it.
//
// The token proves "this approver, this request, this action" was issued by
// us; the workflow state machine in decideChangeRequest is the real gate
// (status guards, designated-approver scope, same-person double-stamp, etc).
export async function POST(request: NextRequest) {
  let body: { token?: unknown; decision_note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'This link is no longer valid.' },
      { status: 400 }
    );
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const decisionNote =
    typeof body.decision_note === 'string' ? body.decision_note : null;

  const payload = verifyActionToken(token);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: 'This link is no longer valid.' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Resolve the approver from the token's approverId. We need their email +
  // role to drive the same authorization the in-app PATCH route applies.
  let email: string | null = null;
  let role = '';
  try {
    const { data, error } = await service.auth.admin.getUserById(
      payload.approverId
    );
    if (error || !data?.user) {
      return NextResponse.json(
        { ok: false, error: 'Could not verify the approver account.' },
        { status: 400 }
      );
    }
    email = data.user.email ?? null;
    role = (data.user.app_metadata as { role?: string } | null)?.role ?? '';
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not verify the approver account.' },
      { status: 400 }
    );
  }

  const result = await decideChangeRequest({
    service,
    requestId: payload.requestId,
    action: payload.action,
    actingUser: { id: payload.approverId, email, role },
    decisionNote: decisionNote,
    via: 'email_token',
  });

  return NextResponse.json(
    result.ok
      ? { ok: true, status: result.status }
      : { ok: false, error: result.error },
    { status: result.httpStatus }
  );
}

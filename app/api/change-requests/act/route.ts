import { NextResponse, type NextRequest } from 'next/server';

import { getUserRole } from '@/lib/auth/roles';
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
    // ⚠ THE ROLE IN FORCE, NOT EVERY ROLE THE ACCOUNT HOLDS — this value
    // AUTHORISES (it is handed to `decideChangeRequest`, which looks up its
    // capabilities), and the whole point of the array/active_role shape is that
    // exactly one role is in force at a time. Reading the set here would give a
    // two-role account the union of both roles' rights, which is the one thing
    // the shape exists to prevent.
    //
    // The consequence, accepted: an approver who is currently working as a
    // teacher is refused by this link until they switch back, exactly as the
    // in-app Approve button would refuse them. `?? ''` is kept — an empty
    // string resolves to no capabilities, which is the safe direction.
    role = getUserRole(data.user) ?? '';
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

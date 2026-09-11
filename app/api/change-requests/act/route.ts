import { NextResponse, type NextRequest } from 'next/server';

import { getUserRole } from '@/lib/auth/roles';
import { decideApproval } from '@/lib/approvals/decide';
import { verifyActionToken } from '@/lib/change-requests/action-token';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';
import { decideChangeRequest } from '@/lib/change-requests/decide';
import { isEmptyRichText, proseLength } from '@/lib/rich-text';
import { APPROVAL_NOTE_MAX } from '@/lib/schemas/approval-flows';
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
// us; the workflow is the real gate.
//
// ⚠ TWO WORKFLOWS BEHIND ONE LINK, CHOSEN BY THE ROW. The token's `requestId`
// is always `grade_change_requests.id`. A row with an `approval_flow` was filed
// on the approval ladder (migration 144) and is decided by `decideApproval`,
// where the step's people are the permission — `approval_advance` refuses
// anybody not on the step that is waiting. A row without one was filed before
// and keeps `decideChangeRequest` exactly as it was (status guards, designated
// approver scope, same-person double-stamp).
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

  const { data: row, error: rowErr } = await service
    .from('grade_change_requests')
    .select('id, approval_flow')
    .eq('id', payload.requestId)
    .maybeSingle();
  if (rowErr) {
    return NextResponse.json(
      { ok: false, error: 'Could not open that request. Please try again.' },
      { status: 500 }
    );
  }
  const approvalFlow =
    (row as { approval_flow: string | null } | null)?.approval_flow ?? null;

  // Resolve the approver from the token's approverId. We need their email +
  // role to drive the same authorization the in-app routes apply.
  let email: string | null = null;
  let user: Parameters<typeof getUserRole>[0] = null;
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
    user = data.user;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not verify the approver account.' },
      { status: 400 }
    );
  }

  if (approvalFlow) {
    return decideOnLadder({
      service,
      flow: approvalFlow,
      gradeChangeRequestId: payload.requestId,
      action: payload.action,
      approverId: payload.approverId,
      email,
      user,
      note: decisionNote,
    });
  }

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
  const role = getUserRole(user) ?? '';

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

async function decideOnLadder(args: {
  service: ReturnType<typeof createServiceClient>;
  flow: string;
  gradeChangeRequestId: string;
  action: 'approve' | 'reject';
  approverId: string;
  email: string | null;
  user: Parameters<typeof getUserRole>[0];
  note: string | null;
}) {
  const note = args.note?.trim() ?? '';

  // The same two rules the in-app decide route applies through
  // `DecideApprovalSchema`, in words that name the teacher rather than a
  // parent — the reason is shown to the teacher who filed the change.
  if (args.action === 'reject' && isEmptyRichText(note)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Say why you are turning this down. The teacher is shown this as the reason.',
      },
      { status: 400 }
    );
  }
  if (proseLength(note) > APPROVAL_NOTE_MAX) {
    return NextResponse.json(
      {
        ok: false,
        error: `Keep the note to ${APPROVAL_NOTE_MAX} characters or fewer.`,
      },
      { status: 400 }
    );
  }

  const { data: request, error } = await args.service
    .from('approval_requests')
    .select('id')
    .eq('flow', args.flow)
    .eq('subject_type', GRADE_CHANGE_SUBJECT_TYPE)
    .eq('subject_id', args.gradeChangeRequestId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, error: 'Could not open that request. Please try again.' },
      { status: 500 }
    );
  }
  const requestId = (request as { id: string } | null)?.id;
  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: 'That request could not be found.' },
      { status: 404 }
    );
  }

  // ⚠ The role here is RECORDED, not used to authorise: the step's people are
  // the permission, and `approval_advance` checks them inside the lock.
  const result = await decideApproval({
    service: args.service,
    actor: {
      id: args.approverId,
      email: args.email,
      role: getUserRole(args.user),
    },
    requestId,
    action: args.action,
    note: isEmptyRichText(note) ? null : note,
    via: 'email_token',
  });

  return NextResponse.json(
    { ...result.body, ok: result.ok },
    { status: result.status }
  );
}

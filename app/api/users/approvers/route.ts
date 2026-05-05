import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { APPROVER_FLOWS, type ApproverFlow } from '@/lib/schemas/approvers';
import { listApproversForFlow } from '@/lib/sis/approvers/queries';

// GET /api/users/approvers?flow=markbook.change_request
//
// Returns the list of users currently assigned to the given flow. Used by
// the teacher's change-request form to populate the primary/secondary
// approver dropdowns. Teachers see it too (hence the broader allow list).
export async function GET(request: Request) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const flow = url.searchParams.get('flow');
  if (!flow || !(APPROVER_FLOWS as readonly string[]).includes(flow)) {
    return NextResponse.json({ error: 'Invalid or missing flow' }, { status: 400 });
  }

  const approvers = await listApproversForFlow(flow as ApproverFlow);

  // Filter out the caller themselves — a teacher can't designate themselves
  // as their own approver (even if they happen to have a dual role).
  const filtered = approvers.filter((a) => a.user_id !== auth.user.id);

  return NextResponse.json({
    approvers: filtered.map((a) => ({
      user_id: a.user_id,
      email: a.email,
      role: a.role,
    })),
  });
}

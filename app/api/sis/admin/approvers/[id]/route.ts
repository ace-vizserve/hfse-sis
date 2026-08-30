import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';

// DELETE /api/sis/admin/approvers/[id] — revoke an assignment (superadmin only).
//
// Pending change requests that already designated this approver keep that
// designation (it was snapshotted at submission time into
// grade_change_requests.primary_approver_id / secondary_approver_id). The
// revoked user can still act on those in-flight requests — revocation
// blocks *future* teachers from picking them.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const service = createServiceClient();
  const { data: existing, error: fetchErr } = await service
    .from('approver_assignments')
    .select('id, user_id, flow')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    );
  }

  const { error: delErr } = await service
    .from('approver_assignments')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'approver.revoke',
    entityType: 'approver_assignment',
    entityId: id,
    context: existing,
  });

  // Revoking drops this flow's coverage count on the /sis readiness strip,
  // which is exactly the signal that turns it from ok to not-ok. Same loader
  // the sibling POST busts (`getSystemHealth`, lib/sis/health.ts).
  revalidateTag('sis-health', 'max');

  return NextResponse.json({ ok: true });
}

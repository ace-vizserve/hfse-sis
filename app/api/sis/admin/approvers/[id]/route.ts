import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { APPROVER_FLOW_LABELS } from '@/lib/schemas/approvers';
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

  // Name the person and the flow — the row alone is two ids and a flow key.
  // Best-effort: a failed lookup still leaves the ids recorded. Same key names
  // as `approver.assign` (`email`), plus the display name.
  const row = existing as { id: string; user_id: string; flow: string };
  let email: string | null = null;
  let displayName: string | null = null;
  try {
    const { data: userRes } = await service.auth.admin.getUserById(row.user_id);
    email = userRes?.user?.email ?? null;
    const meta = (userRes?.user?.user_metadata ?? {}) as Record<
      string,
      unknown
    >;
    const name = meta.display_name ?? meta.full_name ?? meta.name;
    displayName = typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    // Ids are recorded.
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'approver.revoke',
    entityType: 'approver_assignment',
    entityId: id,
    context: {
      ...row,
      email,
      display_name: displayName,
      flow_label:
        APPROVER_FLOW_LABELS[row.flow as keyof typeof APPROVER_FLOW_LABELS] ??
        row.flow,
    },
  });

  // No cache tag — nothing cached reads `approver_assignments` any more. See
  // the note at the end of the sibling POST.

  return NextResponse.json({ ok: true });
}

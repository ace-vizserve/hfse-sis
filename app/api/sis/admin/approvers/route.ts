import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { getRoleCapabilities } from '@/lib/auth/permission-map';
import { requireCapability } from '@/lib/auth/require-capability';
import type { Role } from '@/lib/auth/roles';
import { AssignApproverSchema } from '@/lib/schemas/approvers';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/sis/admin/approvers — list all assignments, superadmin only.
// POST /api/sis/admin/approvers — assign a user to a flow, superadmin only.
//
// Per-flow deletion is handled by /api/sis/admin/approvers/[id] DELETE.

export async function GET() {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const { data, error } = await service
    .from('approver_assignments')
    .select('id, user_id, flow, created_at, created_by')
    .order('flow', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assignments: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = AssignApproverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { user_id, flow } = parsed.data;

  const service = createServiceClient();

  // Verify the target user has the school_admin role (the consolidated
  // cross-cutting role; the old `admin` twin was retired in Sprint 33).
  // Superadmins manage the approver list but don't act on requests
  // themselves, so they're explicitly rejected here.
  const { data: userRes, error: userErr } =
    await service.auth.admin.getUserById(user_id);
  if (userErr || !userRes?.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const role =
    (userRes.user.app_metadata as { role?: string } | null)?.role ??
    (userRes.user.user_metadata as { role?: string } | null)?.role ??
    null;
  // The target must hold grade_changes.approve — assigning someone who can't
  // approve would produce a designated approver whose every decision 403s.
  // Reads the same permission map decide.ts checks, so the two can't disagree.
  const capabilityMap = await getRoleCapabilities();
  const eligible =
    role != null &&
    (capabilityMap[role as Role] ?? []).includes('grade_changes.approve');
  if (!eligible) {
    return NextResponse.json(
      {
        error:
          'This person’s role is not allowed to approve change requests. Give that role the "Approve" permission for grade change requests first, in Role permissions.',
      },
      { status: 400 }
    );
  }

  const { data: inserted, error: insErr } = await service
    .from('approver_assignments')
    .insert({
      user_id,
      flow,
      created_by: auth.user.id,
    })
    .select('id')
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      // unique_violation — already assigned. Treat as idempotent success.
      return NextResponse.json({ ok: true, alreadyAssigned: true });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'approver.assign',
    entityType: 'approver_assignment',
    entityId: (inserted as { id: string }).id,
    context: { user_id, flow, email: userRes.user.email ?? null },
  });

  return NextResponse.json({ ok: true, id: (inserted as { id: string }).id });
}

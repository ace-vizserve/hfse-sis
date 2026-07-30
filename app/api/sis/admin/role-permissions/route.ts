import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import type { Capability } from '@/lib/auth/capabilities';
import { PERMISSIONS_CACHE_TAG } from '@/lib/auth/permission-map';
import { requireRole } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import {
  findOrphanedCapabilities,
  RolePermissionsUpdateSchema,
} from '@/lib/schemas/role-permissions';
import { createServiceClient } from '@/lib/supabase/service';

// GET  /api/sis/admin/role-permissions — every grant, superadmin only.
// PATCH /api/sis/admin/role-permissions — replace ONE role's grants.
//
// Superadmin-only, and deliberately NOT gated on a capability of its own. A
// capability that controls who may edit capabilities can be revoked, and the
// person who revokes it is then locked out of the only surface that could undo
// it. The role check is the fixed point the rest of the system pivots on.

export async function GET() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const { data, error } = await service
    .from('role_permissions')
    .select('role, capability');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ grants: data ?? [] });
}

export async function PATCH(request: Request) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = RolePermissionsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const role = parsed.data.role as Role;
  const next = parsed.data.capabilities as Capability[];

  // The superadmin row is the break-glass. If it were editable, one save could
  // remove the last route back into the system.
  if (role === 'superadmin') {
    return NextResponse.json(
      {
        error:
          "The superadmin role's permissions can't be changed — it's the way back in if a permission is set wrongly.",
        code: 'superadmin_locked',
      },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const { data: existing, error: readErr } = await service
    .from('role_permissions')
    .select('role, capability');
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const allGrants = (existing ?? []) as Array<{
    role: string;
    capability: string;
  }>;

  const before = allGrants
    .filter((g) => g.role === role)
    .map((g) => g.capability)
    .sort();
  const nextSet = new Set<string>(next);

  const added = next.filter((c) => !before.includes(c)).sort();
  const removed = before.filter((c) => !nextSet.has(c)).sort();
  if (added.length === 0 && removed.length === 0) {
    // Nothing to do. Returning early keeps the audit log free of saves that
    // changed nothing — the same no-op discipline the other SIS editors follow.
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Last-holder guard, evaluated against the state this save would produce.
  const orphaned = findOrphanedCapabilities(allGrants, role, next);
  if (orphaned.length > 0) {
    return NextResponse.json(
      {
        error: orphaned.includes('grade_changes.approve')
          ? 'Someone has to be able to approve grade changes. Give another role that permission first, then remove it here.'
          : 'Someone has to be able to manage staff accounts. Give another role that permission first, then remove it here.',
        code: 'last_holder',
        capabilities: orphaned,
      },
      { status: 422 }
    );
  }

  // Replace the role's set: delete what's going, insert what's new. Not a
  // delete-all-then-insert, which would briefly leave the role with nothing —
  // and this table is read on every request that gates on a capability.
  if (removed.length > 0) {
    const { error } = await service
      .from('role_permissions')
      .delete()
      .eq('role', role)
      .in('capability', removed);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  if (added.length > 0) {
    const { error } = await service.from('role_permissions').insert(
      added.map((capability) => ({
        role,
        capability,
        created_by: auth.user.id,
      }))
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Makes the change apply on the next page load rather than up to 60s later.
  // Second argument is Next 16's cache profile, same as invalidateDrillTags.
  revalidateTag(PERMISSIONS_CACHE_TAG, 'max');

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'role.permissions.update',
    entityType: 'role_permissions',
    entityId: role,
    // The diff, not the whole set: an audit reader wants to know what changed,
    // and the full set is recoverable from the table.
    context: { role, added, removed },
  });

  return NextResponse.json({ ok: true, added, removed });
}

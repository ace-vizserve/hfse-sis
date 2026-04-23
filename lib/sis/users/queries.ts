import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { ROLES, type Role } from '@/lib/auth/roles';

export type AdminUserRow = {
  id: string;
  email: string;
  role: Role | null;
  display_name: string;
  disabled: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

// Request-scoped fetch of every user in the project. Uses service-role
// listUsers. HFSE's user count is small (<30 active, ~500 parents)
// so perPage: 1000 is ample; revisit if the tenant grows.
export async function listAllUsers(): Promise<AdminUserRow[]> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error || !data) {
    console.error('[users] listAllUsers failed:', error?.message);
    return [];
  }
  return data.users.map((u) => {
    const appRole = (u.app_metadata as { role?: string } | null)?.role;
    const userRole = (u.user_metadata as { role?: string } | null)?.role;
    const raw = appRole ?? userRole ?? null;
    const role: Role | null =
      raw && (ROLES as readonly string[]).includes(raw) ? (raw as Role) : null;
    const displayName =
      (u.user_metadata as { display_name?: string; full_name?: string } | null)
        ?.display_name ??
      (u.user_metadata as { full_name?: string } | null)?.full_name ??
      u.email?.split('@')[0] ??
      '(unknown)';
    return {
      id: u.id,
      email: u.email ?? '',
      role,
      display_name: displayName,
      disabled: Boolean(
        u.banned_until && new Date(u.banned_until).getTime() > Date.now(),
      ),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  });
}

// Only-staff filter: everyone with a non-null role. Parents (role=null)
// are surfaced separately because the list is ~500× longer.
export async function listStaffUsers(): Promise<AdminUserRow[]> {
  const all = await listAllUsers();
  return all.filter((u) => u.role !== null);
}

import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import {
  resolveActiveRoleFromMetadata,
  resolveRoleSetFromMetadata,
  type Role,
} from '@/lib/auth/roles';

export type AdminUserRow = {
  id: string;
  email: string;
  /**
   * The role in force right now. Kept as the single value every existing
   * caller reads (the hub tally, the approver pickers, the directory's own
   * filter), so nothing had to learn a new shape to keep working.
   */
  role: Role | null;
  /**
   * Every role this account may hold — one entry for an account that holds
   * one, which is all of them until a superadmin grants a second. This is what
   * the Accounts table edits.
   */
  roles: Role[];
  display_name: string;
  disabled: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

// Request-scoped fetch of every user in the project. Uses service-role
// listUsers. HFSE's user count is small (<30 active, ~500 parents)
// so perPage: 1000 is ample; revisit if the tenant grows.
async function listAllUsers(): Promise<AdminUserRow[]> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error || !data) {
    console.error('[users] listAllUsers failed:', error?.message);
    return [];
  }
  return data.users.map((u) => {
    const appMeta = u.app_metadata as Record<string, unknown> | null;
    const userMeta = u.user_metadata as Record<string, unknown> | null;
    const role = resolveActiveRoleFromMetadata(appMeta, userMeta);
    const roles = resolveRoleSetFromMetadata(appMeta, userMeta);
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
      roles,
      display_name: displayName,
      disabled: Boolean(
        u.banned_until && new Date(u.banned_until).getTime() > Date.now()
      ),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  });
}

// Only-staff filter: everyone who holds at least one real role. Parents (no
// role at all) are surfaced separately because the list is ~500× longer.
export async function listStaffUsers(): Promise<AdminUserRow[]> {
  const all = await listAllUsers();
  return all.filter((u) => u.roles.length > 0);
}

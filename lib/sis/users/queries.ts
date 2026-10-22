import 'server-only';

import type { User } from '@supabase/supabase-js';

import { listAllAuthUsers } from '@/lib/supabase/paginate';
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

// Request-scoped fetch of every user in the project, every page of it. This
// read page 1 only (`perPage: 1000`), and parents share the project (KD #1):
// production held 1,123 accounts on 2026-10-22, so staff past the first 1,000
// never reached the Accounts table or its search.
async function listAllUsers(): Promise<AdminUserRow[]> {
  let users: User[];
  try {
    users = await listAllAuthUsers(createServiceClient());
  } catch (e) {
    console.error('[users] listAllUsers failed:', (e as Error).message);
    return [];
  }
  return users.map((u) => {
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

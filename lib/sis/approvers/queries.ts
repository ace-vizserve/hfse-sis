import 'server-only';
import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';
import { getRoleCapabilities } from '@/lib/auth/permission-map';
import {
  resolveActiveRoleFromMetadata,
  resolveRoleSetFromMetadata,
  type Role,
} from '@/lib/auth/roles';
import { APPROVER_FLOWS, type ApproverFlow } from '@/lib/schemas/approvers';

export type ApproverUser = {
  assignment_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  /** The role this account is working under — a label, not a gate. */
  role: Role | null;
  assigned_at: string;
};

// Request-scoped user list. `auth.admin.listUsers` doesn't accept an id filter
// and HFSE's user count is small (<30), so we fetch all and filter in memory.
// React.cache dedupes within a single render — both listApproversForFlow and
// listEligibleApproverCandidates can fan out across flows without refetching.
const getAllUsers = cache(async () => {
  const service = createServiceClient();
  const { data } = await service.auth.admin.listUsers({ perPage: 200 });
  return data?.users ?? [];
});

/**
 * Users currently assigned as approvers for the given flow, joined with
 * their auth.users row for display. Service-role only.
 */
export async function listApproversForFlow(
  flow: ApproverFlow
): Promise<ApproverUser[]> {
  const service = createServiceClient();

  const { data: rows, error } = await service
    .from('approver_assignments')
    .select('id, user_id, created_at')
    .eq('flow', flow)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[approvers] listApproversForFlow failed:', error.message);
    return [];
  }

  if (!rows || rows.length === 0) return [];

  type AssignmentRow = { id: string; user_id: string; created_at: string };
  const assignments = rows as AssignmentRow[];

  const users = await getAllUsers();
  const userById = new Map(users.map((u) => [u.id, u]));

  return assignments
    .map((a) => {
      const u = userById.get(a.user_id);
      if (!u) return null;
      // The role this account is working under right now — a label beside the
      // name, not a gate. Eligibility was decided when the assignment was
      // made, and is re-checked on every decision by the capability map.
      const role = resolveActiveRoleFromMetadata(
        u.app_metadata as Record<string, unknown> | null,
        u.user_metadata as Record<string, unknown> | null
      );
      const display_name =
        (u.user_metadata as { display_name?: string } | null)?.display_name ??
        null;
      return {
        assignment_id: a.id,
        user_id: a.user_id,
        email: u.email ?? '',
        display_name,
        role,
        assigned_at: a.created_at,
      };
    })
    .filter((u): u is ApproverUser => u !== null);
}

/**
 * True when the user has at least one assignment for the given flow. Used to
 * gate the "you must decide" priority headline in module dashboards so that
 * non-assigned school_admins (and registrar) don't see a callout for work
 * they can't act on. Superadmins are checked separately at the call site.
 */
export async function isUserAssignedApprover(
  userId: string,
  flow: ApproverFlow
): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('approver_assignments')
    .select('id', { count: 'exact', head: false })
    .eq('user_id', userId)
    .eq('flow', flow)
    .limit(1);
  if (error) {
    console.error('[approvers] isUserAssignedApprover failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export type AllApproversByFlow = Record<ApproverFlow, ApproverUser[]>;

/**
 * Loads the full approver list for every known flow. Used by the
 * superadmin /sis/admin/approvers page.
 */
export async function listAllApproverAssignments(): Promise<AllApproversByFlow> {
  const entries = await Promise.all(
    APPROVER_FLOWS.map(
      async (flow) => [flow, await listApproversForFlow(flow)] as const
    )
  );
  return Object.fromEntries(entries) as AllApproversByFlow;
}

/**
 * Eligible candidates for a given flow = users whose ROLE HOLDS
 * `grade_changes.approve`, minus whoever is already assigned. Populates the
 * "add approver" dropdown on /sis/admin/approvers.
 *
 * Was hardcoded to `role === 'school_admin'`. Same people today — that is the
 * only role seeded with the capability — but the pool is now movable from
 * /sis/admin/roles instead of requiring a code change in three separate files.
 * Superadmins remain excluded because they deliberately do not hold it: they
 * decide who may approve rather than approving themselves.
 */
export async function listEligibleApproverCandidates(
  flow: ApproverFlow
): Promise<Array<{ user_id: string; email: string; role: string }>> {
  const service = createServiceClient();

  const map = await getRoleCapabilities();
  const eligibleRoles = new Set(
    Object.entries(map)
      .filter(([, caps]) => caps.includes('grade_changes.approve'))
      .map(([role]) => role)
  );

  const users = await getAllUsers();
  const candidates = users
    .map((u) => {
      // ⚠ EVERY ROLE THE ACCOUNT HOLDS, NOT THE ONE IT IS USING RIGHT NOW.
      // Eligibility is a fact about the account: a school_admin who also
      // teaches may approve change requests whether or not she happens to be
      // working as a teacher this afternoon, and a list that dropped her
      // because of that would be unexplainable to whoever is reading it. The
      // role reported back is the one that MADE her eligible, so the label
      // beside her name always holds the capability the page is about.
      const role =
        resolveRoleSetFromMetadata(
          u.app_metadata as Record<string, unknown> | null,
          u.user_metadata as Record<string, unknown> | null
        ).find((r) => eligibleRoles.has(r)) ?? null;
      return { user_id: u.id, email: u.email ?? '', role };
    })
    .filter((u) => u.role != null)
    .filter((u) => u.email !== '');

  const { data: existing } = await service
    .from('approver_assignments')
    .select('user_id')
    .eq('flow', flow);

  const taken = new Set(
    ((existing ?? []) as { user_id: string }[]).map((r) => r.user_id)
  );

  return candidates
    .filter((c) => !taken.has(c.user_id))
    .map((c) => ({
      user_id: c.user_id,
      email: c.email,
      role: c.role as string,
    }));
}

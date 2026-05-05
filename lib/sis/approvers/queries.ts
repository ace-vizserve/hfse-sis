import 'server-only';
import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';
import { APPROVER_FLOWS, type ApproverFlow } from '@/lib/schemas/approvers';

export type ApproverUser = {
  assignment_id: string;
  user_id: string;
  email: string;
  role: string | null;
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
export async function listApproversForFlow(flow: ApproverFlow): Promise<ApproverUser[]> {
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
      const role =
        ((u.app_metadata as { role?: string } | null)?.role ??
          (u.user_metadata as { role?: string } | null)?.role ??
          null);
      return {
        assignment_id: a.id,
        user_id: a.user_id,
        email: u.email ?? '',
        role,
        assigned_at: a.created_at,
      };
    })
    .filter((u): u is ApproverUser => u !== null);
}

export type AllApproversByFlow = Record<ApproverFlow, ApproverUser[]>;

/**
 * Loads the full approver list for every known flow. Used by the
 * superadmin /sis/admin/approvers page.
 */
export async function listAllApproverAssignments(): Promise<AllApproversByFlow> {
  const entries = await Promise.all(
    APPROVER_FLOWS.map(async (flow) => [flow, await listApproversForFlow(flow)] as const),
  );
  return Object.fromEntries(entries) as AllApproversByFlow;
}

/**
 * Eligible candidates for a given flow = users with role `school_admin`
 * (the consolidated cross-cutting role; the old `admin` twin was retired
 * in Sprint 33). Superadmins are excluded because they manage the
 * approver list but don't act on change requests themselves. Returns the
 * pool minus whoever is already assigned. Used to populate the "add
 * approver" dropdown on /sis/admin/approvers.
 */
export async function listEligibleApproverCandidates(
  flow: ApproverFlow,
): Promise<Array<{ user_id: string; email: string; role: string }>> {
  const service = createServiceClient();

  const users = await getAllUsers();
  const candidates = users
    .map((u) => {
      const role =
        ((u.app_metadata as { role?: string } | null)?.role ??
          (u.user_metadata as { role?: string } | null)?.role ??
          null);
      return { user_id: u.id, email: u.email ?? '', role };
    })
    .filter((u) => u.role === 'school_admin')
    .filter((u) => u.email !== '');

  const { data: existing } = await service
    .from('approver_assignments')
    .select('user_id')
    .eq('flow', flow);

  const taken = new Set(
    ((existing ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  return candidates
    .filter((c) => !taken.has(c.user_id))
    .map((c) => ({ user_id: c.user_id, email: c.email, role: c.role as string }));
}

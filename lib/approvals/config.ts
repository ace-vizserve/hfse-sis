import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { listStaffUsers } from '@/lib/sis/users/queries';
import {
  STAGED_APPROVAL_FLOWS,
  type ApprovalResolver,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';
import type {
  FlowConfig,
  StageApproverView,
  StageView,
} from '@/lib/approvals/readiness';

/**
 * Reading and editing the steps of a staged approval flow.
 *
 * ⚠ ELIGIBILITY IS DELIBERATELY WIDER HERE THAN ON THE OTHER PICKER.
 * `listEligibleApproverCandidates` (lib/sis/approvers/queries.ts) builds its
 * list from whoever holds `grade_changes.approve`, which is right for a flow
 * about grades and wrong for this one: the Officer in Charge who signs off an
 * absence holds no grade capability at all, and narrowing to that list would
 * mean the person the school names simply does not appear.
 *
 * So the candidates are ANY STAFF ACCOUNT (Mr Ace, 2026-08-27).
 *
 * ⚠ `listStaffUsers` filters to a non-null role and THAT FILTER IS
 * LOAD-BEARING: `auth.users` is shared with roughly five hundred PARENT
 * accounts, which are exactly the role-less rows. Dropping the filter would
 * offer a parent as an approver of their own child's absence.
 */

export type {
  FlowConfig,
  StageApproverView,
  StageView,
  StagedFlowReadiness,
} from '@/lib/approvals/readiness';
export { classifyStagedFlowReadiness } from '@/lib/approvals/readiness';

export async function loadFlowConfig(
  service: SupabaseClient,
  flow: StagedApprovalFlow
): Promise<FlowConfig> {
  const { data: stageRows, error } = await service
    .from('approval_stages')
    .select('id, flow, stage_order, label, resolver')
    .eq('flow', flow)
    .eq('is_active', true)
    .order('stage_order', { ascending: true });
  if (error) throw new Error(error.message);

  type StageRow = {
    id: string;
    flow: StagedApprovalFlow;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
  };
  const stages = (stageRows ?? []) as unknown as StageRow[];
  if (stages.length === 0) return { flow, stages: [] };

  const { data: approverRows, error: approverErr } = await service
    .from('approval_stage_approvers')
    .select('id, stage_id, user_id, created_at')
    .in(
      'stage_id',
      stages.map((s) => s.id)
    )
    .order('created_at', { ascending: true });
  if (approverErr) throw new Error(approverErr.message);

  const staff = await listStaffUsers();
  const byId = new Map(staff.map((u) => [u.id, u]));

  const byStage = new Map<string, StageApproverView[]>();
  for (const row of (approverRows ?? []) as unknown as Array<{
    id: string;
    stage_id: string;
    user_id: string;
  }>) {
    const user = byId.get(row.user_id);
    const list = byStage.get(row.stage_id) ?? [];
    list.push({
      id: row.id,
      userId: row.user_id,
      // A person removed from the project keeps their row here so an in-flight
      // decision still reads correctly. Say so rather than render a blank.
      email: user?.email ?? '(account removed)',
      displayName: user?.display_name ?? '(account removed)',
      role: user?.role ?? null,
      disabled: user?.disabled ?? false,
    });
    byStage.set(row.stage_id, list);
  }

  return {
    flow,
    stages: stages.map((s) => ({
      id: s.id,
      flow: s.flow,
      stageOrder: s.stage_order,
      label: s.label,
      resolver: s.resolver,
      approvers: byStage.get(s.id) ?? [],
    })),
  };
}

export async function loadAllFlowConfigs(
  service: SupabaseClient
): Promise<FlowConfig[]> {
  return Promise.all(
    STAGED_APPROVAL_FLOWS.map((flow) => loadFlowConfig(service, flow))
  );
}

/** Any staff account not already on this step. */
export async function listStagedApproverCandidates(
  service: SupabaseClient,
  stageId: string
): Promise<
  Array<{
    user_id: string;
    email: string;
    display_name: string;
    role: string | null;
  }>
> {
  const { data, error } = await service
    .from('approval_stage_approvers')
    .select('user_id')
    .eq('stage_id', stageId);
  if (error) throw new Error(error.message);

  const taken = new Set(
    ((data ?? []) as unknown as Array<{ user_id: string }>).map(
      (r) => r.user_id
    )
  );

  const staff = await listStaffUsers();
  return staff
    .filter((u) => !u.disabled && !taken.has(u.id))
    .map((u) => ({
      user_id: u.id,
      email: u.email,
      display_name: u.display_name,
      role: u.role,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** New steps go on the end. Reordering is a separate, explicit action. */
export async function createStage(
  service: SupabaseClient,
  input: {
    flow: StagedApprovalFlow;
    label: string;
    resolver: ApprovalResolver;
    createdBy: string | null;
  }
): Promise<StageView> {
  const { data: existing, error: readErr } = await service
    .from('approval_stages')
    .select('stage_order')
    .eq('flow', input.flow)
    .eq('is_active', true)
    .order('stage_order', { ascending: false })
    .limit(1);
  if (readErr) throw new Error(readErr.message);

  const highest =
    ((existing ?? []) as unknown as Array<{ stage_order: number }>)[0]
      ?.stage_order ?? 0;

  const { data, error } = await service
    .from('approval_stages')
    .insert({
      flow: input.flow,
      stage_order: highest + 1,
      label: input.label,
      resolver: input.resolver,
      is_active: true,
      created_by: input.createdBy,
    })
    .select('id, flow, stage_order, label, resolver')
    .single();
  if (error) throw new Error(error.message);

  const row = data as unknown as {
    id: string;
    flow: StagedApprovalFlow;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
  };
  return {
    id: row.id,
    flow: row.flow,
    stageOrder: row.stage_order,
    label: row.label,
    resolver: row.resolver,
    approvers: [],
  };
}

export async function renameStage(
  service: SupabaseClient,
  stageId: string,
  label: string
): Promise<void> {
  const { error } = await service
    .from('approval_stages')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', stageId);
  if (error) throw new Error(error.message);
}

/**
 * Swap a step with its neighbour.
 *
 * ⚠ Three writes, not two. `approval_stages_flow_order_active_key` makes
 * (flow, stage_order) unique among active rows, so writing A's number onto B
 * while A still holds it violates the index. The middle value parks one of
 * them out of the way first. 32767 is smallint's ceiling — high enough that no
 * real configuration reaches it, and the row is only there for one statement.
 */
export async function moveStage(
  service: SupabaseClient,
  stageId: string,
  direction: 'up' | 'down'
): Promise<{ moved: boolean }> {
  const { data: stage, error } = await service
    .from('approval_stages')
    .select('id, flow, stage_order')
    .eq('id', stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!stage) throw new Error('stage_not_found');

  const self = stage as unknown as {
    id: string;
    flow: string;
    stage_order: number;
  };

  const { data: neighbourRows, error: neighbourErr } = await service
    .from('approval_stages')
    .select('id, stage_order')
    .eq('flow', self.flow)
    .eq('is_active', true)
    [direction === 'up' ? 'lt' : 'gt']('stage_order', self.stage_order)
    .order('stage_order', { ascending: direction !== 'up' })
    .limit(1);
  if (neighbourErr) throw new Error(neighbourErr.message);

  const neighbour = (
    (neighbourRows ?? []) as unknown as Array<{
      id: string;
      stage_order: number;
    }>
  )[0];
  // Already first or last. Not an error — the button simply had nothing to do.
  if (!neighbour) return { moved: false };

  const PARK = 32767;
  const steps: Array<{ id: string; stage_order: number }> = [
    { id: self.id, stage_order: PARK },
    { id: neighbour.id, stage_order: self.stage_order },
    { id: self.id, stage_order: neighbour.stage_order },
  ];
  for (const step of steps) {
    const { error: writeErr } = await service
      .from('approval_stages')
      .update({
        stage_order: step.stage_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', step.id);
    if (writeErr) throw new Error(writeErr.message);
  }
  return { moved: true };
}

/**
 * Retire a step.
 *
 * ⚠ Deactivated, never deleted. Requests already in flight carry their own
 * copy of the ladder (see `materialise.ts`), so deleting the configuration row
 * would not break them — but it would erase what the flow used to be, and a
 * finished approval that cannot be explained a year later is not much of an
 * approval.
 */
export async function deactivateStage(
  service: SupabaseClient,
  stageId: string
): Promise<void> {
  const { error } = await service
    .from('approval_stages')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', stageId);
  if (error) throw new Error(error.message);
}

export async function assignStageApprover(
  service: SupabaseClient,
  input: { stageId: string; userId: string; createdBy: string | null }
): Promise<{ alreadyAssigned: boolean; id: string | null }> {
  const { data, error } = await service
    .from('approval_stage_approvers')
    .insert({
      stage_id: input.stageId,
      resolver: 'named',
      user_id: input.userId,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  if (error) {
    // Already there. Idempotent success, the same call the existing approver
    // route makes for the same reason: a double-click is not a failure.
    if (error.code === '23505') return { alreadyAssigned: true, id: null };
    // The composite FK refuses a person on a derived step. Say what that means.
    if (error.code === '23503') {
      throw new Error(
        'That step works out its own people from the class, so nobody can be added to it by hand.'
      );
    }
    throw new Error(error.message);
  }
  return {
    alreadyAssigned: false,
    id: (data as unknown as { id: string }).id,
  };
}

export async function removeStageApprover(
  service: SupabaseClient,
  approverId: string
): Promise<{ stageId: string; userId: string } | null> {
  const { data: existing, error: readErr } = await service
    .from('approval_stage_approvers')
    .select('id, stage_id, user_id')
    .eq('id', approverId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) return null;

  const { error } = await service
    .from('approval_stage_approvers')
    .delete()
    .eq('id', approverId);
  if (error) throw new Error(error.message);

  const row = existing as unknown as { stage_id: string; user_id: string };
  return { stageId: row.stage_id, userId: row.user_id };
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { listStaffUsers } from '@/lib/sis/users/queries';
import { repointWaitingStages } from '@/lib/approvals/materialise';
import {
  APPROVAL_RULE_ALL_NEEDS_NAMED,
  STAGED_APPROVAL_FLOWS,
  type ApprovalResolver,
  type ApprovalRule,
  type ApproverLevelScope,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';
import {
  canRequireEveryone,
  type FlowConfig,
  type StageApproverView,
  type StageView,
} from '@/lib/approvals/readiness';

/**
 * Who is changing the configuration. Handed on to `repointWaitingStages`, which
 * may FINISH the live step of a request as a result — take the last hold-out
 * off an "Everyone must approve" step, or relax it to "any one of them" after
 * somebody on it has already approved (migration 146). Whatever that sets
 * moving (the next step, the register, the teacher's email) runs as this
 * person's doing, and the audit row says so while naming the approval the step
 * actually finished on — never this person as the approver.
 *
 * Read off that function's own signature, so the two can never disagree.
 */
export type ApprovalConfigActor = NonNullable<
  Parameters<typeof repointWaitingStages>[2]
>;

/** The sentence for the one refusal a superadmin can act on. */
export const EVERYONE_NEEDS_NAMED_PEOPLE = `${APPROVAL_RULE_ALL_NEEDS_NAMED} Who advises a class changes when someone covers it, so on that step any one adviser approves.`;

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
    .select('id, flow, stage_order, label, resolver, approval_rule')
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
    approval_rule: ApprovalRule | null;
  };
  const stages = (stageRows ?? []) as unknown as StageRow[];
  if (stages.length === 0) return { flow, stages: [] };

  const { data: approverRows, error: approverErr } = await service
    .from('approval_stage_approvers')
    .select('id, stage_id, user_id, applies_to_level_type, created_at')
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
    applies_to_level_type: ApproverLevelScope | null;
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
      // Nobody can act from an account that is not there. The readiness check
      // reads this: one such person stalls a step that needs everyone.
      removed: !user,
      appliesToLevelType: row.applies_to_level_type ?? null,
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
      // The column defaults to 'any' (migration 145); the fallback only covers
      // a read that races the migration.
      approvalRule: s.approval_rule ?? 'any',
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

/**
 * The halves of the school that actually have classes this year.
 *
 * Two jobs, both on the approvers screen: it decides which options the
 * "who can they approve for" picker offers, and it is what lets the readiness
 * check tell "nobody covers Secondary" apart from "this school has no
 * secondary".
 *
 * ⚠ Read from SECTIONS IN THE CURRENT YEAR, not from the `levels` table.
 * `levels` is a catalogue shared across every academic year and carries
 * preschool rows that HFSE has never opened a class for, so offering its
 * contents would put a Preschool option on the screen of a school with no
 * preschool children.
 */
export async function listLevelTypesInUse(
  service: SupabaseClient
): Promise<ApproverLevelScope[]> {
  const { data: ay, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  if (ayErr) throw new Error(ayErr.message);
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return [];

  const { data, error } = await service
    .from('sections')
    .select('levels!inner(level_type)')
    .eq('academic_year_id', ayId);
  if (error) throw new Error(error.message);

  const seen = new Set<ApproverLevelScope>();
  for (const row of (data ?? []) as unknown as Array<{
    levels:
      | { level_type: ApproverLevelScope }
      | { level_type: ApproverLevelScope }[]
      | null;
  }>) {
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear
    // in this codebase, so normalise rather than assume.
    const level = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    if (level?.level_type) seen.add(level.level_type);
  }

  // Stable, school-order rather than whatever the rows arrived in.
  return (['preschool', 'primary', 'secondary'] as const).filter((t) =>
    seen.has(t)
  );
}

/**
 * Any staff account that could still be added to this step, with the halves
 * they already hold on it.
 *
 * ⚠ A PERSON ALREADY ON THE STEP IS NOT EXCLUDED OUTRIGHT, and that changed
 * with migration 128. The officer in charge is one post per half of the
 * school, so somebody can legitimately hold the step for Primary and later be
 * asked to cover Secondary too. Filtering them out entirely — which is what
 * this did before — would make that impossible to configure.
 *
 * Somebody who already covers EVERY child is excluded, because there is
 * nothing further to give them.
 */
export async function listStagedApproverCandidates(
  service: SupabaseClient,
  stageId: string
): Promise<
  Array<{
    user_id: string;
    email: string;
    display_name: string;
    role: string | null;
    /** Halves already held on this step. `null` means "every child". */
    already_holds: Array<ApproverLevelScope | null>;
  }>
> {
  const { data, error } = await service
    .from('approval_stage_approvers')
    .select('user_id, applies_to_level_type')
    .eq('stage_id', stageId);
  if (error) throw new Error(error.message);

  const held = new Map<string, Array<ApproverLevelScope | null>>();
  for (const row of (data ?? []) as unknown as Array<{
    user_id: string;
    applies_to_level_type: ApproverLevelScope | null;
  }>) {
    const list = held.get(row.user_id) ?? [];
    list.push(row.applies_to_level_type ?? null);
    held.set(row.user_id, list);
  }

  const staff = await listStaffUsers();
  return staff
    .filter((u) => !u.disabled)
    .filter((u) => !(held.get(u.id) ?? []).includes(null))
    .map((u) => ({
      user_id: u.id,
      email: u.email,
      display_name: u.display_name,
      role: u.role,
      already_holds: held.get(u.id) ?? [],
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
    /** Defaults to `any` — one person carries the step, as every step did. */
    approvalRule?: ApprovalRule;
    createdBy: string | null;
  }
): Promise<StageView> {
  const approvalRule = input.approvalRule ?? 'any';
  // The schema refuses this first; this is the rule, restated where the write
  // happens, so no other caller can get round it.
  if (approvalRule === 'all' && !canRequireEveryone(input.resolver)) {
    throw new Error(EVERYONE_NEEDS_NAMED_PEOPLE);
  }

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
      approval_rule: approvalRule,
      is_active: true,
      created_by: input.createdBy,
    })
    .select('id, flow, stage_order, label, resolver, approval_rule')
    .single();
  if (error) throw new Error(error.message);

  const row = data as unknown as {
    id: string;
    flow: StagedApprovalFlow;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    approval_rule: ApprovalRule | null;
  };
  return {
    id: row.id,
    flow: row.flow,
    stageOrder: row.stage_order,
    label: row.label,
    resolver: row.resolver,
    approvalRule: row.approval_rule ?? approvalRule,
    approvers: [],
  };
}

export type SetStageRuleResult =
  | {
      ok: true;
      /** False when the step already had this setting — nothing was written. */
      changed: boolean;
      previous: ApprovalRule;
      /**
       * Requests not yet past the step — waiting for it or on it now — that
       * were brought in line with the change.
       */
      repointed: number;
    }
  | { ok: false; reason: 'stage_not_found' | 'needs_named_people' };

/**
 * Change whether a step needs one of its people or all of them.
 *
 * ⚠ IT REACHES EVERY REQUEST NOT YET PAST THE STEP — waiting for it, or sitting
 * on it right now — the same way changing who is on a step does
 * (`repointWaitingStages`, one `approval_repoint_request_stage` call per
 * request, under the lock a decision takes). A request should follow the
 * school's current answer to "who has to say yes", and neither direction
 * reinterprets anybody's decision:
 *
 *   - "any one of them" → "everyone": a live step has no approvals yet (the
 *     first yes would have closed it), so nothing finishes; it now waits for
 *     all of them.
 *   - "everyone" → "any one of them": if somebody on the live step has already
 *     approved, their yes is enough under the new setting, so the step
 *     finishes in the earliest approver's name and the request moves on. That
 *     is why the actor is passed along: what happens next runs on their name.
 *
 * ⚠ A STEP ALREADY DECIDED KEEPS THE SETTING IT WAS DECIDED UNDER. That is the
 * engine's rule (it only rewrites undecided rows), and it is what keeps a
 * finished approval explainable a year later.
 */
export async function setStageRule(
  service: SupabaseClient,
  stageId: string,
  rule: ApprovalRule,
  actor: ApprovalConfigActor
): Promise<SetStageRuleResult> {
  const { data, error } = await service
    .from('approval_stages')
    .select('id, resolver, approval_rule')
    .eq('id', stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: 'stage_not_found' };

  const stage = data as unknown as {
    resolver: ApprovalResolver;
    approval_rule: ApprovalRule | null;
  };
  const previous = stage.approval_rule ?? 'any';

  if (rule === 'all' && !canRequireEveryone(stage.resolver)) {
    return { ok: false, reason: 'needs_named_people' };
  }
  if (previous === rule) {
    return { ok: true, changed: false, previous, repointed: 0 };
  }

  const { error: writeErr } = await service
    .from('approval_stages')
    .update({ approval_rule: rule, updated_at: new Date().toISOString() })
    .eq('id', stageId);
  if (writeErr) throw new Error(writeErr.message);

  const repointed = await repointWaitingStages(service, stageId, actor);
  return { ok: true, changed: true, previous, repointed };
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
  input: {
    stageId: string;
    userId: string;
    /** `null` = approves for every child. */
    appliesToLevelType?: ApproverLevelScope | null;
    createdBy: string | null;
    /** Who is adding them — see `ApprovalConfigActor`. */
    actor: ApprovalConfigActor;
  }
): Promise<{ alreadyAssigned: boolean; id: string | null; repointed: number }> {
  const { data, error } = await service
    .from('approval_stage_approvers')
    .insert({
      stage_id: input.stageId,
      resolver: 'named',
      user_id: input.userId,
      applies_to_level_type: input.appliesToLevelType ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  if (error) {
    // Already there. Idempotent success, the same call the existing approver
    // route makes for the same reason: a double-click is not a failure.
    if (error.code === '23505')
      return { alreadyAssigned: true, id: null, repointed: 0 };
    // The composite FK refuses a person on a derived step. Say what that means.
    if (error.code === '23503') {
      throw new Error(
        'That step works out its own people from the class, so nobody can be added to it by hand.'
      );
    }
    throw new Error(error.message);
  }

  const repointed = await repointWaitingStages(
    service,
    input.stageId,
    input.actor
  );

  return {
    alreadyAssigned: false,
    id: (data as unknown as { id: string }).id,
    repointed,
  };
}

/**
 * ⚠ TAKING THE LAST HOLD-OUT OFF AN "EVERYONE" STEP FINISHES IT. If everybody
 * still on the step has already approved, the step is done the moment this
 * person leaves it, and the request moves on — so the actor goes along.
 */
export async function removeStageApprover(
  service: SupabaseClient,
  approverId: string,
  actor: ApprovalConfigActor
): Promise<{
  stageId: string;
  userId: string;
  appliesToLevelType: ApproverLevelScope | null;
  repointed: number;
} | null> {
  const { data: existing, error: readErr } = await service
    .from('approval_stage_approvers')
    .select('id, stage_id, user_id, applies_to_level_type')
    .eq('id', approverId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) return null;

  const { error } = await service
    .from('approval_stage_approvers')
    .delete()
    .eq('id', approverId);
  if (error) throw new Error(error.message);

  const row = existing as unknown as {
    stage_id: string;
    user_id: string;
    applies_to_level_type: ApproverLevelScope | null;
  };

  const repointed = await repointWaitingStages(service, row.stage_id, actor);

  return {
    stageId: row.stage_id,
    userId: row.user_id,
    appliesToLevelType: row.applies_to_level_type ?? null,
    repointed,
  };
}

// `repointWaitingStages` lives in `materialise.ts` — building a pool and
// rebuilding one are the same rule, and a plain node script (the repair
// script) has to reach it, which it could not do through this `server-only`
// module.
export { repointWaitingStages } from '@/lib/approvals/materialise';

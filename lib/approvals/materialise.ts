// ⚠ NO `import 'server-only'`, and that is deliberate rather than an omission.
// `scripts/repair-declaration-approvals.ts` imports this and runs under tsx,
// where the `server-only` package throws outright. `lib/supabase/service.ts`
// made the same call for the same reason and says so in words instead:
//
//   THIS IS SERVER CODE. It uses the service-role client and bypasses RLS.
//   Never import it from a client component.
//
// The neighbours that no script touches — config.ts, inbox.ts, resolve.ts —
// keep the directive.

import type { SupabaseClient } from '@supabase/supabase-js';

// ⚠ TYPE-ONLY. `decide.ts` is `server-only` and pulls in both subject handlers;
// a value import here would break the repair script that imports this file.
// The follow-up is loaded with a dynamic import, and only when an actor is
// given — which no script does.
import type { DecideActor } from '@/lib/approvals/decide';
import type {
  ApprovalRepointOutcome,
  ApprovalRule,
  ApproverLevelScope,
  StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * Opening a request — copying the configured stages into a ladder of their own.
 *
 * ⚠ WHY COPY AT ALL, RATHER THAN READ THE CONFIGURATION EACH TIME.
 *
 * Because the configuration changes and a decision that has already been made
 * must not change with it. The grade-change flow reached the same conclusion
 * from the other direction: `grade_change_requests.eligible_approver_snapshot`
 * (migration 044) exists so that removing somebody from a flow afterwards does
 * not strand a request they were already part of, and migration 013's rule is
 * that revocation is FORWARD-ONLY. This is that idea in a shape that can be
 * indexed and can carry a decision per step.
 *
 * ⚠ ONE EXCEPTION, AND IT IS THE POINT OF THE `form_adviser` RESOLVER. A
 * derived stage copies the SECTION, not the people. Its people are worked out
 * every time somebody acts, because the adviser of a class genuinely changes —
 * a relief teacher covering this week is the right person to decide this week's
 * absence, and freezing the pool would send it to the teacher who is away.
 *
 * ⚠ A NAMED STAGE FREEZES ONLY THE PEOPLE WHO COVER THIS CHILD'S HALF OF THE
 * SCHOOL (migration 128). HFSE's officer in charge is two posts, not two
 * approvers: Ms Lhen for Primary, Ms Elaine for Secondary. Freezing both would
 * mean either could decide either half's children, which is the bug 128 exists
 * to close.
 */

export type OpenApprovalRequestInput = {
  flow: StagedApprovalFlow;
  subjectType: string;
  subjectId: string;
  /** The class the subject belongs to. Required if any stage is derived. */
  sectionId: string | null;
  /**
   * Which half of the school this child is in, from `levels.level_type`.
   *
   * ⚠ `null` is not "unknown, carry on" — it narrows the pool to approvers who
   * cover every child. A named approver scoped to a half will NOT be frozen in
   * for a subject whose half we cannot establish, because putting the primary
   * officer on a child who might be in secondary is the exact mistake this
   * whole column exists to prevent.
   */
  levelType: ApproverLevelScope | null;
  filedBy: string | null;
  filedByEmail: string;
  /**
   * People who must never be frozen into a named step's pool on this request.
   *
   * ⚠ OPTIONAL AND EMPTY BY DEFAULT, so a consumer that does not pass it gets
   * exactly the pool it always got. A grade change passes the filer: a teacher
   * named on a step (or a coordinator filing on a colleague's behalf) must not
   * be able to approve their own request. A derived step holds no pool, so
   * this cannot reach it — the decide pipeline refuses the filer there
   * (`SUBJECT_PRECHECKS` in lib/approvals/decide.ts).
   */
  excludeUserIds?: readonly string[];
};

export type OpenApprovalRequestResult =
  | { opened: true; requestId: string; stageCount: number }
  | { opened: false; reason: 'already_open'; requestId: string }
  | { opened: false; reason: 'no_stages_configured' }
  | { opened: false; reason: 'derived_stage_without_section' };

type ConfiguredStage = {
  id: string;
  stage_order: number;
  label: string;
  resolver: 'named' | 'form_adviser';
  /** Migration 145. Missing reads as 'any'. */
  approval_rule?: ApprovalRule | null;
};

export type ConfiguredApprover = {
  userId: string;
  /** `null` = approves for every child. */
  appliesToLevelType: ApproverLevelScope | null;
};

/**
 * The people on a named stage who cover this child, deduped.
 *
 * ⚠ Deduped by PERSON, not by row. Somebody may hold both an untagged row and
 * a tagged one — redundant rather than wrong, and the unique index deliberately
 * permits it — but they must never land in a pool twice, or "first to act"
 * starts counting one person as two.
 */
export function poolForLevelType(
  approvers: ConfiguredApprover[],
  levelType: ApproverLevelScope | null
): string[] {
  const out: string[] = [];
  for (const approver of approvers) {
    const covers =
      approver.appliesToLevelType === null ||
      approver.appliesToLevelType === levelType;
    if (!covers) continue;
    if (!out.includes(approver.userId)) out.push(approver.userId);
  }
  return out;
}

/**
 * The rule a step is filed with. 'all' only ever on a named step — the same
 * line migration 145's CHECK draws — so anything else reads as 'any'.
 */
export function ruleForFiling(stage: {
  resolver: 'named' | 'form_adviser';
  approval_rule?: ApprovalRule | null;
}): ApprovalRule {
  return stage.resolver === 'named' && stage.approval_rule === 'all'
    ? 'all'
    : 'any';
}

/** The active steps of a flow, in order, each with its people if it names any. */
export async function loadConfiguredLadder(
  service: SupabaseClient,
  flow: StagedApprovalFlow
): Promise<Array<ConfiguredStage & { approvers: ConfiguredApprover[] }>> {
  const { data: stages, error } = await service
    .from('approval_stages')
    .select('id, stage_order, label, resolver, approval_rule')
    .eq('flow', flow)
    .eq('is_active', true)
    .order('stage_order', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (stages ?? []) as unknown as ConfiguredStage[];
  if (rows.length === 0) return [];

  const { data: approvers, error: approverErr } = await service
    .from('approval_stage_approvers')
    .select('stage_id, user_id, applies_to_level_type')
    .in(
      'stage_id',
      rows.map((r) => r.id)
    );
  if (approverErr) throw new Error(approverErr.message);

  const byStage = new Map<string, ConfiguredApprover[]>();
  for (const row of (approvers ?? []) as unknown as Array<{
    stage_id: string;
    user_id: string;
    applies_to_level_type: ApproverLevelScope | null;
  }>) {
    const list = byStage.get(row.stage_id) ?? [];
    list.push({
      userId: row.user_id,
      appliesToLevelType: row.applies_to_level_type ?? null,
    });
    byStage.set(row.stage_id, list);
  }

  return rows.map((r) => ({ ...r, approvers: byStage.get(r.id) ?? [] }));
}

export async function openApprovalRequest(
  service: SupabaseClient,
  input: OpenApprovalRequestInput
): Promise<OpenApprovalRequestResult> {
  const ladder = await loadConfiguredLadder(service, input.flow);

  // ⚠ NO STAGES CONFIGURED IS NOT AN ERROR HERE, and that is a deliberate
  // choice about who pays for a gap in the configuration. A parent filing an
  // absence about a sick child must not be turned away because a superadmin
  // has not finished setting up an approval chain they have never heard of.
  // The filing stands, reads "With the school", and
  // `scripts/repair-declaration-approvals.ts` opens its request once the
  // stages exist. The school sees the gap on /sis/admin/approvers.
  if (ladder.length === 0)
    return { opened: false, reason: 'no_stages_configured' };

  if (ladder.some((s) => s.resolver === 'form_adviser') && !input.sectionId) {
    return { opened: false, reason: 'derived_stage_without_section' };
  }

  const { data: created, error } = await service
    .from('approval_requests')
    .insert({
      flow: input.flow,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      status: 'pending',
      current_stage_order: 1,
      filed_by: input.filedBy,
      filed_by_email: input.filedByEmail,
    })
    .select('id')
    .single();

  if (error) {
    // A request already exists for this subject. Not a failure — it is the
    // unique index doing exactly what it is for, and the caller (a retry, or
    // the repair script) should carry on with the one that is there.
    if (error.code === '23505') {
      const { data: existing } = await service
        .from('approval_requests')
        .select('id')
        .eq('flow', input.flow)
        .eq('subject_type', input.subjectType)
        .eq('subject_id', input.subjectId)
        .maybeSingle();
      const id = (existing as { id: string } | null)?.id;
      if (id) return { opened: false, reason: 'already_open', requestId: id };
    }
    throw new Error(error.message);
  }

  const requestId = (created as unknown as { id: string }).id;
  const excluded = new Set(input.excludeUserIds ?? []);

  // ⚠ Renumbered 1..n rather than copying the configuration's own numbers. A
  // deactivated stage leaves a gap in the configuration, and the ladder is a
  // snapshot with no reason to inherit it.
  const stageRows = ladder.map((stage, index) => ({
    request_id: requestId,
    stage_order: index + 1,
    label: stage.label,
    resolver: stage.resolver,
    // ⚠ Which configured step this is a copy of (migration 146), so a later
    // change to that step's people or rule still finds this row after the
    // step is renamed. `repointWaitingStages` matched by label alone before,
    // and a rename cut every request already on the step off from it.
    config_stage_id: stage.id,
    // Copied like the pool (migration 145). ⚠ 'all' is written only onto a
    // named step: migration 145's CHECK refuses it on a derived one, and a
    // configuration row that somehow carried it must not fail the filing.
    approval_rule: ruleForFiling(stage),
    // Frozen for a named stage; the shape CHECK in migration 126 requires this
    // to be empty for a derived one.
    // ⚠ Filtered to this child's half of the school. An empty result is a
    // legitimate outcome and NOT corrected here: the step will stall visibly
    // rather than hand the child to an officer for the other half.
    approver_pool:
      stage.resolver === 'named'
        ? poolForLevelType(stage.approvers, input.levelType).filter(
            (id) => !excluded.has(id)
          )
        : [],
    section_id: stage.resolver === 'form_adviser' ? input.sectionId : null,
    // ⚠ Stamped on EVERY row, derived or named, so the pool of a request
    // already waiting can be rebuilt when the school changes who holds the
    // job (lib/approvals/config.ts::repointWaitingStages). Without it, a step
    // that had nobody on it at filing time stays empty forever.
    level_type: input.levelType,
    // Exactly one stage is live. See migration 126: it is what makes an inbox
    // one indexed query instead of a column-to-column comparison.
    status: index === 0 ? 'pending' : 'waiting',
  }));

  const { error: stageErr } = await service
    .from('approval_request_stages')
    .insert(stageRows);

  if (stageErr) {
    // A request with no ladder can never move and nothing would report it.
    // Take it back out rather than leave that behind; the caller retries.
    await service.from('approval_requests').delete().eq('id', requestId);
    throw new Error(stageErr.message);
  }

  return { opened: true, requestId, stageCount: stageRows.length };
}

// ── Keeping filings already in the queue pointed at the right people ────────

/**
 * Re-point every request still waiting at this step at whoever holds the job
 * now.
 *
 * ⚠ WITHOUT THIS, "the approvers are changeable" is only half true. A named
 * step copies its people in at the moment the parent files, which is normally
 * harmless — somebody taken off the list can still finish a decision they were
 * already holding, and that is right. But a step that had NOBODY on it when
 * the filing arrived freezes with an empty pool and stays empty however many
 * people are named afterwards. That request waits forever, with nobody able to
 * act and nothing on any screen explaining why.
 *
 * ⚠ ONLY UNDECIDED ROWS MOVE. A stage already approved or rejected keeps its
 * pool exactly as it was: who was able to decide something is part of the
 * record of the decision.
 *
 * The pool is recomputed per row from the child's own half (`level_type`,
 * stamped on the stage row since migration 128), so one person can hold
 * Primary and another Secondary and each waiting request follows its child.
 *
 * ── Finding the copies (migration 146) ──
 *
 * ⚠ BY `config_stage_id` FIRST, AND BY LABEL ONLY WHERE THAT IS NULL. A row
 * filed since 146 names the configured step it was copied from, so renaming
 * the step no longer cuts it off. The label is the fallback for older rows the
 * migration could not place — a ladder is renumbered 1..n at filing, so the
 * number was never a usable key.
 *
 * ── The rule (migrations 145 and 146) ──
 *
 * ⚠ THE CONFIGURED RULE REACHES THE LIVE STEP TOO, not only a waiting one.
 * Tightening "any one of them" to "everyone" cannot close a pending step — it
 * has no approvals, because the first yes closes an 'any' step. Relaxing
 * "everyone" to "any one of them" closes a step somebody on it has already
 * approved, in the earliest approver's name, and the request moves on.
 *
 * ⚠ EVERY WRITE GOES THROUGH `approval_repoint_request_stage`, one call per
 * row, which takes the same request lock `approval_advance` does. A plain
 * update from here could land between an approver's click and its commit, and
 * rewrite a step the click had just closed.
 *
 * ⚠ A LIVE 'all' STEP IS ALWAYS SENT, even when nothing about it changed. A
 * rebuild made without an actor (the repair script) can leave a step whose
 * people have all approved; the next edit made with one is what moves it.
 * When the call closes a step, the subject's follow-up runs in `actor`'s name
 * (the admin who made the change), and the handlers record the real last
 * approver beside them.
 *
 * ⚠ WITHOUT AN ACTOR, A LIVE 'all' STEP IS LEFT ALONE ENTIRELY — pool and rule
 * both. It is the only kind of live step a rewrite can close, and closing it
 * with no follow-up would leave the parent's status, the register and the next
 * step's email behind the ladder. A step left waiting is consistent, and the
 * next edit on the approvers screen (which always passes an actor) brings it
 * in line. The repair scripts call this without one.
 */
export async function repointWaitingStages(
  service: SupabaseClient,
  stageId: string,
  actor?: DecideActor | null
): Promise<number> {
  const { data: stage, error: stageErr } = await service
    .from('approval_stages')
    .select('id, flow, stage_order, label, resolver, approval_rule')
    .eq('id', stageId)
    .maybeSingle();
  if (stageErr) throw new Error(stageErr.message);
  if (!stage) return 0;

  const cfg = stage as unknown as {
    flow: string;
    stage_order: number;
    label: string;
    resolver: 'named' | 'form_adviser';
    approval_rule?: ApprovalRule | null;
  };
  // A derived step works its people out at decision time and holds no pool —
  // and can only ever be 'any', so there is no rule to carry either.
  if (cfg.resolver !== 'named') return 0;
  const configuredRule = ruleForFiling(cfg);

  const { data: approverRows, error: approverErr } = await service
    .from('approval_stage_approvers')
    .select('user_id, applies_to_level_type')
    .eq('stage_id', stageId);
  if (approverErr) throw new Error(approverErr.message);

  const approvers: ConfiguredApprover[] = (
    (approverRows ?? []) as unknown as Array<{
      user_id: string;
      applies_to_level_type: ApproverLevelScope | null;
    }>
  ).map((r) => ({
    userId: r.user_id,
    appliesToLevelType: r.applies_to_level_type ?? null,
  }));

  // ⚠ SCOPED BY FLOW, not just by stage number. `stage_order` is unique only
  // within a flow, so matching on it alone would rewrite a different flow's
  // step 2 the moment a second flow exists.
  const { data: openRows, error: openErr } = await service
    .from('approval_request_stages')
    .select(
      'id, request_id, label, config_stage_id, status, approval_rule, level_type, approver_pool, approval_requests!inner(flow, status, filed_by)'
    )
    .eq('approval_requests.flow', cfg.flow)
    .eq('approval_requests.status', 'pending')
    .eq('resolver', 'named')
    .in('status', ['pending', 'waiting']);
  if (openErr) throw new Error(openErr.message);

  type EmbeddedRequest = { filed_by: string | null };
  const rows = (openRows ?? []) as unknown as Array<{
    id: string;
    request_id?: string;
    label: string;
    config_stage_id?: string | null;
    status?: 'pending' | 'waiting';
    approval_rule?: ApprovalRule | null;
    level_type: ApproverLevelScope | null;
    approver_pool: string[] | null;
    approval_requests: EmbeddedRequest | EmbeddedRequest[] | null;
  }>;

  let changed = 0;
  for (const row of rows) {
    if (!isCopyOfStage(row, { id: stageId, label: cfg.label })) continue;
    const req = Array.isArray(row.approval_requests)
      ? row.approval_requests[0]
      : row.approval_requests;
    const filedBy = req?.filed_by ?? null;
    // ⚠ THE FILER STAYS OFF THEIR OWN REQUEST. A grade change is opened with
    // its filer left out of every pool (`excludeUserIds`); rebuilding the pool
    // from the configuration here would quietly put them back the next time
    // anyone edits the step. Applied to every flow because it is a no-op for
    // the rest: a declaration's filer is a parent, and parents are never on a
    // staff step.
    const next = poolForLevelType(approvers, row.level_type ?? null).filter(
      (id) => id !== filedBy
    );
    const poolChanged = !samePool(row.approver_pool ?? [], next);
    const rowRule: ApprovalRule = row.approval_rule ?? 'any';
    const ruleChanged = rowRule !== configuredRule;
    // The only live step a rewrite can close: one somebody may already have
    // approved. A pending 'any' step has no approvals — its first yes closes
    // it — so neither a new pool nor 'all' can finish it.
    const mayClose = row.status === 'pending' && rowRule === 'all';

    if (!poolChanged && !ruleChanged && !mayClose) continue;

    if (mayClose && !actor) {
      // Only worth saying when this run would have changed something; an
      // untouched step is exactly as it was.
      if (poolChanged || ruleChanged) {
        console.warn(
          '[approvals] a live step that needs everyone was left as it was, because no acting admin was given to run what follows if it moves on:',
          row.id
        );
      }
      continue;
    }

    const { data, error } = await service.rpc(
      'approval_repoint_request_stage',
      {
        p_request_stage_id: row.id,
        p_pool: next,
        p_rule: configuredRule,
      }
    );
    if (error) throw new Error(error.message);

    const result = (Array.isArray(data) ? data[0] : data) as {
      outcome: ApprovalRepointOutcome;
      decided_stage_order: number | null;
      next_stage_order: number | null;
    } | null;
    // The request closed, or the step was decided, while we waited for the
    // lock. Nothing was written, so nothing was re-pointed.
    if (!result || result.outcome === 'skipped') continue;

    if (poolChanged || ruleChanged) changed += 1;

    if (result.outcome === 'advanced' || result.outcome === 'completed') {
      await followUpAfterRepoint(service, row, actor ?? null, {
        outcome: result.outcome,
        decidedStageOrder: result.decided_stage_order,
        nextStageOrder: result.next_stage_order,
      });
    }
  }
  return changed;
}

/**
 * Is this ladder row a copy of that configured step?
 *
 * ⚠ BY ID WHEN THE ROW CARRIES ONE (migration 146) — a rename must not cut a
 * request off. By LABEL only for a row filed before 146 that the migration
 * could not place; a ladder is renumbered 1..n at filing, so a step
 * deactivated since then leaves the numbers disagreeing, and the label is what
 * somebody actually named.
 */
export function isCopyOfStage(
  row: { label: string; config_stage_id?: string | null },
  stage: { id: string; label: string }
): boolean {
  if (row.config_stage_id) return row.config_stage_id === stage.id;
  return row.label === stage.label;
}

/**
 * What follows a step that `approval_repoint_request_stage` just closed: the
 * subject's handler, in the acting admin's name.
 *
 * ⚠ LOGS RATHER THAN THROWS. The ladder has moved and the admin's edit
 * succeeded; the repair scripts bring a subject left behind back in line.
 */
async function followUpAfterRepoint(
  service: SupabaseClient,
  row: { id: string; request_id?: string },
  actor: DecideActor | null,
  moved: {
    outcome: 'advanced' | 'completed';
    decidedStageOrder: number | null;
    nextStageOrder: number | null;
  }
): Promise<void> {
  if (!actor) {
    // Only reachable when the step changed shape between our read and the
    // lock — `repointWaitingStages` never sends a closable step without one.
    console.error(
      '[approvals] a step moved on with no acting admin, so its follow-up did not run:',
      row.id
    );
    return;
  }

  const requestId = row.request_id;
  if (!requestId) {
    console.error(
      '[approvals] a step moved on but its request id was not read; the follow-up did not run:',
      row.id
    );
    return;
  }

  const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
  await runSubjectFollowUp({
    service,
    actor,
    requestId,
    outcome: moved.outcome,
    decidedStageOrder: moved.decidedStageOrder,
    nextStageOrder: moved.nextStageOrder,
    via: 'repoint',
  });
}

/** Order is not meaningful in a pool, so compare as sets. */
export function samePool(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

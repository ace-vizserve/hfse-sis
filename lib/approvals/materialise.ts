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

import type { StagedApprovalFlow } from '@/lib/schemas/approval-flows';

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
 */

export type OpenApprovalRequestInput = {
  flow: StagedApprovalFlow;
  subjectType: string;
  subjectId: string;
  /** The class the subject belongs to. Required if any stage is derived. */
  sectionId: string | null;
  filedBy: string | null;
  filedByEmail: string;
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
};

/** The active steps of a flow, in order, each with its people if it names any. */
export async function loadConfiguredLadder(
  service: SupabaseClient,
  flow: StagedApprovalFlow
): Promise<Array<ConfiguredStage & { approverIds: string[] }>> {
  const { data: stages, error } = await service
    .from('approval_stages')
    .select('id, stage_order, label, resolver')
    .eq('flow', flow)
    .eq('is_active', true)
    .order('stage_order', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (stages ?? []) as unknown as ConfiguredStage[];
  if (rows.length === 0) return [];

  const { data: approvers, error: approverErr } = await service
    .from('approval_stage_approvers')
    .select('stage_id, user_id')
    .in(
      'stage_id',
      rows.map((r) => r.id)
    );
  if (approverErr) throw new Error(approverErr.message);

  const byStage = new Map<string, string[]>();
  for (const row of (approvers ?? []) as unknown as Array<{
    stage_id: string;
    user_id: string;
  }>) {
    const list = byStage.get(row.stage_id) ?? [];
    list.push(row.user_id);
    byStage.set(row.stage_id, list);
  }

  return rows.map((r) => ({ ...r, approverIds: byStage.get(r.id) ?? [] }));
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

  // ⚠ Renumbered 1..n rather than copying the configuration's own numbers. A
  // deactivated stage leaves a gap in the configuration, and the ladder is a
  // snapshot with no reason to inherit it.
  const stageRows = ladder.map((stage, index) => ({
    request_id: requestId,
    stage_order: index + 1,
    label: stage.label,
    resolver: stage.resolver,
    // Frozen for a named stage; the shape CHECK in migration 126 requires this
    // to be empty for a derived one.
    approver_pool: stage.resolver === 'named' ? stage.approverIds : [],
    section_id: stage.resolver === 'form_adviser' ? input.sectionId : null,
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

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { samePool } from '@/lib/approvals/materialise';
import {
  SOW_APPROVAL_FLOW,
  type ApprovalRepointOutcome,
} from '@/lib/schemas/approval-flows';

// Subject heads — who approves a subject's schemes of work (migration 198).
//
// A configured `subject_head` step of the scheme-of-work flow lists nobody on
// the approvers screen. Its people come from here, per SOW subject, and are
// frozen into the request when a SOW is sent (`openApprovalRequest`'s
// `subjectHeadPool`). So a change here has to reach the requests already
// waiting, the way `repointWaitingStages` does for a named step — which
// deliberately skips subject-head steps and leaves them to this file.
//
// ⚠ `subject_heads` IS DENY-ALL TO THE BROWSER. Every read and write here
// takes the service client.

export type SubjectHeadLevelType = 'primary' | 'secondary';

export type SubjectHeadRow = {
  subjectId: string;
  userId: string;
  appliesToLevelType: SubjectHeadLevelType | null;
};

/**
 * Who is changing the heads. The role and email are only for the audit row;
 * `email` may be null because a session's claims can lack one.
 */
export type SubjectHeadActor = {
  id: string;
  email: string | null;
  role?: Role | null;
};

/** Names for the audit row, keyed by user id. Optional — ids are always kept. */
export type SubjectHeadNames = Map<
  string,
  { email: string; displayName: string }
>;

export async function listSubjectHeads(
  service: SupabaseClient
): Promise<SubjectHeadRow[]> {
  const { data, error } = await service
    .from('subject_heads')
    .select('subject_id, user_id, applies_to_level_type')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as unknown as Array<{
      subject_id: string;
      user_id: string;
      applies_to_level_type: SubjectHeadLevelType | null;
    }>
  ).map((r) => ({
    subjectId: r.subject_id,
    userId: r.user_id,
    appliesToLevelType: r.applies_to_level_type ?? null,
  }));
}

/**
 * The heads who approve one subject for a child in this half of the school:
 * every untagged head plus the heads of that half, each person once.
 *
 * ⚠ DEDUPED BY PERSON, as `poolForLevelType` is for a named step. Somebody
 * may hold an untagged row and a tagged one; they must never count twice.
 * A level with no half (`null`, e.g. a preschool level) gets the untagged
 * heads only.
 */
export function subjectHeadPool(
  rows: SubjectHeadRow[],
  subjectId: string,
  levelType: SubjectHeadLevelType | null
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.subjectId !== subjectId) continue;
    const covers =
      row.appliesToLevelType === null || row.appliesToLevelType === levelType;
    if (covers && !out.includes(row.userId)) out.push(row.userId);
  }
  return out;
}

const keyOf = (r: {
  userId: string;
  appliesToLevelType: SubjectHeadLevelType | null;
}) => `${r.userId}|${r.appliesToLevelType ?? '*'}`;

/**
 * Set one subject's heads to exactly `rows`, then bring every waiting or live
 * subject-head step of that subject's schemes of work in line, then write the
 * audit row.
 *
 * ⚠ A DIFF, NOT DELETE-ALL-THEN-INSERT. Only the rows that went are deleted
 * and only the new ones inserted, so a failure half-way never leaves a
 * subject with fewer heads than either the old or the new list.
 */
export async function replaceSubjectHeads(
  service: SupabaseClient,
  actor: SubjectHeadActor,
  subjectId: string,
  rows: Omit<SubjectHeadRow, 'subjectId'>[],
  names?: SubjectHeadNames
): Promise<{ repointed: number }> {
  // The same person twice with the same scope is one row (the unique index
  // would refuse the second anyway).
  const wanted = new Map<string, Omit<SubjectHeadRow, 'subjectId'>>();
  for (const r of rows) {
    const row = {
      userId: r.userId,
      appliesToLevelType: r.appliesToLevelType ?? null,
    };
    wanted.set(keyOf(row), row);
  }

  const { data: existingData, error: readErr } = await service
    .from('subject_heads')
    .select('id, user_id, applies_to_level_type')
    .eq('subject_id', subjectId);
  if (readErr) throw new Error(readErr.message);
  const existing = (
    (existingData ?? []) as unknown as Array<{
      id: string;
      user_id: string;
      applies_to_level_type: SubjectHeadLevelType | null;
    }>
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    appliesToLevelType: r.applies_to_level_type ?? null,
  }));
  const existingKeys = new Set(existing.map(keyOf));

  const goneIds = existing
    .filter((r) => !wanted.has(keyOf(r)))
    .map((r) => r.id);
  const added = [...wanted.values()].filter((r) => !existingKeys.has(keyOf(r)));

  if (goneIds.length > 0) {
    const { error } = await service
      .from('subject_heads')
      .delete()
      .in('id', goneIds);
    if (error) throw new Error(error.message);
  }
  if (added.length > 0) {
    const { error } = await service.from('subject_heads').insert(
      added.map((r) => ({
        subject_id: subjectId,
        user_id: r.userId,
        applies_to_level_type: r.appliesToLevelType,
        created_by: actor.id,
      }))
    );
    if (error) throw new Error(error.message);
  }

  const now: SubjectHeadRow[] = [...wanted.values()].map((r) => ({
    subjectId,
    ...r,
  }));

  // The subject's name for the audit line. Best-effort: the id is always kept.
  const { data: subjectRow } = await service
    .from('subjects')
    .select('name')
    .eq('id', subjectId)
    .maybeSingle();

  const describe = (list: Array<Omit<SubjectHeadRow, 'subjectId'>>) =>
    list.map((r) => ({
      user_id: r.userId,
      email: names?.get(r.userId)?.email ?? null,
      display_name: names?.get(r.userId)?.displayName ?? null,
      applies_to_level_type: r.appliesToLevelType,
    }));
  const audit = (context: Record<string, unknown>) =>
    logAction({
      service,
      actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
      action: 'sow.subject_head.set',
      entityType: 'subject',
      entityId: subjectId,
      context: {
        subject_id: subjectId,
        subject_name: (subjectRow as { name?: string } | null)?.name ?? null,
        heads: describe(now),
        previous_heads: describe(existing),
        ...context,
      },
    });

  let repointed: number;
  try {
    repointed = await repointSubjectHeadSteps(service, actor, subjectId, now);
  } catch (e) {
    // The heads ARE changed — only bringing waiting schemes of work in line
    // failed. Record what is live before reporting the failure.
    await audit({
      repointed_waiting: null,
      partial: true,
      failed_step: 'repoint_waiting_requests',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  await audit({ repointed_waiting: repointed });
  return { repointed };
}

type OpenStageRow = {
  id: string;
  request_id: string;
  status: 'pending' | 'waiting';
  approval_rule: 'any' | 'all' | null;
  level_type: string | null;
  approver_pool: string[] | null;
  config_stage_id: string | null;
  approval_requests:
    | { filed_by: string | null; subject_id: string }
    | Array<{ filed_by: string | null; subject_id: string }>
    | null;
};

/**
 * Re-point the open subject-head steps of one subject's schemes of work.
 *
 * Which steps: request steps that are `waiting` or `pending`, on `pending`
 * requests of the scheme-of-work flow, copied from a `subject_head` config
 * step (by `config_stage_id` — every SOW request is filed after migration
 * 146, so there is no label fallback to carry). A request's subject is a
 * submission; its scheme of work says which subject it is.
 *
 * The level comes from the request step's own `level_type`, frozen when it was
 * filed — the same value the pool was first built from.
 */
async function repointSubjectHeadSteps(
  service: SupabaseClient,
  actor: SubjectHeadActor,
  subjectId: string,
  heads: SubjectHeadRow[]
): Promise<number> {
  // ⚠ RETIRED STEPS INCLUDED. A request filed before a step was retired still
  // carries its copy, and that copy is still where the request waits.
  const { data: cfgData, error: cfgErr } = await service
    .from('approval_stages')
    .select('id')
    .eq('flow', SOW_APPROVAL_FLOW)
    .eq('resolver', 'subject_head');
  if (cfgErr) throw new Error(cfgErr.message);
  const configIds = ((cfgData ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (configIds.length === 0) return 0;

  const { data: openData, error: openErr } = await service
    .from('approval_request_stages')
    .select(
      'id, request_id, status, approval_rule, level_type, approver_pool, config_stage_id, approval_requests!inner(flow, status, filed_by, subject_id)'
    )
    .eq('approval_requests.flow', SOW_APPROVAL_FLOW)
    .eq('approval_requests.status', 'pending')
    .eq('resolver', 'named')
    .in('status', ['pending', 'waiting'])
    .in('config_stage_id', configIds);
  if (openErr) throw new Error(openErr.message);
  const open = ((openData ?? []) as unknown as OpenStageRow[]).filter(
    (r) => r.config_stage_id && configIds.includes(r.config_stage_id)
  );
  if (open.length === 0) return 0;

  const requestOf = (r: OpenStageRow) =>
    Array.isArray(r.approval_requests)
      ? r.approval_requests[0]
      : r.approval_requests;

  const submissionIds = [
    ...new Set(
      open
        .map((r) => requestOf(r)?.subject_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: subData, error: subErr } = await service
    .from('scheme_of_work_submissions')
    .select('id, schemes_of_work!inner(subject_id)')
    .in('id', submissionIds);
  if (subErr) throw new Error(subErr.message);
  type SowEmbed = { subject_id: string };
  const ofThisSubject = new Set(
    (
      (subData ?? []) as unknown as Array<{
        id: string;
        schemes_of_work: SowEmbed | SowEmbed[] | null;
      }>
    )
      .filter((s) => {
        const sow = Array.isArray(s.schemes_of_work)
          ? s.schemes_of_work[0]
          : s.schemes_of_work;
        return sow?.subject_id === subjectId;
      })
      .map((s) => s.id)
  );

  let changed = 0;
  for (const row of open) {
    const req = requestOf(row);
    if (!req || !ofThisSubject.has(req.subject_id)) continue;

    const levelType =
      row.level_type === 'primary' || row.level_type === 'secondary'
        ? row.level_type
        : null;
    // ⚠ THE FILER STAYS OFF THEIR OWN REQUEST, as at filing — a teacher who
    // is also a head of the subject never approves their own scheme.
    const next = subjectHeadPool(heads, subjectId, levelType).filter(
      (id) => id !== req.filed_by
    );
    const rule = row.approval_rule ?? 'any';
    if (samePool(row.approver_pool ?? [], next) && rule === 'any') continue;

    const { data, error } = await service.rpc(
      'approval_repoint_request_stage',
      {
        p_request_stage_id: row.id,
        p_pool: next,
        // A subject-head step is always "any one head" (createStage refuses
        // 'all' on it), so the rule is fixed here rather than read.
        p_rule: 'any',
      }
    );
    if (error) throw new Error(error.message);

    const result = (Array.isArray(data) ? data[0] : data) as {
      outcome: ApprovalRepointOutcome;
      decided_stage_order: number | null;
      next_stage_order: number | null;
    } | null;
    // The request closed, or the step was decided, while we waited for the
    // lock. Nothing was written.
    if (!result || result.outcome === 'skipped') continue;
    changed += 1;

    // ⚠ CLOSING IS ALL BUT UNREACHABLE HERE. The RPC closes an 'any' step
    // only if somebody still on it has already approved — and on an 'any'
    // step the first yes closes it at once. Should it happen (a step filed
    // 'all' before the refusal existed), the follow-up runs in this admin's
    // name exactly as `repointWaitingStages` does it; for a scheme of work
    // that handler arrives with the submit code, and until then
    // `runSubjectFollowUp` logs that it has none.
    if (result.outcome === 'advanced' || result.outcome === 'completed') {
      const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
      await runSubjectFollowUp({
        service,
        actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
        requestId: row.request_id,
        outcome: result.outcome,
        decidedStageOrder: result.decided_stage_order,
        nextStageOrder: result.next_stage_order,
        via: 'repoint',
      });
    }
  }
  return changed;
}

// ── The screen ──────────────────────────────────────────────────────────────

export type SubjectHeadsScreenRow = {
  subjectId: string;
  code: string;
  name: string;
  /** Which halves of the school offer this subject this year. */
  levelTypes: SubjectHeadLevelType[];
  heads: Array<{
    userId: string;
    appliesToLevelType: SubjectHeadLevelType | null;
  }>;
};

/**
 * One row per subject offered in this academic year — a subject with a
 * `subject_configs` row for it — with its heads.
 */
export async function loadSubjectHeadsScreen(
  service: SupabaseClient,
  academicYearId: string
): Promise<SubjectHeadsScreenRow[]> {
  // ⚠ `subject_configs` CARRIES NO LEVEL (one row per subject per year). Which
  // levels take a subject is `subject_level_offerings`; the halves are read
  // from there, with `levels` read on its own rather than embedded.
  const [
    { data: cfgData, error: cfgErr },
    { data: offerData, error: offerErr },
    { data: levelData, error: levelErr },
    heads,
  ] = await Promise.all([
    service
      .from('subject_configs')
      .select('subject_id, subjects!inner(id, code, name)')
      .eq('academic_year_id', academicYearId),
    service
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', academicYearId),
    service.from('levels').select('id, level_type'),
    listSubjectHeads(service),
  ]);
  if (cfgErr) throw new Error(cfgErr.message);
  if (offerErr) throw new Error(offerErr.message);
  if (levelErr) throw new Error(levelErr.message);
  const levelTypeById = new Map(
    ((levelData ?? []) as Array<{ id: string; level_type: string | null }>).map(
      (l) => [l.id, l.level_type]
    )
  );

  type SubjectEmbed = { id: string; code: string; name: string };
  const bySubject = new Map<string, SubjectHeadsScreenRow>();
  for (const row of (cfgData ?? []) as unknown as Array<{
    subject_id: string;
    subjects: SubjectEmbed | SubjectEmbed[] | null;
  }>) {
    const subject = Array.isArray(row.subjects)
      ? row.subjects[0]
      : row.subjects;
    if (!subject || bySubject.has(subject.id)) continue;
    bySubject.set(subject.id, {
      subjectId: subject.id,
      code: subject.code,
      name: subject.name,
      levelTypes: [],
      heads: [],
    });
  }

  for (const offer of (offerData ?? []) as Array<{
    subject_id: string;
    level_id: string;
  }>) {
    const entry = bySubject.get(offer.subject_id);
    const lt = levelTypeById.get(offer.level_id);
    if (
      entry &&
      (lt === 'primary' || lt === 'secondary') &&
      !entry.levelTypes.includes(lt)
    )
      entry.levelTypes.push(lt);
  }
  for (const entry of bySubject.values()) entry.levelTypes.sort();

  for (const head of heads) {
    bySubject.get(head.subjectId)?.heads.push({
      userId: head.userId,
      appliesToLevelType: head.appliesToLevelType,
    });
  }

  return [...bySubject.values()].sort((a, b) => a.name.localeCompare(b.name));
}

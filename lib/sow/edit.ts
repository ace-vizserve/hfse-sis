import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { normalizeRichText } from '@/lib/rich-text';
import type { SowModule, SowWeekFields } from '@/lib/schemas/sow';
import { type SowState, sowCapability } from '@/lib/sow/access';
import type { SowActor } from '@/lib/sow/create';
import { loadTermWeeks } from '@/lib/sow/weeks';

// Editing a scheme of work's module details and its weeks.
//
// Order of refusals, always: no such scheme (404) -> not yours (403) -> in
// review or approved (423) -> somebody saved first (409) -> bad input (400).
//
// The stale check is part of the UPDATE (`where updated_at = expected`), not a
// read followed by a write, so two saves that start together cannot both win.
// A module save checks the scheme's own timestamp and a week save checks that
// week's, and neither touches the other — two teachers on different weeks
// never collide.

export type EditResult =
  | { ok: true; updatedAt: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 423; error: string };

type Refusal = Extract<EditResult, { ok: false }>;

const refuse = (status: Refusal['status'], error: string): Refusal => ({
  ok: false,
  status,
  error,
});

export const LOCKED_MESSAGE =
  "It's in review, so it can't be edited. Ask to have it returned if something needs changing.";
const STALE_MESSAGE =
  'Someone else saved changes to this first. Reload to see them, then make your change again.';
const NOT_FOUND_MESSAGE = 'That scheme of work could not be found.';
// The week drawer keeps what was typed, so its message says which part moved
// (spec: two teachers saving the same week).
const STALE_WEEK_MESSAGE =
  'Someone else changed this week a moment ago — reload to see it.';
const NOT_YOURS_MESSAGE =
  'Only the teachers of this subject on its classes can edit this scheme of work.';

type SowHead = {
  id: string;
  subject_id: string;
  level_id: string;
  term_id: string;
  state: SowState;
  module: Record<string, unknown> | null;
};

/**
 * 404 / 403 / 423, in that order, or the scheme to work on. Sending a scheme
 * for review (lib/sow/approval.ts) asks the same question.
 */
export async function authorizeEdit(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string
): Promise<{ ok: true; sow: SowHead } | Refusal> {
  const { data, error } = await service
    .from('schemes_of_work')
    .select('id, subject_id, level_id, term_id, state, module')
    .eq('id', sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return refuse(404, NOT_FOUND_MESSAGE);
  const sow = data as SowHead;

  const { data: classes, error: classesError } = await service
    .from('scheme_of_work_classes')
    .select('section_id')
    .eq('sow_id', sowId);
  if (classesError) throw new Error(classesError.message);
  const classSectionIds = ((classes ?? []) as { section_id: string }[]).map(
    (c) => c.section_id
  );

  // "Is this person one of the scheme's teachers?" must not depend on its
  // state, or an in-review scheme would read as "not yours" instead of locked.
  // So ask with the state held at draft; the lock is checked on its own below.
  const assignments = await loadEffectiveAssignmentsForUser(service, actor.id);
  const asDraft = sowCapability({
    role: actor.role ?? 'teacher',
    userId: actor.id,
    assignments,
    sow: { subjectId: sow.subject_id, state: 'draft', classSectionIds },
    isOnCurrentApprovalStep: false,
  });
  if (asDraft !== 'edit') return refuse(403, NOT_YOURS_MESSAGE);

  if (sow.state === 'in_review' || sow.state === 'approved') {
    return refuse(423, LOCKED_MESSAGE);
  }
  return { ok: true, sow };
}

const WEEK_COLUMNS = {
  topic: 'topic',
  learningOutcomes: 'learning_outcomes',
  textbookPages: 'textbook_pages',
  activities: 'activities',
  assessment: 'assessment',
  remarks: 'remarks',
} as const;
const RICH_WEEK_FIELDS: ReadonlySet<keyof SowWeekFields> = new Set([
  'learningOutcomes',
  'activities',
  'remarks',
]);

export async function updateModule(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string,
  module: SowModule,
  expectedUpdatedAt: string
): Promise<EditResult> {
  const auth = await authorizeEdit(service, actor, sowId);
  if (!auth.ok) return auth;

  // Merge into what is stored; a null clears that detail.
  const merged: Record<string, unknown> = { ...(auth.sow.module ?? {}) };
  for (const [k, v] of Object.entries(module)) {
    if (v === null || v === undefined || v === '') delete merged[k];
    else merged[k] = v;
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await service
    .from('schemes_of_work')
    .update({ module: merged, updated_at: updatedAt })
    .eq('id', sowId)
    .eq('updated_at', expectedUpdatedAt)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return refuse(409, STALE_MESSAGE);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.edit',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: { target: 'module', fields: Object.keys(module) },
  });
  return { ok: true, updatedAt };
}

export async function updateWeek(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string,
  weekNumber: number,
  fields: SowWeekFields,
  expectedUpdatedAt: string
): Promise<EditResult> {
  const auth = await authorizeEdit(service, actor, sowId);
  if (!auth.ok) return auth;

  const { data: existing, error: existingError } = await service
    .from('scheme_of_work_weeks')
    .select('id')
    .eq('sow_id', sowId)
    .eq('week_number', weekNumber)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return refuse(404, 'That week could not be found.');

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields) as [
    keyof SowWeekFields,
    string | null | undefined,
  ][]) {
    if (value === undefined) continue;
    const cleaned = RICH_WEEK_FIELDS.has(key)
      ? normalizeRichText(value)
      : (value ?? '').trim();
    patch[WEEK_COLUMNS[key]] = cleaned === '' ? null : cleaned;
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await service
    .from('scheme_of_work_weeks')
    .update({ ...patch, updated_at: updatedAt })
    .eq('sow_id', sowId)
    .eq('week_number', weekNumber)
    .eq('updated_at', expectedUpdatedAt)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return refuse(409, STALE_WEEK_MESSAGE);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.edit',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: {
      target: 'week',
      week_number: weekNumber,
      fields: Object.keys(fields),
    },
  });
  return { ok: true, updatedAt };
}

/**
 * Delete a week the term no longer reaches (a "surplus" week: its number is
 * beyond the term's week count). A week the term has is cleared, never
 * deleted, so the plan always covers every teaching week.
 */
export async function deleteWeek(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string,
  weekNumber: number
): Promise<EditResult> {
  const auth = await authorizeEdit(service, actor, sowId);
  if (!auth.ok) return auth;

  const { data: existing, error: existingError } = await service
    .from('scheme_of_work_weeks')
    .select('id')
    .eq('sow_id', sowId)
    .eq('week_number', weekNumber)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return refuse(404, 'That week could not be found.');

  const { weeks } = await loadTermWeeks(
    service,
    auth.sow.term_id,
    auth.sow.level_id
  );
  const termWeekCount = weeks.filter((w) => w.kind === 'week').length;
  if (weekNumber <= termWeekCount) {
    return refuse(
      400,
      "Term weeks can't be deleted — clear its fields instead."
    );
  }

  const { error } = await service
    .from('scheme_of_work_weeks')
    .delete()
    .eq('sow_id', sowId)
    .eq('week_number', weekNumber);
  if (error) throw new Error(error.message);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.edit',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: {
      target: 'week',
      week_number: weekNumber,
      fields: [],
      deleted: true,
    },
  });
  return { ok: true, updatedAt: new Date().toISOString() };
}

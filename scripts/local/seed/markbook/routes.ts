// Mirrors of the markbook ROUTE HANDLERS the seeder cannot call directly —
// each gates on a cookie session (`requireRole` / `requireCapability`), so the
// handler body is reproduced here step for step, with the app's own lib
// helpers doing the work wherever the route uses one: the same reads, the same
// validation, the same writes, the same audit rows with the same context keys.
//
// Deliberate differences, each because the seeder must be deterministic:
//   * a lock's `locked_at` is an anchored timestamp the caller passes, not
//     `new Date()` (it lands in the `sheet.lock` audit context);
//   * a change request is inserted with a caller-chosen id (stable across
//     rebuilds — its first 8 characters are in the approval reference);
//   * after a write that carries scores, the derived columns (ww_ps …
//     quarterly_grade) are NOT also written by this code: the
//     `grade_entries_derive_trg` trigger computes them from the raw scores on
//     the same write (Hard Rule #2), so the seeder never writes a grade.
//
// Mail never goes out (harness/register.mjs empties RESEND_API_KEY, and the
// next/server stub drops `after()` callbacks).

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildApprovalReference,
  buildEntryPatch,
} from '@/app/api/grading-sheets/[id]/entries/[entryId]/route';
import { loadLevelTypesBySection } from '@/lib/approvals/level-types';
import {
  loadConfiguredLadder,
  openApprovalRequest,
} from '@/lib/approvals/materialise';
import {
  buildAuditRows,
  buildTotalsAuditRows,
  writeAuditRows,
} from '@/lib/audit/log-grade-change';
import {
  logAction,
  logActions,
  type AuditAction,
} from '@/lib/audit/log-action';
import {
  isSubjectTeacher,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadGradeChangeStepRecipients } from '@/lib/change-requests/approval-notify';
import {
  GRADE_CHANGE_SUBJECT_TYPE,
  resolveGradeChangeFlow,
} from '@/lib/change-requests/approval-route';
import {
  gradeChangeLadderProblem,
  summariseGradeChangeLadder,
} from '@/lib/change-requests/ladder-summary';
import {
  clearedScoresFor,
  recomputeSheetEntries,
  RecomputeWriteError,
  type ClearedScore,
} from '@/lib/grading/recompute-sheet';
import {
  isSubjectTermSplit,
  redistributeWeights,
  resolveSheetWeights,
  type GradeComponent,
} from '@/lib/grading/resolve-sheet-weights';
import {
  loadEntryStudentLabels,
  loadOneSheetAuditLabels,
} from '@/lib/grading/sheet-audit-labels';
import {
  diffSlotLabels,
  sanitizeLabel,
  sanitizeMeta,
} from '@/lib/grading/slot-label-sanitize';
import { OVERRIDE_LETTERS, isOverrideLetter } from '@/lib/compute/letter-grade';
import { proseLength } from '@/lib/rich-text';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  ChangeRequestFormSchema,
  type ChangeRequestFormInput,
  type CorrectionReason,
} from '@/lib/schemas/change-request';
import {
  slotMetaSatisfied,
  slotRosterScored,
  type SlotKind,
} from '@/lib/grading/first-score-gate';
import type { SlotLabels, SlotMeta } from '@/lib/schemas/grading-sheet';
import { SubjectTermWeightsSchema } from '@/lib/schemas/subject-config';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

export type Actor = { id: string; email: string; role: string };

const auditActor = (a: Actor) => ({ id: a.id, email: a.email, role: a.role });

function fail(where: string, message: string): never {
  throw new Error(`markbook: ${where}: ${message}`);
}

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// ── PATCH /api/grading-sheets/[id]/totals ────────────────────────────────

export type TotalsBody = {
  ww_totals?: number[];
  pt_totals?: number[];
  qa_total?: number | null;
  ww_weight?: number | null;
  pt_weight?: number | null;
  qa_weight?: number | null;
  correction_reason?: CorrectionReason;
  correction_justification?: string;
};

/**
 * The totals route: max scores (and optionally this sheet's own weights),
 * the recompute through lib/grading/recompute-sheet.ts, and the audit rows —
 * `totals.update` per changed slot before a lock, `grade_correction` plus
 * `grade_audit_log` copies after one (Path B only). Returns the number of
 * audit_log rows written.
 */
export async function totalsRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  body: TotalsBody
): Promise<number> {
  const { data: sheet, error: sheetErr } = await service
    .from('grading_sheets')
    .select(
      `id, ww_totals, pt_totals, qa_total, is_locked,
       ww_weight, pt_weight, qa_weight,
       subject_config:subject_configs(ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`
    )
    .eq('id', sheetId)
    .single();
  if (sheetErr || !sheet) fail('totals', `sheet ${sheetId} not found`);
  const config = one(
    sheet.subject_config as unknown as {
      ww_weight: number;
      pt_weight: number;
      qa_weight: number;
      ww_max_slots: number;
      pt_max_slots: number;
    }
  );
  if (!config) fail('totals', 'missing subject_config');

  let correction: { reason: CorrectionReason; justification: string } | null =
    null;
  let approval_reference = '';
  if (sheet.is_locked) {
    const reason = body.correction_reason;
    if (!reason || !(CORRECTION_REASONS as readonly string[]).includes(reason))
      fail(
        'totals',
        'post-lock totals edits require a valid correction_reason'
      );
    const justification = (body.correction_justification ?? '').trim();
    if (justification.length < 20)
      fail('totals', 'correction_justification must be at least 20 characters');
    correction = { reason, justification };
    approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[reason]}`;
  }

  const before = {
    ww_totals: ((sheet.ww_totals ?? []) as number[]).map(Number),
    pt_totals: ((sheet.pt_totals ?? []) as number[]).map(Number),
    qa_total: sheet.qa_total == null ? null : Number(sheet.qa_total),
  };
  const after = {
    ww_totals: body.ww_totals ?? before.ww_totals,
    pt_totals: body.pt_totals ?? before.pt_totals,
    qa_total: 'qa_total' in body ? (body.qa_total ?? null) : before.qa_total,
  };
  if (after.ww_totals.length > config.ww_max_slots)
    fail('totals', `too many WW slots (max ${config.ww_max_slots})`);
  if (after.pt_totals.length > config.pt_max_slots)
    fail('totals', `too many PT slots (max ${config.pt_max_slots})`);
  if ([...after.ww_totals, ...after.pt_totals].some((v) => !(v > 0)))
    fail('totals', 'totals must be positive numbers');

  const weightKeys = ['ww_weight', 'pt_weight', 'qa_weight'] as const;
  let weightPatch: Record<string, number | null> | null = null;
  if (weightKeys.some((k) => k in body)) {
    const given = weightKeys.map((k) => body[k]);
    if (given.every((v) => v === null)) {
      weightPatch = { ww_weight: null, pt_weight: null, qa_weight: null };
    } else {
      const pcts = given as number[];
      if (
        pcts.some((v) => typeof v !== 'number' || !Number.isInteger(v)) ||
        pcts.reduce((a, b) => a + b, 0) !== 100
      )
        fail('totals', 'weights must be whole numbers adding up to 100');
      if (
        !isSubjectTermSplit(config, { ww: pcts[0], pt: pcts[1], qa: pcts[2] })
      )
        fail('totals', "a term may only switch the subject's components off");
      weightPatch = {
        ww_weight: pcts[0] / 100,
        pt_weight: pcts[1] / 100,
        qa_weight: pcts[2] / 100,
      };
    }
  }

  // ⚠ SEEDER-ONLY GUARD, BEFORE ANY WRITE. The real route lets a slot removal
  // clear marks (and audits each one, below). The seeder never means to: it
  // shapes sheets nobody has scored, or raises a max. So the marks a removal
  // would cut off are counted first — `clearedScoresFor` is the recompute's
  // own test — and the call refused while nothing has been written.
  const { data: scoredRows, error: scoredErr } = await service
    .from('grade_entries')
    .select('id, ww_scores, pt_scores')
    .eq('grading_sheet_id', sheetId);
  if (scoredErr) fail('totals', scoredErr.message);
  const wouldClear = (
    (scoredRows ?? []) as Array<{
      id: string;
      ww_scores: (number | null)[] | null;
      pt_scores: (number | null)[] | null;
    }>
  ).flatMap((e) => clearedScoresFor(e, after));
  if (wouldClear.length > 0) {
    fail(
      'totals',
      `a slot removal would clear ${wouldClear.length} real mark(s) — refused before writing`
    );
  }

  const { error: upErr } = await service
    .from('grading_sheets')
    .update({
      ww_totals: after.ww_totals,
      pt_totals: after.pt_totals,
      qa_total: after.qa_total,
      ...(weightPatch ?? {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheetId);
  if (upErr) fail('totals', upErr.message);

  // As the route: a failed recompute does not skip the audit — the totals are
  // saved, so they are logged with `partial: true` before the failure is
  // answered.
  let recompute: Awaited<ReturnType<typeof recomputeSheetEntries>> | null =
    null;
  let recomputeError: string | null = null;
  let clearedScores: ClearedScore[] = [];
  try {
    recompute = await recomputeSheetEntries(
      service,
      sheetId,
      after,
      resolveSheetWeights(weightPatch ?? sheet, config)
    );
    clearedScores = recompute.clearedScores;
  } catch (err) {
    recomputeError = err instanceof Error ? err.message : 'recompute failed';
    if (err instanceof RecomputeWriteError) clearedScores = err.clearedScores;
  }

  const action: AuditAction = sheet.is_locked
    ? 'grade_correction'
    : 'totals.update';
  const sheetLabels = await loadOneSheetAuditLabels(service, sheetId);
  const lockContext = {
    was_locked: sheet.is_locked,
    ...(sheet.is_locked ? { approval_reference } : {}),
    ...(correction
      ? {
          correction_reason: correction.reason,
          correction_justification: correction.justification,
        }
      : {}),
  };
  const partialContext = recomputeError
    ? { partial: true, failed_step: 'recompute', error: recomputeError }
    : {};
  const anchor = recompute?.anchorEntryId ?? null;
  const totalsDiff = buildTotalsAuditRows(before, after, {
    grading_sheet_id: sheetId,
    grade_entry_id: anchor ?? '',
    changed_by: actor.email,
    approval_reference,
  });
  let rows = 0;
  if (totalsDiff.length > 0) {
    let gradeAuditLogFailed = false;
    if (sheet.is_locked && anchor) {
      gradeAuditLogFailed = !(await writeAuditRows(service, totalsDiff));
    }
    for (const row of totalsDiff) {
      await logAction({
        service,
        actor: auditActor(actor),
        action,
        entityType: 'grading_sheet',
        entityId: sheetId,
        context: {
          ...sheetLabels,
          field: row.field_changed,
          old: row.old_value,
          new: row.new_value,
          ...lockContext,
          ...partialContext,
          ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
        },
      });
      rows++;
    }
  }
  if (weightPatch) {
    const pct = (v: number | string | null) =>
      v == null ? null : Math.round(Number(v) * 100);
    await logAction({
      service,
      actor: auditActor(actor),
      action,
      entityType: 'grading_sheet',
      entityId: sheetId,
      context: {
        ...sheetLabels,
        field: 'weights',
        old: {
          ww: pct(sheet.ww_weight),
          pt: pct(sheet.pt_weight),
          qa: pct(sheet.qa_weight),
        },
        new: {
          ww: pct(weightPatch.ww_weight),
          pt: pct(weightPatch.pt_weight),
          qa: pct(weightPatch.qa_weight),
        },
        scope: 'this class only',
        ...lockContext,
        ...partialContext,
      },
    });
    rows++;
  }

  // Marks cleared by removing a slot — refused above, so this only runs if a
  // mark landed between that read and the recompute. Written as the route
  // writes them: one row per mark, `cleared_by_slot_removal`, and a
  // grade_audit_log copy after a lock.
  if (clearedScores.length > 0) {
    const students = await loadEntryStudentLabels(
      service,
      clearedScores.map((c) => c.entryId)
    );
    const perMark = clearedScores.map((c) => ({
      entryId: c.entryId,
      field: `${c.component === 'ww' ? 'ww_scores' : 'pt_scores'}[${c.slotIndex}]`,
      old: String(c.oldValue),
    }));
    let gradeAuditLogFailed = false;
    if (sheet.is_locked) {
      gradeAuditLogFailed = !(await writeAuditRows(
        service,
        perMark.map((m) => ({
          grading_sheet_id: sheetId,
          grade_entry_id: m.entryId,
          changed_by: actor.email,
          field_changed: m.field,
          old_value: m.old,
          new_value: null,
          approval_reference,
        }))
      ));
    }
    await logActions(
      service,
      auditActor(actor),
      perMark.map((m) => ({
        action: (sheet.is_locked
          ? 'grade_correction'
          : 'entry.update') as AuditAction,
        entityType: 'grade_entry' as const,
        entityId: m.entryId,
        context: {
          grading_sheet_id: sheetId,
          grade_entry_id: m.entryId,
          ...sheetLabels,
          ...(students.get(m.entryId) ?? {}),
          field: m.field,
          old: m.old,
          new: null,
          cleared_by_slot_removal: true,
          ...lockContext,
          ...partialContext,
          ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
        },
      }))
    );
    rows += perMark.length;
  }
  invalidateDrillTags('markbook', 'AY2026');
  if (recomputeError)
    fail('totals', `saved, but the recompute failed: ${recomputeError}`);
  if (clearedScores.length > 0)
    fail(
      'totals',
      `${clearedScores.length} mark(s) were cleared (audited) — the seeder never intends that`
    );
  return rows;
}

// ── PATCH /api/sis/admin/subjects/[configId]/term-weights ────────────────

/**
 * The term-weights route: one subject × one term, every UNLOCKED sheet,
 * weights from `redistributeWeights` (components only, never typed figures),
 * a recompute, and one `subject_config.term_weights` audit row. Returns the
 * number of sheets updated.
 */
export async function termWeightsRoute(
  service: SupabaseClient,
  actor: Actor,
  configId: string,
  input: { term_id: string; components: Record<GradeComponent, boolean> }
): Promise<number> {
  const parsed = SubjectTermWeightsSchema.safeParse(input);
  if (!parsed.success) fail('term-weights', 'invalid payload');

  const { data: config } = await service
    .from('subject_configs')
    .select(
      'id, subject_id, academic_year_id, ww_weight, pt_weight, qa_weight, display_name, subject:subjects(code, name)'
    )
    .eq('id', configId)
    .maybeSingle();
  if (!config) fail('term-weights', `config ${configId} not found`);
  const { data: term } = await service
    .from('terms')
    .select('id, term_number, label, academic_year_id')
    .eq('id', input.term_id)
    .maybeSingle();
  if (!term || term.academic_year_id !== config.academic_year_id)
    fail('term-weights', 'term not in the config’s year');

  const configWeights = {
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  };
  const next = redistributeWeights(configWeights, input.components);

  const { data: sheetRows, error: sheetErr } = await service
    .from('grading_sheets')
    .select(
      'id, is_locked, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight, section:sections(name)'
    )
    .eq('term_id', input.term_id)
    .eq('subject_id', config.subject_id);
  if (sheetErr) fail('term-weights', sheetErr.message);
  type SheetRow = {
    id: string;
    is_locked: boolean;
    ww_totals: number[] | null;
    pt_totals: number[] | null;
    qa_total: number | null;
    ww_weight: number | string | null;
    pt_weight: number | string | null;
    qa_weight: number | string | null;
    section: { name: string } | { name: string }[] | null;
  };
  const sheets = (sheetRows ?? []) as unknown as SheetRow[];
  const sectionName = (s: SheetRow) => one(s.section)?.name ?? 'Unknown class';
  const open = sheets.filter((s) => !s.is_locked);
  const lockedNames = sheets
    .filter((s) => s.is_locked)
    .map(sectionName)
    .sort();
  if (open.length === 0) return 0;

  const { error: updateErr } = await service
    .from('grading_sheets')
    .update({
      ww_weight: next.ww_weight,
      pt_weight: next.pt_weight,
      qa_weight: next.qa_weight,
      updated_at: new Date().toISOString(),
    })
    .in(
      'id',
      open.map((s) => s.id)
    );
  if (updateErr) fail('term-weights', updateErr.message);

  let entriesRecomputed = 0;
  for (const s of open) {
    const r = await recomputeSheetEntries(
      service,
      s.id,
      {
        ww_totals: (s.ww_totals ?? []).map(Number),
        pt_totals: (s.pt_totals ?? []).map(Number),
        qa_total: s.qa_total == null ? null : Number(s.qa_total),
      },
      next
    );
    entriesRecomputed += r.entriesWritten;
  }

  const subject = one(
    config.subject as unknown as { code: string; name: string | null }
  );
  const pct = (v: number | string | null) =>
    v == null ? null : Math.round(Number(v) * 100);
  await logAction({
    service,
    actor: auditActor(actor),
    action: 'subject_config.term_weights',
    entityType: 'subject_config',
    entityId: configId,
    context: {
      subject_code: subject?.code ?? null,
      subject_name: subject
        ? subjectDisplayName(
            { name: subject.name ?? '' },
            { display_name: config.display_name }
          ) || null
        : null,
      term_number: term.term_number,
      term_label: term.label ?? null,
      term_id: term.id,
      academic_year_id: config.academic_year_id,
      // In the order the sheet read returned them, as the route logs them.
      before: open.map((s) => {
        const own =
          s.ww_weight != null && s.pt_weight != null && s.qa_weight != null;
        const w = resolveSheetWeights(s, configWeights);
        return {
          grading_sheet_id: s.id,
          section: sectionName(s),
          follows_subject: !own,
          ww: pct(w.ww_weight),
          pt: pct(w.pt_weight),
          qa: pct(w.qa_weight),
        };
      }),
      after: {
        follows_subject: false,
        ww: pct(next.ww_weight),
        pt: pct(next.pt_weight),
        qa: pct(next.qa_weight),
      },
      sheets_updated: open.length,
      entries_recomputed: entriesRecomputed,
      locked_classes_skipped: lockedNames,
    },
  });
  invalidateDrillTags('markbook', 'AY2026');
  return open.length;
}

// ── POST /api/grading-sheets/[id]/lock and /unlock ───────────────────────

/** The single-sheet lock route. `lockedAt` is anchored (see the header). */
export async function lockRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  lockedAt: string
): Promise<boolean> {
  const { data: existing } = await service
    .from('grading_sheets')
    .select('is_locked')
    .eq('id', sheetId)
    .maybeSingle();
  if (!existing) fail('lock', `sheet ${sheetId} not found`);
  if (existing.is_locked) return false;
  const { data, error } = await service
    .from('grading_sheets')
    .update({
      is_locked: true,
      locked_at: lockedAt,
      locked_by: actor.email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheetId)
    .select('id, is_locked, locked_at, locked_by')
    .single();
  if (error || !data) fail('lock', error?.message ?? 'lock failed');
  await logAction({
    service,
    actor: auditActor(actor),
    action: 'sheet.lock',
    entityType: 'grading_sheet',
    entityId: sheetId,
    context: {
      ...(await loadOneSheetAuditLabels(service, sheetId)),
      locked_at: data.locked_at,
      locked_by: data.locked_by,
    },
  });
  invalidateDrillTags('markbook', 'AY2026');
  return true;
}

/** The unlock route (no deadline set, no pending requests: plain unlock). */
export async function unlockRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string
): Promise<boolean> {
  const { data: row } = await service
    .from('grading_sheets')
    .select(
      'is_locked, locked_at, locked_by, term:terms(grading_lock_date, label)'
    )
    .eq('id', sheetId)
    .maybeSingle();
  if (!row) fail('unlock', `sheet ${sheetId} not found`);
  if (!row.is_locked) return false;
  const term = one(
    row.term as unknown as { grading_lock_date: string | null } | null
  );
  if (term?.grading_lock_date)
    fail(
      'unlock',
      'the term has a grading deadline — the seeder does not force'
    );
  const { count } = await service
    .from('grade_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('grading_sheet_id', sheetId)
    .eq('status', 'pending');
  if ((count ?? 0) > 0) fail('unlock', 'pending change requests on the sheet');
  const { error } = await service
    .from('grading_sheets')
    .update({
      is_locked: false,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheetId);
  if (error) fail('unlock', error.message);
  await logAction({
    service,
    actor: auditActor(actor),
    action: 'sheet.unlock',
    entityType: 'grading_sheet',
    entityId: sheetId,
    context: {
      ...(await loadOneSheetAuditLabels(service, sheetId)),
      previously_locked_at: row.locked_at ?? null,
      previously_locked_by: row.locked_by ?? null,
    },
  });
  invalidateDrillTags('markbook', 'AY2026');
  return true;
}

// ── PATCH /api/grading-sheets/[id]/labels ────────────────────────────────

/** The labels route, as the sheet's subject teacher (teacher gates kept). */
export async function labelsRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  body: {
    ww?: (SlotMeta | null)[];
    pt?: (SlotMeta | null)[];
    qa?: string | null;
  }
): Promise<boolean> {
  const { data: sheet } = await service
    .from('grading_sheets')
    .select('id, is_locked, section_id, subject_id, slot_labels')
    .eq('id', sheetId)
    .single();
  if (!sheet) fail('labels', `sheet ${sheetId} not found`);
  if (actor.role === 'teacher') {
    const assignments = await loadEffectiveAssignmentsForUser(
      service,
      actor.id
    );
    if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id))
      fail('labels', `${actor.email} is not assigned to this sheet`);
    if (sheet.is_locked) fail('labels', 'sheet is locked');
  }
  const newLabels: Record<string, unknown> = {};
  if ('ww' in body) newLabels.ww = (body.ww ?? []).map(sanitizeMeta);
  if ('pt' in body) newLabels.pt = (body.pt ?? []).map(sanitizeMeta);
  if ('qa' in body) newLabels.qa = sanitizeLabel(body.qa);
  const existing = (sheet.slot_labels as Record<string, unknown> | null) ?? {};
  const merged = { ...existing, ...newLabels };
  const { error } = await service
    .from('grading_sheets')
    .update({ slot_labels: merged })
    .eq('id', sheetId);
  if (error) fail('labels', error.message);
  const changes = diffSlotLabels(existing, newLabels);
  if (changes.length > 0) {
    await logAction({
      service,
      actor: auditActor(actor),
      action: 'sheet.labels.update',
      entityType: 'grading_sheet',
      entityId: sheetId,
      context: {
        ...(await loadOneSheetAuditLabels(service, sheetId)),
        changes,
      },
    });
  }
  return changes.length > 0;
}

// ── PATCH /api/grading-sheets/[id]/entries/[entryId] ─────────────────────

type EntryRow = {
  id: string;
  grading_sheet_id: string;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  letter_grade: string | null;
  is_na: boolean;
  ww_excused: number[];
  pt_excused: number[];
};

async function readSheetAndEntry(
  service: SupabaseClient,
  sheetId: string,
  entryId: string
) {
  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        'id, section_id, subject_id, ww_totals, pt_totals, qa_total, is_locked'
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select(
        'id, grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na, ww_excused, pt_excused'
      )
      .eq('id', entryId)
      .single(),
  ]);
  if (!sheetRes.data) fail('entries', `sheet ${sheetId} not found`);
  if (!entryRes.data) fail('entries', `entry ${entryId} not found`);
  const entry = entryRes.data as unknown as EntryRow;
  if (entry.grading_sheet_id !== sheetId)
    fail('entries', 'entry does not belong to sheet');
  const sheet = sheetRes.data as {
    id: string;
    section_id: string;
    subject_id: string;
    ww_totals: number[];
    pt_totals: number[];
    qa_total: number | null;
    is_locked: boolean;
  };
  const num = (a: (number | string | null)[] | null) =>
    (a ?? []).map((v) => (v == null ? null : Number(v)));
  entry.ww_scores = num(entry.ww_scores);
  entry.pt_scores = num(entry.pt_scores);
  entry.qa_score = entry.qa_score == null ? null : Number(entry.qa_score);
  return {
    sheet: {
      ...sheet,
      ww_totals: sheet.ww_totals.map(Number),
      pt_totals: sheet.pt_totals.map(Number),
      qa_total: sheet.qa_total == null ? null : Number(sheet.qa_total),
    },
    entry,
  };
}

function validateScores(
  sheet: { ww_totals: number[]; pt_totals: number[]; qa_total: number | null },
  ww: (number | null)[],
  pt: (number | null)[],
  qa: number | null
) {
  ww.forEach((v, i) => {
    if (v != null && (v < 0 || v > sheet.ww_totals[i]))
      fail('entries', `W${i + 1} score ${v} out of range`);
  });
  pt.forEach((v, i) => {
    if (v != null && (v < 0 || v > sheet.pt_totals[i]))
      fail('entries', `PT${i + 1} score ${v} out of range`);
  });
  if (qa != null && sheet.qa_total != null && (qa < 0 || qa > sheet.qa_total))
    fail('entries', `QA score ${qa} out of range`);
}

/**
 * Path B — a registrar's post-lock data-entry correction: raw scores
 * written, `grade_audit_log` rows with the server-derived approval reference
 * (Hard Rule #5), one `grade_correction` audit_log row per changed field.
 * Returns the number of grade_audit_log rows.
 */
export async function correctEntryRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  entryId: string,
  body: {
    ww_scores?: (number | null)[];
    pt_scores?: (number | null)[];
    qa_score?: number | null;
    correction_reason: CorrectionReason;
    correction_justification: string;
  }
): Promise<number> {
  const { sheet, entry } = await readSheetAndEntry(service, sheetId, entryId);
  if (!sheet.is_locked) fail('entries', 'Path B is for locked sheets');
  if (
    !(CORRECTION_REASONS as readonly string[]).includes(body.correction_reason)
  )
    fail('entries', 'invalid correction_reason');
  const justification = body.correction_justification.trim();
  if (proseLength(justification) < 20)
    fail('entries', 'correction_justification must be at least 20 characters');
  const approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[body.correction_reason]}`;

  const norm = (arr: (number | null)[], n: number) =>
    Array.from({ length: n }, (_, i) => arr[i] ?? null);
  const ww_scores = norm(
    body.ww_scores ?? entry.ww_scores,
    sheet.ww_totals.length
  );
  const pt_scores = norm(
    body.pt_scores ?? entry.pt_scores,
    sheet.pt_totals.length
  );
  const qa_score =
    'qa_score' in body ? (body.qa_score ?? null) : entry.qa_score;
  validateScores(sheet, ww_scores, pt_scores, qa_score);

  const { error } = await service
    .from('grade_entries')
    .update({
      ww_scores,
      pt_scores,
      qa_score,
      is_na: entry.is_na,
      letter_grade: entry.letter_grade,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId);
  if (error) fail('entries', error.message);

  const diffRows = buildAuditRows(
    entry,
    {
      ww_scores,
      pt_scores,
      qa_score,
      letter_grade: entry.letter_grade,
      is_na: entry.is_na,
    },
    {
      grading_sheet_id: sheetId,
      grade_entry_id: entryId,
      changed_by: actor.email,
      approval_reference,
    }
  );
  if (diffRows.length === 0) return 0;
  const whoAndWhere = {
    ...(await loadOneSheetAuditLabels(service, sheetId)),
    ...((await loadEntryStudentLabels(service, [entryId])).get(entryId) ?? {}),
  };
  const gradeAuditLogFailed = !(await writeAuditRows(service, diffRows));
  for (const row of diffRows) {
    await logAction({
      service,
      actor: auditActor(actor),
      action: 'grade_correction',
      entityType: 'grade_entry',
      entityId: entryId,
      context: {
        grading_sheet_id: sheetId,
        grade_entry_id: entryId,
        ...whoAndWhere,
        field: row.field_changed,
        old: row.old_value,
        new: row.new_value,
        was_locked: true,
        approval_reference,
        correction_reason: body.correction_reason,
        correction_justification: justification,
        ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
      },
    });
  }
  invalidateDrillTags('markbook', 'AY2026');
  return diffRows.length;
}

// ── PATCH /api/grading-sheets/[id]/entries/[entryId] — direct path ───────

export type DirectScoreWrite = {
  entryId: string;
  ww_scores?: (number | null)[];
  pt_scores?: (number | null)[];
  qa_score?: number | null;
};

type DiffRows = ReturnType<typeof buildAuditRows>;

/**
 * The entries route's DIRECT path (an unlocked sheet, no approval reference):
 * a subject teacher typing scores in. One call stands in for one PATCH per
 * child, taken in the order given, with the route's steps per PATCH — the
 * subject-teacher gate, merge + normalise to the sheet's slots, the excused
 * and max-score checks, the first-score label gate (422 `label_required` when
 * a slot nobody has scored yet has no description + date; QA a description),
 * and one `entry.update` audit row per changed field (`ww_scores[0]` …).
 *
 * Batched, deliberately: the sheet, its roster and the audit labels are read
 * once rather than once per PATCH, the gate runs against the roster as each
 * earlier PATCH left it (in memory), and the raw scores go in as ONE upsert —
 * a single statement, so a sheet is either scored or not, never half. The
 * derived columns are left to the derive trigger (see the header). Returns
 * the entries written and the audit rows logged.
 */
export async function enterScoresRoute(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  writes: DirectScoreWrite[]
): Promise<{ entries: number; auditRows: number }> {
  const { data: sheetRow } = await service
    .from('grading_sheets')
    .select(
      'id, section_id, subject_id, ww_totals, pt_totals, qa_total, is_locked, slot_labels'
    )
    .eq('id', sheetId)
    .single();
  if (!sheetRow) fail('entries', `sheet ${sheetId} not found`);
  const sheet = {
    ...(sheetRow as {
      id: string;
      section_id: string;
      subject_id: string;
      is_locked: boolean;
      slot_labels: SlotLabels | null;
    }),
    ww_totals: ((sheetRow.ww_totals ?? []) as number[]).map(Number),
    pt_totals: ((sheetRow.pt_totals ?? []) as number[]).map(Number),
    qa_total: sheetRow.qa_total == null ? null : Number(sheetRow.qa_total),
  };
  if (actor.role === 'teacher') {
    const assignments = await loadEffectiveAssignmentsForUser(
      service,
      actor.id
    );
    if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id))
      fail('entries', `${actor.email} is not assigned to this sheet (403)`);
  }
  if (sheet.is_locked)
    fail('entries', 'sheet is locked — the direct path is for unlocked sheets');

  const { data: rosterRaw, error: rosterErr } = await service
    .from('grade_entries')
    .select(
      'id, grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, letter_grade, is_na, ww_excused, pt_excused'
    )
    .eq('grading_sheet_id', sheetId);
  if (rosterErr) fail('entries', rosterErr.message);
  const num = (a: (number | string | null)[] | null) =>
    (a ?? []).map((v) => (v == null ? null : Number(v)));
  const state = new Map(
    ((rosterRaw ?? []) as Array<EntryRow & { section_student_id: string }>).map(
      (r) => [
        r.id,
        {
          ...r,
          ww_scores: num(r.ww_scores),
          pt_scores: num(r.pt_scores),
          qa_score: r.qa_score == null ? null : Number(r.qa_score),
        },
      ]
    )
  );
  const labels = (sheet.slot_labels ?? {}) as SlotLabels;

  const upserts: Record<string, unknown>[] = [];
  const audits: Array<{ entryId: string; rows: DiffRows }> = [];
  const now = new Date().toISOString();
  for (const w of writes) {
    const entry = state.get(w.entryId);
    if (!entry) fail('entries', `entry ${w.entryId} not on sheet ${sheetId}`);

    const normalize = (arr: (number | null)[], length: number) =>
      Array.from({ length }, (_, i) => arr[i] ?? null);
    const ww_scores = normalize(
      w.ww_scores ?? entry.ww_scores,
      sheet.ww_totals.length
    );
    const pt_scores = normalize(
      w.pt_scores ?? entry.pt_scores,
      sheet.pt_totals.length
    );
    const qa_score = 'qa_score' in w ? (w.qa_score ?? null) : entry.qa_score;
    const wwEx = entry.ww_excused ?? [];
    const ptEx = entry.pt_excused ?? [];
    if (
      ww_scores.some((v, i) => v != null && wwEx.includes(i + 1)) ||
      pt_scores.some((v, i) => v != null && ptEx.includes(i + 1))
    )
      fail('entries', 'a score on a slot excused for this student (400)');
    validateScores(sheet, ww_scores, pt_scores, qa_score);

    // The first-score label gate, against the roster as it stands now.
    const others = [...state.values()].filter((r) => r.id !== entry.id);
    const violations: string[] = [];
    const checkSlot = (
      kind: SlotKind,
      idx: number | null,
      newVal: number | null,
      prevVal: number | null,
      meta: unknown
    ) => {
      if (newVal == null || prevVal != null) return;
      if (slotRosterScored(kind, idx, others)) return;
      if (slotMetaSatisfied(kind, meta as SlotMeta | string | null)) return;
      violations.push(
        kind === 'qa' ? 'QA' : `${kind.toUpperCase()}${(idx as number) + 1}`
      );
    };
    ww_scores.forEach((v, i) =>
      checkSlot('ww', i, v, entry.ww_scores[i] ?? null, labels.ww?.[i])
    );
    pt_scores.forEach((v, i) =>
      checkSlot('pt', i, v, entry.pt_scores[i] ?? null, labels.pt?.[i])
    );
    checkSlot('qa', null, qa_score, entry.qa_score, labels.qa);
    if (violations.length > 0)
      fail(
        'entries',
        `422 label_required: add a description before the first score for ${violations.join(', ')}`
      );

    const rows = buildAuditRows(
      entry,
      {
        ww_scores,
        pt_scores,
        qa_score,
        letter_grade: entry.letter_grade,
        is_na: entry.is_na,
      },
      {
        grading_sheet_id: sheetId,
        grade_entry_id: entry.id,
        changed_by: actor.email,
        approval_reference: '',
      }
    );
    upserts.push({
      id: entry.id,
      grading_sheet_id: sheetId,
      section_student_id: entry.section_student_id,
      ww_scores,
      pt_scores,
      qa_score,
      is_na: entry.is_na,
      letter_grade: entry.letter_grade,
      updated_at: now,
    });
    if (rows.length > 0) audits.push({ entryId: entry.id, rows });
    state.set(entry.id, { ...entry, ww_scores, pt_scores, qa_score });
  }
  if (upserts.length === 0) return { entries: 0, auditRows: 0 };

  const { error } = await service
    .from('grade_entries')
    .upsert(upserts, { onConflict: 'id' });
  if (error) fail('entries', error.message);

  const auditRows = await logEntryUpdateAudit(service, actor, sheetId, audits);
  invalidateDrillTags('markbook', 'AY2026');
  return { entries: upserts.length, auditRows };
}

/**
 * The direct path's audit rows: one `entry.update` per changed field, with the
 * route's context (sheet + child labels, field, old, new, was_locked false).
 * Also used to write the rows a failed earlier run left out (its scores saved,
 * its audit not), from the blank entry to what is stored. Returns rows logged.
 */
export async function logEntryUpdateAudit(
  service: SupabaseClient,
  actor: Actor,
  sheetId: string,
  items: Array<{ entryId: string; rows: DiffRows }>
): Promise<number> {
  const all = items.flatMap((x) => x.rows);
  if (all.length === 0) return 0;
  const sheetLabels = await loadOneSheetAuditLabels(service, sheetId);
  const students = await loadEntryStudentLabels(
    service,
    items.map((x) => x.entryId)
  );
  await logActions(
    service,
    auditActor(actor),
    all.map((row) => ({
      action: 'entry.update' as const,
      entityType: 'grade_entry' as const,
      entityId: row.grade_entry_id,
      context: {
        grading_sheet_id: sheetId,
        grade_entry_id: row.grade_entry_id,
        ...sheetLabels,
        ...(students.get(row.grade_entry_id) ?? {}),
        field: row.field_changed,
        old: row.old_value,
        new: row.new_value,
        was_locked: false,
      },
    }))
  );
  return all.length;
}

// ── POST /api/change-requests (filing) ───────────────────────────────────

/**
 * The filing route, as the sheet's subject teacher: schema, locked-sheet and
 * assignment gates, the current-value snapshot, the approval ladder chosen by
 * the app's own `resolveGradeChangeFlow`, `openApprovalRequest`, and the
 * `grade_change_requested` audit row. `id` is fixed by the caller.
 */
export async function fileChangeRequestRoute(
  service: SupabaseClient,
  teacher: Actor,
  id: string,
  form: ChangeRequestFormInput
): Promise<void> {
  const parsed = ChangeRequestFormSchema.safeParse(form);
  if (!parsed.success)
    fail('change-requests', parsed.error.issues[0]?.message ?? 'invalid body');
  const body = parsed.data;
  if (
    body.field_changed === 'letter_grade' &&
    !isOverrideLetter(body.proposed_value.trim())
  )
    fail(
      'change-requests',
      `a letter grade proposal must be one of ${OVERRIDE_LETTERS.join(', ')}`
    );
  const { sheet, entry } = await readSheetAndEntry(
    service,
    body.grading_sheet_id,
    body.grade_entry_id
  );
  if (!sheet.is_locked) fail('change-requests', 'sheet is not locked');
  const assignments = await loadEffectiveAssignmentsForUser(
    service,
    teacher.id
  );
  if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id))
    fail('change-requests', `${teacher.email} is not assigned to this sheet`);

  // The route's `snapshotCurrentValue`, every field.
  const slotValue = (arr: (number | null)[]) => {
    const v = arr[body.slot_index ?? -1];
    return v == null ? null : String(v);
  };
  const currentValue: string | null =
    body.field_changed === 'ww_scores'
      ? slotValue(entry.ww_scores)
      : body.field_changed === 'pt_scores'
        ? slotValue(entry.pt_scores)
        : body.field_changed === 'qa_score'
          ? entry.qa_score == null
            ? null
            : String(entry.qa_score)
          : body.field_changed === 'letter_grade'
            ? entry.letter_grade
            : entry.is_na
              ? 'true'
              : 'false';
  // The route's `canonicallyEqual` (422 on a no-op request).
  const f = body.field_changed;
  const same =
    f === 'ww_scores' || f === 'pt_scores' || f === 'qa_score'
      ? (() => {
          const p = body.proposed_value.trim();
          if (p === '' && currentValue == null) return true;
          if (p === '' || currentValue == null) return false;
          return Number(p) === Number(currentValue);
        })()
      : f === 'is_na'
        ? (body.proposed_value === 'true') === (currentValue === 'true')
        : body.proposed_value === currentValue;
  if (same) fail('change-requests', 'proposed value equals current');

  // The route's slot_index ceiling guard (422): the subject's max slots, from
  // the config of the section's year.
  if (f === 'ww_scores' || f === 'pt_scores') {
    const { data: sectionRow } = await service
      .from('sections')
      .select('id, level_id, academic_year_id')
      .eq('id', sheet.section_id)
      .maybeSingle();
    if (!sectionRow)
      fail('change-requests', 'could not resolve the section for this sheet');
    const { data: configRow } = await service
      .from('subject_configs')
      .select('ww_max_slots, pt_max_slots')
      .eq('academic_year_id', sectionRow.academic_year_id)
      .eq('subject_id', sheet.subject_id)
      .maybeSingle();
    if (configRow) {
      const max =
        f === 'ww_scores'
          ? Number(configRow.ww_max_slots ?? 5)
          : Number(configRow.pt_max_slots ?? 5);
      if (body.slot_index != null && body.slot_index >= max)
        fail(
          'change-requests',
          `slot ${body.slot_index + 1} doesn't exist for this subject (max ${max})`
        );
    }
  }

  const flow = await resolveGradeChangeFlow(service, {
    gradeEntryId: entry.id,
    gradingSheetId: sheet.id,
  });
  const levelType =
    (await loadLevelTypesBySection(service, [sheet.section_id])).get(
      sheet.section_id
    ) ?? null;
  const ladder = await loadConfiguredLadder(service, flow);
  const problem = gradeChangeLadderProblem(
    summariseGradeChangeLadder(ladder, levelType, new Map(), {
      filerId: teacher.id,
    })
  );
  if (problem) fail('change-requests', problem);

  const { data: inserted, error } = await service
    .from('grade_change_requests')
    .insert({
      id,
      grading_sheet_id: body.grading_sheet_id,
      grade_entry_id: body.grade_entry_id,
      field_changed: body.field_changed,
      slot_index: body.slot_index,
      current_value: currentValue,
      proposed_value: body.proposed_value,
      reason_category: body.reason_category,
      justification: body.justification,
      status: 'pending',
      requested_by: teacher.id,
      requested_by_email: teacher.email,
      approval_flow: flow,
    })
    .select('*')
    .single();
  if (error || !inserted)
    fail('change-requests', error?.message ?? 'insert failed');

  const opened = await openApprovalRequest(service, {
    flow,
    subjectType: GRADE_CHANGE_SUBJECT_TYPE,
    subjectId: inserted.id,
    sectionId: sheet.section_id,
    levelType,
    filedBy: teacher.id,
    filedByEmail: teacher.email,
    excludeUserIds: [teacher.id],
  });
  if (!opened.opened) {
    await service.from('grade_change_requests').delete().eq('id', inserted.id);
    fail('change-requests', `approval request not opened (${opened.reason})`);
  }

  await finishChangeRequestFiling(service, teacher, inserted, opened.requestId);
}

/**
 * The tail of the filing route, after the request row and its approval
 * request exist: the `grade_change_requested` audit row and the step-1
 * notification status. Split out so a re-run that finds a filed request
 * WITHOUT its audit row (a run that died between the two) can finish it.
 */
export async function finishChangeRequestFiling(
  service: SupabaseClient,
  teacher: Actor,
  req: {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    reason_category: string;
    justification: string;
    approval_flow: string;
  },
  approvalRequestId: string
): Promise<void> {
  const flow = req.approval_flow as Parameters<
    typeof loadGradeChangeStepRecipients
  >[1]['flow'];
  await logAction({
    service,
    actor: auditActor(teacher),
    action: 'grade_change_requested',
    entityType: 'grade_change_request',
    entityId: req.id,
    context: {
      grading_sheet_id: req.grading_sheet_id,
      grade_entry_id: req.grade_entry_id,
      ...(await loadOneSheetAuditLabels(service, req.grading_sheet_id)),
      ...((await loadEntryStudentLabels(service, [req.grade_entry_id])).get(
        req.grade_entry_id
      ) ?? {}),
      field: req.field_changed,
      slot_index: req.slot_index,
      current: req.current_value,
      proposed: req.proposed_value,
      reason_category: req.reason_category,
      justification: req.justification,
      flow,
      request_id: approvalRequestId,
    },
  });

  // Step 1's recipients, as the route resolves them; with none reachable the
  // route marks the request 'failed'. Otherwise it emails them in `after()`,
  // which the seeder drops (no mail) — notification_status stays 'pending'.
  const stepOne = await loadGradeChangeStepRecipients(service, {
    flow,
    gradeChangeRequestId: req.id,
    stageOrder: 1,
  });
  if (!stepOne || stepOne.recipients.length === 0) {
    await service
      .from('grade_change_requests')
      .update({ notification_status: 'failed' })
      .eq('id', req.id);
  }
  invalidateDrillTags('markbook', 'AY2026');
}

// ── PATCH /api/grading-sheets/[id]/entries/[entryId] — Path A ────────────

/**
 * Applying an approved change request: the route's checks, the app's own
 * `buildEntryPatch` and `apply_change_request_atomic` RPC (which flips the
 * request to applied), the `grade_audit_log` rows with the route's own
 * `buildApprovalReference`, and a `grade_change_applied` row per change.
 */
export async function applyChangeRequestRoute(
  service: SupabaseClient,
  registrar: Actor,
  requestId: string
): Promise<number> {
  const { data: req } = await service
    .from('grade_change_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (!req) fail('apply', `request ${requestId} not found`);
  if (req.status !== 'approved')
    fail('apply', `request is "${req.status}", not approved`);
  const { sheet, entry } = await readSheetAndEntry(
    service,
    req.grading_sheet_id,
    req.grade_entry_id
  );
  if (!sheet.is_locked) fail('apply', 'sheet is not locked');
  const proposed = Number(req.proposed_value);
  const approval_reference = buildApprovalReference(req);
  const patch = buildEntryPatch(
    req.field_changed,
    proposed,
    { ww_scores: entry.ww_scores, pt_scores: entry.pt_scores },
    req.slot_index
  );
  const afterWw =
    (patch.ww_scores as (number | null)[] | undefined) ?? entry.ww_scores;
  const afterPt =
    (patch.pt_scores as (number | null)[] | undefined) ?? entry.pt_scores;
  validateScores(sheet, afterWw, afterPt, entry.qa_score);

  const { error: rpcErr } = await service.rpc('apply_change_request_atomic', {
    p_grading_sheet_id: sheet.id,
    p_grade_entry_id: entry.id,
    p_change_request_id: req.id,
    p_entry_patch: patch,
    p_applied_by: registrar.id,
  });
  if (rpcErr) fail('apply', rpcErr.message);

  const diffRows = buildAuditRows(
    entry,
    {
      ww_scores: afterWw,
      pt_scores: afterPt,
      qa_score: entry.qa_score,
      letter_grade: entry.letter_grade,
      is_na: entry.is_na,
    },
    {
      grading_sheet_id: sheet.id,
      grade_entry_id: entry.id,
      changed_by: registrar.email,
      approval_reference,
    }
  );
  const whoAndWhere = {
    ...(await loadOneSheetAuditLabels(service, sheet.id)),
    ...((await loadEntryStudentLabels(service, [entry.id])).get(entry.id) ??
      {}),
  };
  const gradeAuditLogFailed = !(await writeAuditRows(service, diffRows));
  for (const row of diffRows) {
    await logAction({
      service,
      actor: auditActor(registrar),
      action: 'grade_change_applied',
      entityType: 'grade_change_request',
      entityId: req.id,
      context: {
        grading_sheet_id: sheet.id,
        grade_entry_id: entry.id,
        ...whoAndWhere,
        field: row.field_changed,
        old: row.old_value,
        new: row.new_value,
        was_locked: true,
        approval_reference,
        change_request_id: req.id,
        ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
      },
    });
  }
  invalidateDrillTags('markbook', 'AY2026');
  return diffRows.length;
}

import { NextResponse, type NextRequest, after } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import {
  loadEffectiveAssignmentsForUser,
  isSubjectTeacher,
} from '@/lib/auth/teacher-assignments';
import { computeQuarterly } from '@/lib/compute/quarterly';
import { OVERRIDE_LETTERS, isOverrideLetter } from '@/lib/compute/letter-grade';
import { buildAuditRows, writeAuditRows } from '@/lib/audit/log-grade-change';
import { proseLength } from '@/lib/rich-text';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';
import { notifyRequestApplied } from '@/lib/notifications/email-change-request';
import { fetchApproverEmails, fetchLabels } from '@/lib/change-requests/labels';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import {
  slotMetaSatisfied,
  slotRosterScored,
  type SlotKind,
} from '@/lib/grading/first-score-gate';
import { mergeSlotLabel } from '@/lib/grading/slot-label-sanitize';
import type { SlotLabels, SlotMeta } from '@/lib/schemas/grading-sheet';

// PATCH /api/grading-sheets/[id]/entries/[entryId]
// Rules (Sprint 9):
//   * Teachers: must be the assigned SUBJECT TEACHER for the sheet's
//     (section × subject) — a form class adviser reads the sheet but cannot
//     encode scores (see the subject-teacher gate below). Allowed only while
//     the sheet is UNLOCKED. Post-lock → 403.
//   * Registrar/admin/superadmin: allowed always. Post-lock edits must include
//     EITHER a `change_request_id` (Path A — points at an approved request) OR
//     `correction_reason` + `correction_justification` (Path B — registrar-only
//     data entry fix). Free-text `approval_reference` is no longer accepted.
//   * Hard Rule #5 stays satisfied: approval_reference is still written to
//     grade_audit_log for every post-lock edit, but derived server-side from
//     the path taken.
//   * Score validation vs max and server-side compute are unchanged from S3.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;
  const role = auth.role;

  const { id: sheetId, entryId } = await params;
  const body = (await request.json().catch(() => null)) as {
    ww_scores?: (number | null)[];
    pt_scores?: (number | null)[];
    qa_score?: number | null;
    letter_grade?: string | null;
    is_na?: boolean;
    // Sprint 9 — post-lock edits must use exactly one of these branches.
    change_request_id?: string;
    correction_reason?: string;
    correction_justification?: string;
    patch_target?: {
      field: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na';
      slotIndex?: number | null;
    };
    // Rejected — legacy clients. Return a clear error if present.
    approval_reference?: string;
    // First-score label gate (unlocked/direct path only) — the client's
    // opportunity to satisfy a slot's label requirement atomically with the
    // score write. See the gate block below.
    slot_label?: {
      kind: 'ww' | 'pt' | 'qa';
      index: number | null;
      meta: {
        label: string | null;
        date?: string | null;
        page?: string | null;
      };
    };
  } | null;
  if (!body)
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.approval_reference) {
    return NextResponse.json(
      {
        error:
          'approval_reference is no longer accepted — use change_request_id or correction_reason',
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        `id, section_id, subject_id, ww_totals, pt_totals, qa_total, is_locked, slot_labels,
         subject:subjects(is_examinable),
         subject_config:subject_configs(ww_weight, pt_weight, qa_weight)`
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select(
        'id, grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na'
      )
      .eq('id', entryId)
      .single(),
  ]);

  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (entryRes.error || !entryRes.data) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }
  const sheet = sheetRes.data as unknown as {
    id: string;
    section_id: string;
    subject_id: string;
    ww_totals: number[];
    pt_totals: number[];
    qa_total: number | null;
    is_locked: boolean;
    slot_labels: SlotLabels | null;
    subject: { is_examinable: boolean } | { is_examinable: boolean }[] | null;
    subject_config:
      | { ww_weight: number; pt_weight: number; qa_weight: number }
      | { ww_weight: number; pt_weight: number; qa_weight: number }[]
      | null;
  };
  const entry = entryRes.data;
  if (entry.grading_sheet_id !== sheetId) {
    return NextResponse.json(
      { error: 'entry does not belong to sheet' },
      { status: 400 }
    );
  }

  // ----- Subject-teacher gate -----
  // Only the assigned subject teacher may encode scores. A form class adviser
  // READS every subject in their section (that is what `is_teacher_for_sheet`
  // in migration 005 grants, and it is deliberate — the adviser monitors the
  // class) but advising is not teaching, so it carries no write right here.
  //
  // This check was missing, and its absence was not a policy choice: the two
  // sibling teacher-writable paths on the same sheet already require exactly
  // this — `PATCH .../labels` (403 'not assigned to this sheet') and
  // `POST /api/change-requests` (same). So an adviser could not rename an
  // activity on a sheet, yet could overwrite every score on it. Scores were
  // the one outlier.
  //
  // Note this is the only layer that can enforce it. Migration 005's RLS is
  // SELECT-only — its own header records that writes are denied to
  // `authenticated` outright and "the app uses the service-role client for
  // every write path" — and this route holds a service client, so RLS is not
  // in the loop. Role alone (`teacher`) was the entire authorization, which
  // also let any teacher write to any sheet in the school, not just advisers
  // on their own section.
  //
  // Managers (academic_coordinator / school_admin / superadmin) are exempt —
  // they do registrar data-entry fixes and the post-lock correction paths
  // below. Being adviser AND subject teacher for the same subject is
  // unaffected: that person holds a `subject_teacher` row and passes.
  //
  // EFFECTIVE assignments, so a substitute covering this slot passes. Entering
  // marks is the substitute's whole job; the regular teacher stays the name on
  // the sheet regardless, because the sheet header resolves that from
  // teacher_assignments and this table is never written for cover.
  if (role === 'teacher') {
    const cookieClient = await createClient();
    const assignments = await loadEffectiveAssignmentsForUser(
      cookieClient,
      auth.user.id
    );
    if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id)) {
      return NextResponse.json(
        { error: 'not assigned to this sheet' },
        { status: 403 }
      );
    }
  }

  // ----- Lock-gate (Sprint 9 two-path workflow) -----
  // Server-derived approval reference for grade_audit_log (Hard Rule #5).
  let approval_reference = '';
  // Path metadata for logging + post-save request state transitions.
  let appliedChangeRequest: {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    reason_category: string;
    justification: string;
    requested_by_email: string;
    requested_at: string;
    reviewed_by_email: string | null;
    primary_reviewed_by_email?: string | null;
    reviewed_at?: string | null;
    decision_note: string | null;
  } | null = null;
  // The single validated slot/field value being applied (Path A only) — the
  // exact value already checked by valuesMatch/proposedFromPayload against
  // the approved request. buildEntryPatch uses this (never the raw client
  // body) so it can never clobber unrelated slots/fields.
  let appliedProposedValue: string | number | boolean | null = null;
  let correctionMeta: {
    reason: CorrectionReason;
    justification: string;
  } | null = null;

  if (sheet.is_locked) {
    if (role === 'teacher') {
      return NextResponse.json({ error: 'sheet is locked' }, { status: 403 });
    }
    const hasRequest =
      typeof body.change_request_id === 'string' &&
      body.change_request_id.length > 0;
    const hasCorrection =
      typeof body.correction_reason === 'string' &&
      typeof body.correction_justification === 'string';
    if (hasRequest === hasCorrection) {
      return NextResponse.json(
        {
          error:
            'post-lock edits require exactly one of change_request_id or correction_reason',
        },
        { status: 400 }
      );
    }

    if (hasRequest) {
      // ----- Path A: apply an approved change request -----
      const { data: reqRow, error: reqErr } = await service
        .from('grade_change_requests')
        .select('*')
        .eq('id', body.change_request_id as string)
        .single();
      if (reqErr || !reqRow) {
        return NextResponse.json(
          { error: 'change request not found' },
          { status: 404 }
        );
      }
      if (reqRow.status !== 'approved') {
        return NextResponse.json(
          {
            error: `change request is in status "${reqRow.status}", not approved`,
          },
          { status: 400 }
        );
      }
      if (
        reqRow.grading_sheet_id !== sheetId ||
        reqRow.grade_entry_id !== entryId
      ) {
        return NextResponse.json(
          { error: 'change request does not match this entry' },
          { status: 400 }
        );
      }
      // Target must line up with the request's field + slot.
      const target = body.patch_target;
      if (!target || target.field !== reqRow.field_changed) {
        return NextResponse.json(
          { error: 'patch_target field does not match approved request' },
          { status: 400 }
        );
      }
      if (
        (reqRow.field_changed === 'ww_scores' ||
          reqRow.field_changed === 'pt_scores') &&
        (target.slotIndex ?? null) !== reqRow.slot_index
      ) {
        return NextResponse.json(
          { error: 'patch_target slot does not match approved request' },
          { status: 400 }
        );
      }

      // Verify the proposed value in the payload matches the request's proposed_value.
      const typedProposed = proposedFromPayload(
        body,
        reqRow.field_changed,
        reqRow.slot_index
      );
      if (typedProposed === undefined) {
        return NextResponse.json(
          { error: 'payload does not include the field being changed' },
          { status: 400 }
        );
      }
      if (
        !valuesMatch(reqRow.field_changed, typedProposed, reqRow.proposed_value)
      ) {
        return NextResponse.json(
          {
            error: `typed value "${typedProposed}" does not match approved proposal "${reqRow.proposed_value}"`,
          },
          { status: 400 }
        );
      }
      if (String(typedProposed) !== String(reqRow.proposed_value)) {
        console.warn(
          '[entries PATCH] proposed value matched canonically but not as string',
          {
            typed: typedProposed,
            approved: reqRow.proposed_value,
            field: reqRow.field_changed,
          }
        );
      }

      appliedChangeRequest = reqRow;
      appliedProposedValue = typedProposed;
      const approverEmail =
        reqRow.primary_reviewed_by_email ??
        reqRow.reviewed_by_email ??
        '(unknown)';
      approval_reference =
        `Request #${reqRow.id.slice(0, 8)} approved by ${approverEmail} ${
          reqRow.reviewed_at
            ? new Date(reqRow.reviewed_at).toISOString().slice(0, 10)
            : ''
        }`.trim();
    } else {
      // ----- Path B: data entry correction -----
      const reason = body.correction_reason as string;
      if (!(CORRECTION_REASONS as readonly string[]).includes(reason)) {
        return NextResponse.json(
          { error: `invalid correction_reason "${reason}"` },
          { status: 400 }
        );
      }
      const justification = (body.correction_justification ?? '').trim();
      // Counted on the words. The justification is written in a formatting
      // editor, so the raw string opens with `<p>` and closes with `</p>` —
      // against that, this floor silently drops to thirteen typed characters,
      // and the two client gates (use-approval-reference, totals-editor) now
      // measure prose, so the server would have been the laxer of the three.
      if (proseLength(justification) < 20) {
        return NextResponse.json(
          { error: 'correction_justification must be at least 20 characters' },
          { status: 400 }
        );
      }
      correctionMeta = {
        reason: reason as CorrectionReason,
        justification,
      };
      approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[reason as CorrectionReason]}`;
    }
  }
  const changed_by = auth.user.email ?? auth.user.id;

  // Audit action taxonomy for post-save logging.
  const actionForAudit: AuditAction = !sheet.is_locked
    ? 'entry.update'
    : appliedChangeRequest
      ? 'grade_change_applied'
      : 'grade_correction';

  const subject = Array.isArray(sheet.subject)
    ? sheet.subject[0]
    : sheet.subject;
  const config = Array.isArray(sheet.subject_config)
    ? sheet.subject_config[0]
    : sheet.subject_config;

  if (!config) {
    return NextResponse.json(
      { error: 'missing subject_config on sheet' },
      { status: 500 }
    );
  }

  // ----- Examinable: merge + validate vs max -----
  const merged = {
    ww_scores: body.ww_scores ?? (entry.ww_scores as (number | null)[]) ?? [],
    pt_scores: body.pt_scores ?? (entry.pt_scores as (number | null)[]) ?? [],
    qa_score:
      'qa_score' in body
        ? (body.qa_score ?? null)
        : ((entry.qa_score as number | null | undefined) ?? null),
  };

  const normalizeArr = (arr: (number | null)[], length: number) => {
    const out: (number | null)[] = new Array(length).fill(null);
    for (let i = 0; i < Math.min(arr.length, length); i++)
      out[i] = arr[i] ?? null;
    return out;
  };
  const ww_scores = normalizeArr(merged.ww_scores, sheet.ww_totals.length);
  const pt_scores = normalizeArr(merged.pt_scores, sheet.pt_totals.length);
  const qa_score = merged.qa_score;

  for (let i = 0; i < ww_scores.length; i++) {
    const v = ww_scores[i];
    if (v != null && (v < 0 || v > sheet.ww_totals[i])) {
      return NextResponse.json(
        {
          error: `W${i + 1} score ${v} out of range [0, ${sheet.ww_totals[i]}]`,
        },
        { status: 400 }
      );
    }
  }
  for (let i = 0; i < pt_scores.length; i++) {
    const v = pt_scores[i];
    if (v != null && (v < 0 || v > sheet.pt_totals[i])) {
      return NextResponse.json(
        {
          error: `PT${i + 1} score ${v} out of range [0, ${sheet.pt_totals[i]}]`,
        },
        { status: 400 }
      );
    }
  }
  if (qa_score != null && sheet.qa_total != null) {
    if (qa_score < 0 || qa_score > sheet.qa_total) {
      return NextResponse.json(
        { error: `QA score ${qa_score} out of range [0, ${sheet.qa_total}]` },
        { status: 400 }
      );
    }
  }

  const is_na = 'is_na' in body ? Boolean(body.is_na) : Boolean(entry.is_na);

  // Per-term letter override for non-examinable subjects (KD #104). Only UG/E
  // are valid stored values (A/B/C/IP are always derived); null clears it.
  const isExaminable = subject?.is_examinable !== false;
  let letter_grade: string | null;
  if ('letter_grade' in body) {
    const lg = body.letter_grade ?? null;
    if (lg !== null && !isOverrideLetter(lg)) {
      return NextResponse.json(
        {
          error: `letter_grade must be one of ${OVERRIDE_LETTERS.join(', ')} (or empty to clear)`,
        },
        { status: 400 }
      );
    }
    if (lg !== null && isExaminable) {
      return NextResponse.json(
        {
          error:
            'letter_grade override only applies to non-examinable subjects',
        },
        { status: 400 }
      );
    }
    letter_grade = lg;
  } else {
    letter_grade = (entry.letter_grade as string | null) ?? null;
  }

  const computed = computeQuarterly({
    ww_scores,
    ww_totals: sheet.ww_totals,
    pt_scores,
    pt_totals: sheet.pt_totals,
    qa_score,
    qa_total: sheet.qa_total,
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  });

  // ----- First-score label gate (unlocked/direct path only; Hard Rule #5's
  // locked change-request/correction paths are never touched by this) -----
  if (!sheet.is_locked) {
    const { data: rosterRaw } = await service
      .from('grade_entries')
      .select('id, ww_scores, pt_scores, qa_score')
      .eq('grading_sheet_id', sheetId);
    const others = (
      (rosterRaw ?? []) as {
        id: string;
        ww_scores: (number | null)[] | null;
        pt_scores: (number | null)[] | null;
        qa_score: number | null;
      }[]
    )
      .filter((r) => r.id !== entryId)
      .map((r) => ({
        ww_scores: (r.ww_scores ?? []) as (number | null)[],
        pt_scores: (r.pt_scores ?? []) as (number | null)[],
        qa_score: r.qa_score,
      }));

    const prevWw = (entry.ww_scores as (number | null)[] | null) ?? [];
    const prevPt = (entry.pt_scores as (number | null)[] | null) ?? [];
    const prevQa = entry.qa_score as number | null;
    const labels = (sheet.slot_labels ?? {}) as SlotLabels;

    const incomingSatisfies = (kind: SlotKind, idx: number | null) =>
      !!body.slot_label &&
      body.slot_label.kind === kind &&
      (body.slot_label.index ?? null) === idx &&
      slotMetaSatisfied(kind, body.slot_label.meta);

    const violations: string[] = [];
    const checkSlot = (
      kind: SlotKind,
      idx: number | null,
      newVal: number | null,
      prevVal: number | null,
      existingMeta: unknown
    ) => {
      if (newVal == null || prevVal != null) return; // not a genuine new score
      if (slotRosterScored(kind, idx, others)) return; // grandfathered
      if (slotMetaSatisfied(kind, existingMeta as SlotMeta | string | null))
        return; // already labeled
      if (incomingSatisfies(kind, idx)) return; // client supplying it now
      violations.push(
        kind === 'qa' ? 'QA' : `${kind.toUpperCase()}${(idx as number) + 1}`
      );
    };

    ww_scores.forEach((v, i) =>
      checkSlot('ww', i, v, prevWw[i] ?? null, labels.ww?.[i])
    );
    pt_scores.forEach((v, i) =>
      checkSlot('pt', i, v, prevPt[i] ?? null, labels.pt?.[i])
    );
    checkSlot('qa', null, qa_score, prevQa, labels.qa);

    if (violations.length > 0) {
      const needsDate = violations.some((v) => v !== 'QA');
      return NextResponse.json(
        {
          error: `Add a description${needsDate ? ' and date administered' : ''} before entering the first score for ${violations.join(', ')}.`,
          code: 'label_required',
          slots: violations,
        },
        { status: 422 }
      );
    }

    if (body.slot_label) {
      const merged = mergeSlotLabel(
        sheet.slot_labels as SlotLabels | null,
        body.slot_label
      );
      const { error: lblErr } = await service
        .from('grading_sheets')
        .update({ slot_labels: merged })
        .eq('id', sheetId);
      if (lblErr)
        return NextResponse.json({ error: lblErr.message }, { status: 500 });
    }
  }

  let updated: Record<string, unknown> | null = null;
  if (sheet.is_locked && appliedChangeRequest) {
    // Path A — route the raw entry patch + request flip through the atomic
    // RPC. The RPC owns the lock re-check, so a concurrent unlock between
    // the top-of-handler read and now will surface as `lock_state_changed`.
    const entryPatch = buildEntryPatch(
      appliedChangeRequest.field_changed,
      appliedProposedValue,
      {
        ww_scores: entry.ww_scores as (number | null)[] | null,
        pt_scores: entry.pt_scores as (number | null)[] | null,
      },
      appliedChangeRequest.slot_index
    );
    const { error: rpcErr } = await service.rpc('apply_change_request_atomic', {
      p_grading_sheet_id: sheet.id,
      p_grade_entry_id: entryId,
      p_change_request_id: appliedChangeRequest.id,
      p_entry_patch: entryPatch,
      p_applied_by: auth.user.id,
    });
    if (rpcErr) {
      if (rpcErr.message.includes('lock_state_changed')) {
        return NextResponse.json(
          {
            error:
              'The sheet was unlocked while this request was being processed. No change was saved. Please refresh and try again.',
          },
          { status: 409 }
        );
      }
      if (rpcErr.message.includes('change_request_not_approved')) {
        return NextResponse.json(
          {
            error:
              'This request is no longer in approved status. It may have been cancelled or already applied — please refresh.',
          },
          { status: 409 }
        );
      }
      console.error(
        '[entries PATCH] apply_change_request_atomic failed:',
        rpcErr
      );
      return NextResponse.json({ error: 'Apply failed' }, { status: 500 });
    }
    // The RPC wrote raw mutable columns only. Computed derived fields
    // (ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) still need a
    // recompute pass — apply that as a follow-up update outside the RPC.
    const { data: derivedUpdated, error: derivedErr } = await service
      .from('grade_entries')
      .update({
        ww_ps: computed.ww_ps,
        pt_ps: computed.pt_ps,
        qa_ps: computed.qa_ps,
        initial_grade: computed.initial_grade,
        quarterly_grade: computed.quarterly_grade,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select('*')
      .single();
    if (derivedErr)
      return NextResponse.json({ error: derivedErr.message }, { status: 500 });
    updated = derivedUpdated;
  } else {
    const { data: directUpdated, error } = await service
      .from('grade_entries')
      .update({
        ww_scores,
        pt_scores,
        qa_score,
        is_na,
        letter_grade,
        ww_ps: computed.ww_ps,
        pt_ps: computed.pt_ps,
        qa_ps: computed.qa_ps,
        initial_grade: computed.initial_grade,
        quarterly_grade: computed.quarterly_grade,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select('*')
      .single();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    updated = directUpdated;
  }

  // Audit-log every changed field (pre-lock AND post-lock in the new
  // generic audit_log; still also write post-lock to grade_audit_log for
  // backward compat during the first term on the new system).
  const diffRows = buildAuditRows(
    {
      ww_scores: entry.ww_scores as (number | null)[] | null,
      pt_scores: entry.pt_scores as (number | null)[] | null,
      qa_score: entry.qa_score as number | null,
      letter_grade: entry.letter_grade as string | null,
      is_na: entry.is_na as boolean,
    },
    { ww_scores, pt_scores, qa_score, letter_grade, is_na },
    {
      grading_sheet_id: sheetId,
      grade_entry_id: entryId,
      changed_by,
      approval_reference,
    }
  );
  if (diffRows.length > 0) {
    if (sheet.is_locked) {
      await writeAuditRows(service, diffRows);
    }
    for (const row of diffRows) {
      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: actionForAudit,
        entityType:
          sheet.is_locked && appliedChangeRequest
            ? 'grade_change_request'
            : 'grade_entry',
        entityId:
          sheet.is_locked && appliedChangeRequest
            ? appliedChangeRequest.id
            : entryId,
        context: {
          grading_sheet_id: sheetId,
          grade_entry_id: entryId,
          field: row.field_changed,
          old: row.old_value,
          new: row.new_value,
          was_locked: sheet.is_locked,
          ...(sheet.is_locked ? { approval_reference } : {}),
          ...(appliedChangeRequest
            ? { change_request_id: appliedChangeRequest.id }
            : {}),
          ...(correctionMeta
            ? {
                correction_reason: correctionMeta.reason,
                correction_justification: correctionMeta.justification,
              }
            : {}),
        },
      });
    }
  } else if (sheet.is_locked && appliedChangeRequest) {
    // Hard Rule #5: every post-lock change-request apply must leave an
    // approval_reference in the audit log. When the approved value
    // happens to already match the stored value (no diff produced),
    // still log one grade_change_applied row so the trail is complete.
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: actionForAudit,
      entityType: 'grade_change_request',
      entityId: appliedChangeRequest.id,
      context: {
        grading_sheet_id: sheetId,
        grade_entry_id: entryId,
        field: appliedChangeRequest.field_changed,
        no_op: true,
        was_locked: true,
        approval_reference,
        change_request_id: appliedChangeRequest.id,
      },
    });
  }
  await finalizeChangeRequestPathA({
    appliedChangeRequest,
    actorUser: auth.user,
    sheetId,
    entryId,
    service,
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ entry: updated, computed });
}

// ------ helpers ------

/**
 * Compares the registrar's typed value against the approved proposed value.
 * Score fields are numeric — coerce both sides to Number so '85' matches 85.0.
 * ww_scores / pt_scores compare per-slot: each change request carries a
 * single slot_index, proposedFromPayload returns the scalar at that slot,
 * and the DB stores proposed_value as a scalar string. No array parsing.
 * Boolean is_na uses true/false equality across string + bool inputs.
 * letter_grade keeps strict string equality (case-sensitive — A vs a matters).
 */
function valuesMatch(
  fieldChanged: string,
  typed: unknown,
  approved: unknown
): boolean {
  if (typed == null && approved == null) return true;
  if (typed == null || approved == null) return false;
  if (
    fieldChanged === 'ww_scores' ||
    fieldChanged === 'pt_scores' ||
    fieldChanged === 'qa_score'
  ) {
    return Number(typed) === Number(approved);
  }
  if (fieldChanged === 'is_na') {
    const t = typed === true || typed === 'true';
    const a = approved === true || approved === 'true';
    return t === a;
  }
  // letter_grade and any other string field
  return String(typed) === String(approved);
}

// Builds the JSONB patch passed to apply_change_request_atomic for a
// change-request "apply" (Path A). This patch must reflect ONLY the single
// approved slot/field — never more. For ww_scores/pt_scores, a change
// request only ever approves ONE element of the array (a single slot_index);
// the array as a whole is not under review. So the patch is built from the
// entry's CURRENT DB array with just that one slot replaced by the approved
// value — never from the client's full (possibly stale) array, which could
// otherwise silently overwrite every other slot under an approval_reference
// that never covered them (Hard Rule #5). qa_score/letter_grade/is_na are
// scalar columns — a change request targeting one of those covers the whole
// field (there's no "other slots" to protect), so they're written directly.
export function buildEntryPatch(
  fieldChanged: string,
  proposedValue: string | number | boolean | null,
  currentArrays: {
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
  },
  slotIndex: number | null
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (fieldChanged === 'ww_scores' || fieldChanged === 'pt_scores') {
    if (slotIndex == null) return patch;
    const current =
      (fieldChanged === 'ww_scores'
        ? currentArrays.ww_scores
        : currentArrays.pt_scores) ?? [];
    const next = [...current];
    while (next.length <= slotIndex) next.push(null);
    next[slotIndex] = (proposedValue as number | null) ?? null;
    patch[fieldChanged] = next;
  } else if (fieldChanged === 'qa_score') {
    patch.qa_score = (proposedValue as number | null) ?? null;
  } else if (fieldChanged === 'letter_grade') {
    patch.letter_grade = (proposedValue as string | null) ?? null;
  } else if (fieldChanged === 'is_na') {
    patch.is_na = Boolean(proposedValue);
  }
  return patch;
}

// Extracts the proposed value a client is trying to save for a given field.
// Used by Path A to verify the typed value matches the approved request's
// proposed_value before flipping the request to applied.
function proposedFromPayload(
  body: {
    ww_scores?: (number | null)[];
    pt_scores?: (number | null)[];
    qa_score?: number | null;
    letter_grade?: string | null;
    is_na?: boolean;
  },
  field: string,
  slotIndex: number | null
): string | number | boolean | null | undefined {
  switch (field) {
    case 'ww_scores':
      if (!Array.isArray(body.ww_scores) || slotIndex == null) return undefined;
      return body.ww_scores[slotIndex] ?? null;
    case 'pt_scores':
      if (!Array.isArray(body.pt_scores) || slotIndex == null) return undefined;
      return body.pt_scores[slotIndex] ?? null;
    case 'qa_score':
      return 'qa_score' in body ? (body.qa_score ?? null) : undefined;
    case 'letter_grade':
      return 'letter_grade' in body ? (body.letter_grade ?? null) : undefined;
    case 'is_na':
      return 'is_na' in body ? Boolean(body.is_na) : undefined;
    default:
      return undefined;
  }
}

// Side effects for Path A only — after a successful entry write, fire an
// email to the teacher + approvers. The status/applied_by/applied_at flip is
// owned by `apply_change_request_atomic` (migration 044) and runs inside the
// same transaction as the entry patch + lock re-check, so this helper no
// longer touches the request row.
// Never throws; email failures are logged but non-fatal.
async function finalizeChangeRequestPathA(args: {
  appliedChangeRequest: {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    reason_category: string;
    justification: string;
    requested_by_email: string;
    requested_at: string;
    reviewed_by_email: string | null;
    decision_note: string | null;
  } | null;
  actorUser: { id: string; email?: string | null };
  sheetId: string;
  entryId: string;
  service: ReturnType<typeof createServiceClient>;
}): Promise<void> {
  const { appliedChangeRequest, sheetId, entryId, service } = args;
  if (!appliedChangeRequest) return;
  // Notify the teacher/approver via after() so it survives past the
  // response on Vercel's serverless runtime (an un-awaited void(async())
  // has no such guarantee — see the matching note in
  // app/api/change-requests/route.ts).
  after(async () => {
    try {
      const [labels, approverEmails] = await Promise.all([
        fetchLabels(service, sheetId, entryId),
        fetchApproverEmails(service),
      ]);
      await notifyRequestApplied(
        {
          id: appliedChangeRequest.id,
          grading_sheet_id: appliedChangeRequest.grading_sheet_id,
          field_changed: appliedChangeRequest.field_changed,
          current_value: appliedChangeRequest.current_value,
          proposed_value: appliedChangeRequest.proposed_value,
          reason_category: appliedChangeRequest.reason_category,
          justification: appliedChangeRequest.justification,
          requested_by_email: appliedChangeRequest.requested_by_email,
          requested_at: appliedChangeRequest.requested_at,
          reviewed_by_email: appliedChangeRequest.reviewed_by_email,
          decision_note: appliedChangeRequest.decision_note,
          student_label: labels.student_label,
          sheet_label: labels.sheet_label,
        },
        appliedChangeRequest.requested_by_email,
        approverEmails
      );
    } catch (e) {
      console.error('[change-requests] notify applied failed', e);
    }
  });
}

import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { recomputeSheetEntries } from '@/lib/grading/recompute-sheet';
import { resolveSheetWeights } from '@/lib/grading/resolve-sheet-weights';
import {
  buildTotalsAuditRows,
  writeAuditRows,
} from '@/lib/audit/log-grade-change';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// PATCH /api/grading-sheets/[id]/totals — registrar+ only.
// Updates WW/PT/QA max totals on a sheet. After updating totals we MUST
// recompute every entry's percentage scores (denominator changed) and write
// audit rows for the totals change.
//
// Sprint 9: post-lock totals changes only support Path B (data entry
// correction). Change requests aren't allowed here — teachers would never
// legitimately request a max-slot change; that's a config fix. The registrar
// provides a structured `correction_reason` + `correction_justification`,
// logged as action='grade_correction' on the grading sheet.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sheetId } = await params;
  const body = (await request.json().catch(() => null)) as {
    ww_totals?: number[];
    pt_totals?: number[];
    qa_total?: number | null;
    // Migration 159 — THIS sheet's own weights, as integer percentages summing
    // to 100. Explicit null on all three clears the override and the sheet goes
    // back to inheriting its subject config. Absent means "leave alone".
    //
    // They ride along with the totals rather than getting their own endpoint
    // because both change what a grade MEANS and both need the same recompute
    // afterwards. Two endpoints would be two writes, two recomputes and two
    // audit rows for one edit, and a chance to interleave.
    ww_weight?: number | null;
    pt_weight?: number | null;
    qa_weight?: number | null;
    correction_reason?: string;
    correction_justification?: string;
    approval_reference?: string; // legacy — rejected
  } | null;
  if (!body)
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.approval_reference) {
    return NextResponse.json(
      {
        error:
          'approval_reference is no longer accepted — use correction_reason + correction_justification',
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: sheet, error: sheetErr } = await service
    .from('grading_sheets')
    .select(
      `id, ww_totals, pt_totals, qa_total, is_locked,
       ww_weight, pt_weight, qa_weight,
       subject_config:subject_configs(ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`
    )
    .eq('id', sheetId)
    .single();
  if (sheetErr || !sheet) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  const config = Array.isArray(sheet.subject_config)
    ? sheet.subject_config[0]
    : sheet.subject_config;
  if (!config) {
    return NextResponse.json(
      { error: 'missing subject_config' },
      { status: 500 }
    );
  }

  // Sprint 9 — Path B correction metadata for post-lock totals edits.
  let correctionMeta: {
    reason: CorrectionReason;
    justification: string;
  } | null = null;
  let approval_reference = '';
  if (sheet.is_locked) {
    const reason = body.correction_reason;
    if (
      !reason ||
      !(CORRECTION_REASONS as readonly string[]).includes(reason)
    ) {
      return NextResponse.json(
        { error: 'post-lock totals edits require a valid correction_reason' },
        { status: 400 }
      );
    }
    const justification = (body.correction_justification ?? '').trim();
    if (justification.length < 20) {
      return NextResponse.json(
        { error: 'correction_justification must be at least 20 characters' },
        { status: 400 }
      );
    }
    correctionMeta = { reason: reason as CorrectionReason, justification };
    approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[reason as CorrectionReason]}`;
  }

  const before = {
    ww_totals: (sheet.ww_totals ?? []) as number[],
    pt_totals: (sheet.pt_totals ?? []) as number[],
    qa_total: (sheet.qa_total ?? null) as number | null,
  };
  const after = {
    ww_totals: body.ww_totals ?? before.ww_totals,
    pt_totals: body.pt_totals ?? before.pt_totals,
    qa_total: 'qa_total' in body ? (body.qa_total ?? null) : before.qa_total,
  };

  if (after.ww_totals.length > config.ww_max_slots) {
    return NextResponse.json(
      { error: `too many WW slots (max ${config.ww_max_slots})` },
      { status: 400 }
    );
  }
  if (after.pt_totals.length > config.pt_max_slots) {
    return NextResponse.json(
      { error: `too many PT slots (max ${config.pt_max_slots})` },
      { status: 400 }
    );
  }
  if (after.ww_totals.some((v) => typeof v !== 'number' || v <= 0)) {
    return NextResponse.json(
      { error: 'ww_totals must be positive numbers' },
      { status: 400 }
    );
  }
  if (after.pt_totals.some((v) => typeof v !== 'number' || v <= 0)) {
    return NextResponse.json(
      { error: 'pt_totals must be positive numbers' },
      { status: 400 }
    );
  }

  // ---- This sheet's own weights (migration 159) -------------------------
  //
  // Set together or not at all — migration 159's CHECK says the same thing at
  // the database, and a half-set row would silently mix the sheet's answer with
  // its config's. `touchesWeights` distinguishes "leave these alone" (absent)
  // from "go back to inheriting" (all three null), which a truthiness test
  // could not: 0 is a legitimate weight and is exactly the one this feature
  // exists to store.
  const weightKeys = ['ww_weight', 'pt_weight', 'qa_weight'] as const;
  const touchesWeights = weightKeys.some((k) => k in body);
  let weightPatch: Record<string, number | null> | null = null;

  if (touchesWeights) {
    const given = weightKeys.map((k) => (k in body ? body[k] : undefined));
    const allNull = given.every((v) => v === null);
    const allNumbers = given.every((v) => typeof v === 'number');

    if (!allNull && !allNumbers) {
      return NextResponse.json(
        {
          error:
            'Set all three weights together, or send all three as null to go back to the subject default.',
        },
        { status: 400 }
      );
    }

    if (allNull) {
      weightPatch = { ww_weight: null, pt_weight: null, qa_weight: null };
    } else {
      const pcts = given as number[];
      if (
        pcts.some((v) => !Number.isInteger(v) || v < 0 || v > 100) ||
        pcts.reduce((a, b) => a + b, 0) !== 100
      ) {
        return NextResponse.json(
          {
            error:
              'Weights must be whole numbers from 0 to 100 adding up to 100.',
          },
          { status: 400 }
        );
      }
      weightPatch = {
        ww_weight: pcts[0] / 100,
        pt_weight: pcts[1] / 100,
        qa_weight: pcts[2] / 100,
      };
    }
  }

  // Apply totals update.
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
  if (upErr)
    return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Recompute every entry's PS / initial / quarterly against the new totals.
  // Shared with the config-level fan-out via lib/grading/recompute-sheet.ts —
  // this route was the only correct implementation, so it became the shared
  // one rather than staying a thing to copy.
  //
  // One behaviour difference from the inline version this replaced: an entry
  // whose values are already identical is no longer rewritten, so its
  // `updated_at` no longer bumps on a no-op. Every entry that genuinely moves,
  // and every entry whose score array has to resize, is still written.
  let recompute;
  try {
    recompute = await recomputeSheetEntries(
      service,
      sheetId,
      after,
      // The weights this sheet grades by AFTER this edit — the ones just sent
      // if the request changed them, the sheet's own if it already had some,
      // the config's otherwise (migration 159). Resolving against the
      // pre-update row would recompute every grade against the weights the
      // coordinator just replaced.
      resolveSheetWeights(weightPatch ?? sheet, config)
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'recompute failed' },
      { status: 500 }
    );
  }

  // Audit-log the totals change (pre-lock AND post-lock in the new generic
  // audit_log; still also write post-lock to grade_audit_log for backward compat).
  const changed_by = auth.user.email ?? auth.user.id;
  const actionForAudit: AuditAction = sheet.is_locked
    ? 'grade_correction'
    : 'totals.update';
  const anchor = recompute.anchorEntryId;
  if (anchor) {
    const totalsDiff = buildTotalsAuditRows(before, after, {
      grading_sheet_id: sheetId,
      grade_entry_id: anchor,
      changed_by,
      approval_reference,
    });
    if (totalsDiff.length > 0) {
      if (sheet.is_locked) {
        await writeAuditRows(service, totalsDiff);
      }
      for (const row of totalsDiff) {
        await logAction({
          service,
          actor: {
            id: auth.user.id,
            email: auth.user.email ?? null,
            role: auth.role,
          },
          action: actionForAudit,
          entityType: 'grading_sheet',
          entityId: sheetId,
          context: {
            field: row.field_changed,
            old: row.old_value,
            new: row.new_value,
            was_locked: sheet.is_locked,
            ...(sheet.is_locked ? { approval_reference } : {}),
            ...(correctionMeta
              ? {
                  correction_reason: correctionMeta.reason,
                  correction_justification: correctionMeta.justification,
                }
              : {}),
          },
        });
      }
    }
  }

  // A weight change gets its own row, and NOT via `buildTotalsAuditLog` above:
  // that walks the totals field-by-field and only writes when there is an
  // anchor entry to hang a `grade_audit_log` row on, so a weight change on a
  // sheet nobody has scored yet would leave no trace at all. This one moves
  // every grade on the sheet, so it is logged whether or not a score exists.
  if (weightPatch) {
    const pct = (v: number | string | null) =>
      v == null ? null : Math.round(Number(v) * 100);
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: actionForAudit,
      entityType: 'grading_sheet',
      entityId: sheetId,
      context: {
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
        // Null on both sides means "follows the subject", which is the thing a
        // reader of this row most needs to be able to tell apart from 0%.
        scope: 'this class only',
        was_locked: sheet.is_locked,
        ...(sheet.is_locked ? { approval_reference } : {}),
        ...(correctionMeta
          ? {
              correction_reason: correctionMeta.reason,
              correction_justification: correctionMeta.justification,
            }
          : {}),
      },
    });
  }

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ ok: true, totals: after });
}

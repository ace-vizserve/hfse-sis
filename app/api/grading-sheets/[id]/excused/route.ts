import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { writeAuditRows } from '@/lib/audit/log-grade-change';
import { logAction } from '@/lib/audit/log-action';
import { proseLength } from '@/lib/rich-text';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';
import {
  loadEntryStudentLabels,
  loadOneSheetAuditLabels,
} from '@/lib/grading/sheet-audit-labels';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { isTerm4Framework } from '@/lib/grading/term4-framework';

// PATCH /api/grading-sheets/[id]/excused — which WW/PT slots count for one
// student (proration, migration 179).
//
// Since migration 177 a blank slot scores zero against the full total, as the
// workbooks do. The registrar excuses the slots a student could not have sat —
// typically a late enrollee's assessments from before they joined — and an
// excused slot leaves both that student's score and their total. The derive
// trigger recomputes the grade on the write below; it also refuses an excused
// slot that still holds a score, and any change from a non-registrar.
//
// A locked sheet takes a data-entry correction (reason + justification), the
// same Path B as the entries route, and every change lands in grade_audit_log
// with that approval reference (Hard Rule #5).

type Body = {
  section_student_id?: string;
  ww_excused?: number[];
  pt_excused?: number[];
  correction_reason?: string;
  correction_justification?: string;
};

function normalise(
  slots: unknown,
  slotCount: number
): { ok: true; value: number[] } | { ok: false } {
  if (!Array.isArray(slots)) return { ok: false };
  const out = new Set<number>();
  for (const s of slots) {
    if (!Number.isInteger(s) || s < 1 || s > slotCount) return { ok: false };
    out.add(s);
  }
  return { ok: true, value: [...out].sort((a, b) => a - b) };
}

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
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.section_student_id !== 'string') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const service = createServiceClient();
  const [sheetRes, enrolmentRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select('id, section_id, ww_totals, pt_totals, is_locked, sheet_type')
      .eq('id', sheetId)
      .single(),
    service
      .from('section_students')
      .select('id, section_id')
      .eq('id', body.section_student_id)
      .single(),
    service
      .from('grade_entries')
      .select('id, ww_scores, pt_scores, ww_excused, pt_excused')
      .eq('grading_sheet_id', sheetId)
      .eq('section_student_id', body.section_student_id)
      .maybeSingle(),
  ]);
  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (enrolmentRes.error || !enrolmentRes.data) {
    return NextResponse.json({ error: 'student not found' }, { status: 404 });
  }
  if (entryRes.error) {
    return NextResponse.json(
      { error: entryRes.error.message },
      { status: 500 }
    );
  }
  const sheet = sheetRes.data as {
    id: string;
    section_id: string;
    ww_totals: number[] | null;
    pt_totals: number[] | null;
    is_locked: boolean;
    sheet_type: string | null;
  };
  if (isTerm4Framework(sheet.sheet_type)) {
    return NextResponse.json(
      { error: 'Assessments cannot be excused on a Term 4 framework sheet.' },
      { status: 400 }
    );
  }
  if (enrolmentRes.data.section_id !== sheet.section_id) {
    return NextResponse.json(
      { error: 'student is not in this class' },
      { status: 400 }
    );
  }

  const ww = normalise(body.ww_excused ?? [], (sheet.ww_totals ?? []).length);
  const pt = normalise(body.pt_excused ?? [], (sheet.pt_totals ?? []).length);
  if (!ww.ok || !pt.ok) {
    return NextResponse.json(
      { error: 'excused slots must be slot numbers on this sheet' },
      { status: 400 }
    );
  }

  const entry = entryRes.data as {
    id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    ww_excused: number[] | null;
    pt_excused: number[] | null;
  } | null;
  const scored = [
    ...ww.value
      .filter((s) => entry?.ww_scores?.[s - 1] != null)
      .map((s) => `W${s}`),
    ...pt.value
      .filter((s) => entry?.pt_scores?.[s - 1] != null)
      .map((s) => `PT${s}`),
  ];
  if (scored.length > 0) {
    return NextResponse.json(
      {
        error: `Clear the score in ${scored.join(', ')} before excusing it.`,
      },
      { status: 400 }
    );
  }

  let approval_reference = '';
  let correction: { reason: CorrectionReason; justification: string } | null =
    null;
  if (sheet.is_locked) {
    const reason = body.correction_reason as string;
    if (!(CORRECTION_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json(
        { error: 'A locked sheet needs a correction reason.' },
        { status: 400 }
      );
    }
    const justification = (body.correction_justification ?? '').trim();
    if (proseLength(justification) < 20) {
      return NextResponse.json(
        { error: 'The justification must be at least 20 characters.' },
        { status: 400 }
      );
    }
    correction = { reason: reason as CorrectionReason, justification };
    approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[reason as CorrectionReason]}`;
  }

  const { data: saved, error: saveErr } = await service
    .from('grade_entries')
    .upsert(
      {
        grading_sheet_id: sheetId,
        section_student_id: body.section_student_id,
        ww_excused: ww.value,
        pt_excused: pt.value,
      },
      { onConflict: 'grading_sheet_id,section_student_id' }
    )
    .select(
      'id, ww_excused, pt_excused, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade'
    )
    .single();
  if (saveErr || !saved) {
    return NextResponse.json(
      { error: saveErr?.message ?? 'save failed' },
      { status: 500 }
    );
  }

  // One audit row per component that changed.
  const changed_by = auth.user.email ?? auth.user.id;
  const diffs = (
    [
      ['ww_excused', entry?.ww_excused ?? [], ww.value],
      ['pt_excused', entry?.pt_excused ?? [], pt.value],
    ] as const
  )
    .filter(
      ([, before, after]) => JSON.stringify(before) !== JSON.stringify(after)
    )
    .map(([field, before, after]) => ({
      grading_sheet_id: sheetId,
      grade_entry_id: saved.id as string,
      changed_by,
      field_changed: field,
      old_value: JSON.stringify(before),
      new_value: JSON.stringify(after),
      approval_reference,
    }));

  if (diffs.length > 0) {
    const gradeAuditLogFailed = sheet.is_locked
      ? !(await writeAuditRows(service, diffs))
      : false;
    const whoAndWhere = {
      ...(await loadOneSheetAuditLabels(service, sheetId)),
      ...((await loadEntryStudentLabels(service, [saved.id as string])).get(
        saved.id as string
      ) ?? {}),
    };
    for (const row of diffs) {
      await logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: sheet.is_locked ? 'grade_correction' : 'entry.update',
        entityType: 'grade_entry',
        entityId: saved.id as string,
        context: {
          grading_sheet_id: sheetId,
          grade_entry_id: saved.id,
          ...whoAndWhere,
          field: row.field_changed,
          old: row.old_value,
          new: row.new_value,
          was_locked: sheet.is_locked,
          ...(sheet.is_locked ? { approval_reference } : {}),
          ...(correction
            ? {
                correction_reason: correction.reason,
                correction_justification: correction.justification,
              }
            : {}),
          ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
        },
      });
    }
  }

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));
  return NextResponse.json({ entry: saved });
}

import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { EvaluationWriteupUpsertSchema } from '@/lib/schemas/evaluation';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// PATCH /api/evaluation/writeups — upsert one writeup by (term, student).
//
// Used by the adviser roster page's manual Save as draft / Submit buttons:
//   · { writeup, submit: false }  → Save as draft (demotes a finalised one
//                                   back to draft + clears submitted_at)
//   · { writeup, submit: true }   → Submit / Resubmit (stamps submitted_at)
//   · { writeup }                 → text-only save, submitted state untouched
//
// Gate: teachers must have a form_adviser teacher_assignment on the target
// section. Registrar / school_admin / admin / superadmin are unrestricted
// (soft gate per KD #28; they can fix typos or fill gaps when the adviser
// is late). Submit is NOT a hard lock — KD #28, see plan Risk #1.
//
// Audit: one row per action — `evaluation.writeup.save` (draft save, incl. the
// un-submit demote), `evaluation.writeup.submit` (first finalise), or
// `evaluation.writeup.resubmit` (re-finalise an already-submitted write-up).
export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = EvaluationWriteupUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { termId, sectionId, studentId, writeup, submit } = parsed.data;
  const writeupProvided = 'writeup' in parsed.data;

  const service = createServiceClient();

  // Per-section gate for teachers. Non-teacher roles are trusted via
  // requireRole above.
  if (auth.role === 'teacher') {
    const { data: assignment } = await service
      .from('teacher_assignments')
      .select('id')
      .eq('teacher_user_id', auth.user.id)
      .eq('section_id', sectionId)
      .eq('role', 'form_adviser')
      .maybeSingle();
    if (!assignment) {
      return NextResponse.json(
        { error: 'You are not the form class adviser for this section.' },
        { status: 403 }
      );
    }

    // Confirm studentId (also caller-supplied) actually belongs to this
    // section's current roster — otherwise a form adviser of ANY section
    // could forge a write-up for a student in a different section (the
    // sectionId check above only proves adviser-of-sectionId, not that
    // studentId is on that roster).
    const { data: rosterRow } = await service
      .from('section_students')
      .select('id')
      .eq('section_id', sectionId)
      .eq('student_id', studentId)
      .neq('enrollment_status', 'withdrawn')
      .maybeSingle();
    if (!rosterRow) {
      return NextResponse.json(
        {
          error: 'This student is not on the current roster for this section.',
        },
        { status: 403 }
      );
    }
  }

  // Load current row (if any) to detect what changed for the audit.
  const { data: existing } = await service
    .from('evaluation_writeups')
    .select('id, writeup, submitted, submitted_at')
    .eq('term_id', termId)
    .eq('student_id', studentId)
    .maybeSingle();

  const nextWriteup = writeupProvided
    ? (writeup ?? null)
    : (existing?.writeup ?? null);
  const wasSubmitted = existing?.submitted ?? false;
  // submit:true → submitted (stamps now); submit:false → demoted back to draft
  // (Save as draft on a finalised write-up clears submitted + its timestamp);
  // undefined → leave the existing submitted state untouched.
  const nextSubmitted =
    submit === true ? true : submit === false ? false : wasSubmitted;
  const nextSubmittedAt =
    submit === true
      ? new Date().toISOString()
      : submit === false
        ? null
        : (existing?.submitted_at ?? null);

  const row = {
    term_id: termId,
    section_id: sectionId,
    student_id: studentId,
    writeup: nextWriteup,
    submitted: nextSubmitted,
    submitted_at: nextSubmittedAt,
    created_by: existing ? undefined : auth.user.id,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: upsertErr } = await service
    .from('evaluation_writeups')
    .upsert(row, { onConflict: 'term_id,student_id' })
    .select('id, writeup, submitted, submitted_at, updated_at')
    .single();
  if (upsertErr || !saved) {
    return NextResponse.json(
      { error: upsertErr?.message ?? 'save failed' },
      { status: 500 }
    );
  }

  const textChanged =
    writeupProvided && (existing?.writeup ?? null) !== nextWriteup;
  const submittedChanged = nextSubmitted !== wasSubmitted;

  // One audit row per user action — Submit / Resubmit / Save-as-draft (the
  // last covers the demote when Save-as-draft un-submits a finalised write-up).
  let action:
    | 'evaluation.writeup.submit'
    | 'evaluation.writeup.resubmit'
    | 'evaluation.writeup.save'
    | null = null;
  if (submit === true) {
    action = wasSubmitted
      ? 'evaluation.writeup.resubmit'
      : 'evaluation.writeup.submit';
  } else if (textChanged || (submit === false && wasSubmitted)) {
    action = 'evaluation.writeup.save';
  }

  if (action) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action,
      entityType: 'evaluation_writeup',
      entityId: saved.id,
      context: {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        length: nextWriteup?.length ?? 0,
        submitted: nextSubmitted,
        ...(submit === false && wasSubmitted ? { un_submitted: true } : {}),
        ...(submit === true ? { submitted_at: nextSubmittedAt } : {}),
      },
    });
  }

  if (textChanged || submittedChanged) {
    invalidateDrillTags('evaluation', await requireCurrentAyCode(service));
  }

  return NextResponse.json({
    ok: true,
    id: saved.id,
    writeup: saved.writeup,
    submitted: saved.submitted,
    submitted_at: saved.submitted_at,
    updated_at: saved.updated_at,
  });
}

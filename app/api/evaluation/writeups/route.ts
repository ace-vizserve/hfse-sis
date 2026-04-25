import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { EvaluationWriteupUpsertSchema } from '@/lib/schemas/evaluation';

// PATCH /api/evaluation/writeups — upsert one writeup by (term, student).
//
// Used by the adviser roster page for both autosave and submit:
//   · { writeup: "..." }                  → text edit (autosave)
//   · { writeup: "...", submit: true }    → save + mark submitted
//   · { submit: true }                    → just mark submitted
//
// Gate: teachers must have a form_adviser teacher_assignment on the target
// section. Registrar / school_admin / admin / superadmin are unrestricted
// (soft gate per KD #28; they can fix typos or fill gaps when the adviser
// is late). Submit is NOT a hard lock — KD #28, see plan Risk #1.
//
// Audit: `evaluation.writeup.save` on text change; `evaluation.writeup.submit`
// when `submitted` flips from false→true. Both can fire on one request.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'registrar',
    'school_admin',
    'admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = EvaluationWriteupUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
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
        { status: 403 },
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

  const nextWriteup = writeupProvided ? (writeup ?? null) : (existing?.writeup ?? null);
  const wasSubmitted = existing?.submitted ?? false;
  const nextSubmitted = submit === true ? true : wasSubmitted;
  const nextSubmittedAt =
    submit === true && !wasSubmitted
      ? new Date().toISOString()
      : existing?.submitted_at ?? null;

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
      { status: 500 },
    );
  }

  const textChanged = writeupProvided && (existing?.writeup ?? null) !== nextWriteup;
  const submitFlipped = submit === true && !wasSubmitted;

  if (textChanged) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'evaluation.writeup.save',
      entityType: 'evaluation_writeup',
      entityId: saved.id,
      context: {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        length: nextWriteup?.length ?? 0,
      },
    });
  }

  if (submitFlipped) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'evaluation.writeup.submit',
      entityType: 'evaluation_writeup',
      entityId: saved.id,
      context: {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        submitted_at: nextSubmittedAt,
      },
    });
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

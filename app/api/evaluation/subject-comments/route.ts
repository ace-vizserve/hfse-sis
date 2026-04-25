import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { SubjectCommentUpsertSchema } from '@/lib/schemas/evaluation-checklist';

// PATCH /api/evaluation/subject-comments — upsert a teacher's per-subject
// comment on a student for a term. "Comments if any" in the legacy Excel
// workbook. Never flows to the report card (KD #49) — PTC use only.
//
// Teacher gate: must have a teacher_assignment on this section (any role).
// Registrar+ unrestricted.
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
  const parsed = SubjectCommentUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, sectionId, studentId, subjectId, comment } = parsed.data;

  const service = createServiceClient();

  if (auth.role === 'teacher') {
    // Subject teachers gated to their assigned (section × subject); form
    // advisers can write any subject comment (they edit writeups too).
    const { data: assignment } = await service
      .from('teacher_assignments')
      .select('id, role, subject_id')
      .eq('teacher_user_id', auth.user.id)
      .eq('section_id', sectionId)
      .in('role', ['subject_teacher', 'form_adviser']);
    const allowed = (assignment ?? []).some(
      (a) => a.role === 'form_adviser' || a.subject_id === subjectId,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: 'Not the subject teacher for this section × subject.' },
        { status: 403 },
      );
    }
  }

  const { data: saved, error } = await service
    .from('evaluation_subject_comments')
    .upsert(
      {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        subject_id: subjectId,
        comment: comment ?? null,
        created_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'term_id,student_id,subject_id' },
    )
    .select('id')
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: error?.message ?? 'save failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.subject_comment.save',
    entityType: 'evaluation_subject_comment',
    entityId: saved.id,
    context: { term_id: termId, section_id: sectionId, student_id: studentId, subject_id: subjectId, length: comment?.length ?? 0 },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

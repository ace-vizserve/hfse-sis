import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { ChecklistResponseUpsertSchema } from '@/lib/schemas/evaluation-checklist';

// PATCH /api/evaluation/checklist-responses — upsert one tick-box state.
//
// Gate: teachers need a `subject_teacher` or `form_adviser` assignment on
// the target section. Registrar+ unrestricted (KD #28 soft gate).
//
// Audit: `evaluation.checklist_response.save`. Fires on every write (even
// no-op upserts) because the cost of a row check exceeds the cost of a
// log insert, and the audit value is low-signal anyway.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ChecklistResponseUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, sectionId, studentId, checklistItemId, isChecked } = parsed.data;

  const service = createServiceClient();

  if (auth.role === 'teacher') {
    const { data: assignment } = await service
      .from('teacher_assignments')
      .select('id')
      .eq('teacher_user_id', auth.user.id)
      .eq('section_id', sectionId)
      .limit(1)
      .maybeSingle();
    if (!assignment) {
      return NextResponse.json(
        { error: 'You have no assignment on this section.' },
        { status: 403 },
      );
    }
  }

  const { data: saved, error } = await service
    .from('evaluation_checklist_responses')
    .upsert(
      {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        checklist_item_id: checklistItemId,
        is_checked: isChecked,
        created_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'term_id,student_id,checklist_item_id' },
    )
    .select('id')
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: error?.message ?? 'save failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.checklist_response.save',
    entityType: 'evaluation_checklist_response',
    entityId: saved.id,
    context: { term_id: termId, section_id: sectionId, student_id: studentId, checklist_item_id: checklistItemId, is_checked: isChecked },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

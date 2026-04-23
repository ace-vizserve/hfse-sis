import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { PtcFeedbackUpsertSchema } from '@/lib/schemas/evaluation-checklist';

// PATCH /api/evaluation/ptc-feedback — registrar / school_admin records
// parent-teacher-conference feedback per student per term. Never flows to
// the report card (KD #49) — PTC use only.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = PtcFeedbackUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, sectionId, studentId, feedback } = parsed.data;

  const service = createServiceClient();

  const { data: saved, error } = await service
    .from('evaluation_ptc_feedback')
    .upsert(
      {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        feedback: feedback ?? null,
        created_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'term_id,student_id' },
    )
    .select('id')
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: error?.message ?? 'save failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'evaluation.ptc_feedback.save',
    entityType: 'evaluation_ptc_feedback',
    entityId: saved.id,
    context: { term_id: termId, section_id: sectionId, student_id: studentId, length: feedback?.length ?? 0 },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

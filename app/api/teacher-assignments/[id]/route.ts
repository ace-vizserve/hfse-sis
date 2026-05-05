import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';

// DELETE /api/teacher-assignments/[id] — registrar+ only.
// Removes an assignment. Now audit-logged via the generic audit_log table.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  // Load the row before deleting so we can log its shape.
  const { data: existing } = await service
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .eq('id', id)
    .maybeSingle();

  const { error } = await service.from('teacher_assignments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'assignment.delete',
    entityType: 'teacher_assignment',
    entityId: id,
    context: existing
      ? {
          teacher_user_id: existing.teacher_user_id,
          section_id: existing.section_id,
          subject_id: existing.subject_id,
          role: existing.role,
        }
      : {},
  });

  return NextResponse.json({ ok: true });
}

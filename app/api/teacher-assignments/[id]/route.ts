import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mirror of the POST route's invalidator: a teacher-assignment change busts the
// markbook / evaluation / attendance cache tags for the section's AY so the next
// dashboard/drill read is fresh (not stale until the 60s TTL). Best-effort.
async function invalidateForSection(
  service: SupabaseClient,
  sectionId: string
): Promise<void> {
  const { data } = await service
    .from('sections')
    .select('academic_year:academic_years(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();
  const rel = (
    data as {
      academic_year: { ay_code: string } | { ay_code: string }[] | null;
    } | null
  )?.academic_year;
  const ayCode = (Array.isArray(rel) ? rel[0]?.ay_code : rel?.ay_code) ?? null;
  if (!ayCode) return;
  invalidateDrillTags('markbook', ayCode);
  invalidateDrillTags('evaluation', ayCode);
  invalidateDrillTags('attendance', ayCode);
}

// DELETE /api/teacher-assignments/[id] — registrar+ only.
// Removes an assignment. Now audit-logged via the generic audit_log table.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  // Load the row before deleting so we can log its shape.
  const { data: existing } = await service
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .eq('id', id)
    .maybeSingle();

  const { error } = await service
    .from('teacher_assignments')
    .delete()
    .eq('id', id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

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

  if (existing?.section_id) {
    await invalidateForSection(service, existing.section_id);
  }

  return NextResponse.json({ ok: true });
}

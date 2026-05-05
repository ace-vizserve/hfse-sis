import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';

// GET /api/teacher-assignments?section_id=... â€” list assignments.
// Managers (registrar+) see all; any other authenticated user can request
// their own via ?mine=1 (used by teacher-facing screens later).
export async function GET(request: NextRequest) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const sectionId = request.nextUrl.searchParams.get('section_id');
  const mine = request.nextUrl.searchParams.get('mine') === '1';

  let q = supabase
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role');
  if (sectionId) q = q.eq('section_id', sectionId);
  if (mine) q = q.eq('teacher_user_id', auth.user.id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

// POST /api/teacher-assignments â€” registrar+ only.
// Body: { teacher_user_id, section_id, role, subject_id? }
// role='form_adviser' â€” subject_id must be null; unique per section.
// role='subject_teacher' â€” subject_id required; unique per (teacher, section, subject).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as
    | {
        teacher_user_id?: string;
        section_id?: string;
        subject_id?: string | null;
        role?: 'form_adviser' | 'subject_teacher';
      }
    | null;
  if (!body?.teacher_user_id || !body.section_id || !body.role) {
    return NextResponse.json(
      { error: 'teacher_user_id, section_id, role are required' },
      { status: 400 },
    );
  }
  if (body.role === 'form_adviser' && body.subject_id) {
    return NextResponse.json({ error: 'form_adviser must not have a subject_id' }, { status: 400 });
  }
  if (body.role === 'subject_teacher' && !body.subject_id) {
    return NextResponse.json({ error: 'subject_teacher requires a subject_id' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('teacher_assignments')
    .insert({
      teacher_user_id: body.teacher_user_id,
      section_id: body.section_id,
      subject_id: body.role === 'form_adviser' ? null : body.subject_id,
      role: body.role,
    })
    .select('id, teacher_user_id, section_id, subject_id, role')
    .single();

  if (error) {
    // Unique-constraint / check-constraint violations get friendly messages.
    const msg = error.message.includes('teacher_assignments_form_adviser_unique')
      ? 'This section already has a form adviser. Remove the existing one first.'
      : error.message.includes('teacher_assignments_subject_teacher_unique')
        ? 'This teacher is already assigned to this subject in this section.'
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // If we just set a form_adviser, mirror the display name onto the section
  // so the report card header shows the same name without needing a second
  // query. Best-effort â€” don't fail the insert if this lookup errors.
  if (body.role === 'form_adviser') {
    try {
      const { data: u } = await service.auth.admin.getUserById(body.teacher_user_id);
      const display =
        ((u.user?.user_metadata as Record<string, unknown> | null)?.full_name as string | undefined) ??
        u.user?.email ??
        null;
      if (display) {
        await service
          .from('sections')
          .update({ form_class_adviser: display })
          .eq('id', body.section_id);
      }
    } catch {
      // swallow â€” the assignment is authoritative
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'assignment.create',
    entityType: 'teacher_assignment',
    entityId: data.id,
    context: {
      teacher_user_id: data.teacher_user_id,
      section_id: data.section_id,
      subject_id: data.subject_id,
      role: data.role,
    },
  });

  return NextResponse.json({ assignment: data });
}

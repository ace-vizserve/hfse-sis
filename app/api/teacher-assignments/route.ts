import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type { SupabaseClient } from '@supabase/supabase-js';

// Teacher assignments scope per-section grading-sheet lists (markbook),
// evaluation sections, and attendance section drills — all `unstable_cache`d.
// A change must bust those three modules' tags for the section's AY so the
// next dashboard/drill read is fresh (not stale until the 60s TTL backstop).
// Best-effort: never fail the mutation if the AY lookup hiccups.
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

// GET /api/teacher-assignments?section_id=... â€” list assignments.
// Managers (registrar+) see all; any other authenticated user can request
// their own via ?mine=1 (used by teacher-facing screens later).
export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const sectionId = request.nextUrl.searchParams.get('section_id');
  const mine = request.nextUrl.searchParams.get('mine') === '1';

  const isManager =
    auth.role === 'registrar' ||
    auth.role === 'school_admin' ||
    auth.role === 'superadmin';

  let q = supabase
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role');
  if (sectionId) q = q.eq('section_id', sectionId);
  // Teachers always see only their own rows regardless of ?mine param.
  if (!isManager) q = q.eq('teacher_user_id', auth.user.id);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

// POST /api/teacher-assignments â€” registrar+ only.
// Body: { teacher_user_id, section_id, role, subject_id? }
// role='form_adviser' â€” subject_id must be null; unique per section.
// role='subject_teacher' â€” subject_id required; unique per (teacher, section, subject).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    teacher_user_id?: string;
    section_id?: string;
    subject_id?: string | null;
    role?: 'form_adviser' | 'subject_teacher';
  } | null;
  if (!body?.teacher_user_id || !body.section_id || !body.role) {
    return NextResponse.json(
      { error: 'teacher_user_id, section_id, role are required' },
      { status: 400 }
    );
  }
  if (body.role === 'form_adviser' && body.subject_id) {
    return NextResponse.json(
      { error: 'form_adviser must not have a subject_id' },
      { status: 400 }
    );
  }
  if (body.role === 'subject_teacher' && !body.subject_id) {
    return NextResponse.json(
      { error: 'subject_teacher requires a subject_id' },
      { status: 400 }
    );
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
    const msg = error.message.includes(
      'teacher_assignments_form_adviser_unique'
    )
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
      const { data: u } = await service.auth.admin.getUserById(
        body.teacher_user_id
      );
      const display =
        ((u.user?.user_metadata as Record<string, unknown> | null)
          ?.full_name as string | undefined) ??
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

  await invalidateForSection(service, data.section_id);

  return NextResponse.json({ assignment: data });
}

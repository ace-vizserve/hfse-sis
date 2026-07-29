import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { ClassroomNoteSchema } from '@/lib/schemas/classroom';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/classroom/[sectionId]/notes
// Body: { content: string } — upserts the CALLER'S OWN private class note
// (Classroom Settings, Phase 6; migration 094).
//
// Security-critical: `teacher_user_id` is taken ONLY from the verified
// session (`requireRole` → the JWT's `sub` claim via `auth.user.id`), NEVER
// from the request body — the request body has no such field at all
// (ClassroomNoteSchema only accepts `content`). Accepting a caller-supplied
// id would let one authenticated user overwrite another user's private
// note, defeating the entire point of migration 094's
// `teacher_user_id = auth.uid()` RLS scoping.
//
// Uses the service-role client because migration 094 denies
// insert/update/delete outright to `authenticated` — this route is the one
// sanctioned bypass, and it only ever targets the id it just verified for
// the section it just confirmed this caller has a relationship to.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { sectionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = ClassroomNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { content } = parsed.data;

  // Belt-and-braces (same pattern as every /classroom/[sectionId] page):
  // requireRole only proves a teaching-adjacent ROLE, not a relationship to
  // THIS class. A plain `teacher` with zero assignment to this section
  // holds no capability at all and is bounced here exactly as they would be
  // by the layout guard for any other classroom sub-route.
  const { capability } = await loadClassroomAccess(
    auth.role,
    auth.user.id,
    sectionId
  );
  if (!capability) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select('id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) {
    return NextResponse.json({ error: 'section not found' }, { status: 404 });
  }

  const { data: existing } = await service
    .from('classroom_notes')
    .select('content')
    .eq('section_id', sectionId)
    .eq('teacher_user_id', auth.user.id)
    .maybeSingle();
  const previousContent =
    (existing as { content: string } | null)?.content ?? '';
  const changed = previousContent !== content;

  const now = new Date().toISOString();
  const { error: upsertErr } = await service.from('classroom_notes').upsert(
    {
      section_id: sectionId,
      teacher_user_id: auth.user.id,
      content,
      updated_at: now,
    },
    { onConflict: 'section_id,teacher_user_id' }
  );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // No-op saves stay silent — mirrors app/api/evaluation/virtue-theme's
  // `changed` guard. When it IS logged, the context carries `length` only,
  // never `content` — logging the actual text into audit_log (which
  // oversight roles CAN read on the Markbook audit-log page) would defeat
  // migration 094's whole point that this note is genuinely private.
  if (changed) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'classroom.note.save',
      entityType: 'classroom_note',
      entityId: sectionId,
      context: { section_id: sectionId, length: content.length },
    });
  }

  return NextResponse.json({ content, updatedAt: now, changed });
}

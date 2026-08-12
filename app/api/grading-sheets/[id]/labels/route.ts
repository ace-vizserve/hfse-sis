import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import {
  isSubjectTeacher,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import type { SlotMeta } from '@/lib/schemas/grading-sheet';
import { logAction } from '@/lib/audit/log-action';
import { sanitizeLabel, sanitizeMeta } from '@/lib/grading/slot-label-sanitize';

// PATCH /api/grading-sheets/[id]/labels
// Updates slot_labels on a grading sheet. Teachers are blocked when the sheet
// is locked; registrar/school_admin/superadmin may label any sheet regardless
// of lock state. Teachers may only label their own sheet.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    ww?: (SlotMeta | null)[];
    pt?: (SlotMeta | null)[];
    qa?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const isManager =
    auth.role === 'academic_coordinator' ||
    auth.role === 'school_admin' ||
    auth.role === 'superadmin';

  const service = createServiceClient();

  // For teachers, verify they own the sheet (teacher_assignments subject_teacher).
  if (!isManager) {
    const supabase = await createClient();
    const { data: sheetRaw } = await supabase
      .from('grading_sheets')
      .select('id, is_locked, section:sections(id), subject:subjects(id)')
      .eq('id', id)
      .single();
    if (!sheetRaw) {
      return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
    }
    type IdRow = { id: string } | { id: string }[] | null;
    const sheet = sheetRaw as unknown as {
      is_locked: boolean;
      section: IdRow;
      subject: IdRow;
    };
    const sectionRaw = Array.isArray(sheet.section)
      ? sheet.section[0]
      : sheet.section;
    const subjectRaw = Array.isArray(sheet.subject)
      ? sheet.subject[0]
      : sheet.subject;
    const sectionId = sectionRaw?.id;
    const subjectId = subjectRaw?.id;
    if (!sectionId || !subjectId) {
      return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
    }
    // Renaming an activity is part of running the sheet, so a substitute
    // covering this slot may do it. Goes through the shared loader rather than
    // an inline query so cover is honoured here exactly as it is on the score
    // write a few files over — one answer, one place.
    const assignments = await loadEffectiveAssignmentsForUser(
      supabase,
      auth.user.id
    );
    if (!isSubjectTeacher(assignments, sectionId, subjectId)) {
      return NextResponse.json(
        { error: 'not assigned to this sheet' },
        { status: 403 }
      );
    }
    if (sheet.is_locked) {
      return NextResponse.json({ error: 'sheet is locked' }, { status: 423 });
    }
  }

  const newLabels: Record<string, unknown> = {};
  if ('ww' in body) newLabels.ww = (body.ww ?? []).map(sanitizeMeta);
  if ('pt' in body) newLabels.pt = (body.pt ?? []).map(sanitizeMeta);
  if ('qa' in body) newLabels.qa = sanitizeLabel(body.qa);

  // Merge with existing labels so a ww update doesn't wipe pt labels.
  const { data: existing } = await service
    .from('grading_sheets')
    .select('slot_labels')
    .eq('id', id)
    .single();
  if (!existing) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }

  const merged = {
    ...((existing.slot_labels as Record<string, unknown>) ?? {}),
    ...newLabels,
  };

  const { error } = await service
    .from('grading_sheets')
    .update({ slot_labels: merged })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.labels.update',
    entityType: 'grading_sheet',
    entityId: id,
  });

  return NextResponse.json({ ok: true, slot_labels: merged });
}

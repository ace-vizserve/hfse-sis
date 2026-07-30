import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';
import { SectionUpdateSchema } from '@/lib/schemas/section';

// PATCH /api/sections/[id] — rename a section.
// Fires `section.rename` audit action only when the name actually changed.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('sections.edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'section id required' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name } = parsed.data;

  if (name === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: before, error: beforeErr } = await service
    .from('sections')
    .select('id, name, academic_year_id, level_id')
    .eq('id', id)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'section not found' }, { status: 404 });
  }

  if (name === before.name) {
    return NextResponse.json({
      ok: true,
      id: before.id,
      name: before.name,
      unchanged: true,
    });
  }

  const { data: updated, error: updateErr } = await service
    .from('sections')
    .update({ name })
    .eq('id', id)
    .select('id, name')
    .single();

  if (updateErr) {
    // 23505 = unique_violation (academic_year_id, level_id, name)
    if ((updateErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: `A section named "${name}" already exists in this level for the current AY.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.rename',
    entityType: 'section',
    entityId: id,
    context: {
      academic_year_id: before.academic_year_id,
      level_id: before.level_id,
      from: before.name,
      to: name,
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, name: updated.name });
}

// DELETE /api/sections/[id] — undo an accidental creation.
//
// Only allowed when NO student has ever been enrolled here
// (`section_students` count is 0) — guaranteed by Hard Rule #6
// (grade_entries keys off section_student_id) that zero section_students
// also means zero real grade data, so this can never destroy academic
// history. A section with even one withdrawn student, or any locked
// grading sheet, stays undeletable — Rename is the fix for a typo there.
//
// `section_students`/`grading_sheets` are RESTRICT foreign keys (won't
// cascade); everything else that can reference a fresh, student-less
// section (section_subjects, teacher_assignments, evaluation_checklist_
// items, and the report-card/evaluation tables, all practically empty
// with no roster) is ON DELETE CASCADE, so deleting grading_sheets then
// the section row itself is sufficient — see delete_academic_year (KD #40)
// and the AY9999 test-env teardown for the same cascade assumption.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('sections.delete');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'section id required' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: section, error: sectionErr } = await service
    .from('sections')
    .select(
      'id, name, level_id, academic_year_id, academic_years!inner(ay_code)'
    )
    .eq('id', id)
    .maybeSingle();
  if (sectionErr) {
    return NextResponse.json({ error: sectionErr.message }, { status: 500 });
  }
  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }
  const ayJoin = section.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;

  const { count: studentCount, error: countErr } = await service
    .from('section_students')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', id);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((studentCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Can't delete — ${studentCount} student${studentCount === 1 ? ' has' : 's have'} been enrolled here. Rename it instead if this was a typo.`,
      },
      { status: 422 }
    );
  }

  // RESTRICT FK — must go before the section row itself. Guaranteed to
  // have zero grade_entries (they key off section_student_id, and the
  // guard above already confirmed zero section_students).
  const { error: sheetsErr } = await service
    .from('grading_sheets')
    .delete()
    .eq('section_id', id);
  if (sheetsErr) {
    return NextResponse.json({ error: sheetsErr.message }, { status: 500 });
  }

  const { error: deleteErr } = await service
    .from('sections')
    .delete()
    .eq('id', id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.delete',
    entityType: 'section',
    entityId: id,
    context: {
      sectionName: section.name,
      academic_year_id: section.academic_year_id,
      level_id: section.level_id,
    },
  });

  if (ayCode) invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({ ok: true, id });
}

import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { ReliefBookingSchema } from '@/lib/schemas/teacher-assignment';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/relief/book — put ONE substitute on EVERY class a teacher holds.
//
// Body: { covered_teacher_user_id, relief_teacher_user_id,
//         relief_started_on?, relief_ended_on? }
//
// WHY A SECOND WRITE PATH EXISTS ALONGSIDE PATCH /api/teacher-assignments/[id].
// Nobody arranges cover class by class. Leave gets approved and the fact is
// "Marrie is out Mon–Fri" — which is N classes, one decision, the same dates.
// The per-row control is still right for "I am looking at this class and it
// needs somebody tomorrow"; this is right for the other, more common shape.
// Mr Ace, 2026-08-24: "the relief teacher, this is what theyre for."
//
// Same capability as the per-row PATCH — `staff.manage_relief`, school admin and
// above. Arranging cover decides who may act on a class, so it stays narrower
// than editing the timetable.
//
// ⚠ NOT ATOMIC ACROSS CLASSES, and that is a deliberate, stated cost. Supabase
// gives no multi-statement transaction over PostgREST, and an RPC purely to wrap
// four UPDATEs would be a SECURITY DEFINER function to audit and maintain for a
// failure nobody has seen. Instead every class is written, the failures are
// counted, and the response says exactly which ones did not take so the caller
// can fix those rather than guessing. Silence on a partial write is the thing
// worth avoiding here, not the partial write itself.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('staff.manage_relief');
  if ('error' in auth) return auth.error;

  const parsed = ReliefBookingSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      },
      { status: 400 }
    );
  }

  const {
    covered_teacher_user_id: coveredId,
    relief_teacher_user_id: reliefId,
    relief_started_on: startedOn = null,
    relief_ended_on: endedOn = null,
  } = parsed.data;

  // null ends the whole absence — every class that teacher holds goes back to
  // them at once. Same meaning as `null` on the per-class PATCH.
  const ending = reliefId === null;

  if (!ending && coveredId === reliefId) {
    return NextResponse.json(
      { error: 'A teacher cannot cover their own classes.' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // The substitute must be a real TEACHER account. `getTeacherList()`, never
  // `getStaffDisplayNameById()` — the latter returns every auth user with an
  // email, which in this database is ~1,000 parent portal accounts, and there
  // is no FK across schemas to stop one being written here.
  if (!ending) {
    const { getTeacherList } = await import('@/lib/auth/staff-list');
    const teachers = await getTeacherList();
    if (!teachers.some((t) => t.id === reliefId)) {
      return NextResponse.json(
        {
          error:
            'Choose a teacher with an active account. Refresh the list and try again.',
        },
        { status: 400 }
      );
    }
  }

  const { data: ay } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  const ayRow = ay as { id: string; ay_code: string } | null;
  const ayId = ayRow?.id;
  if (!ayId) {
    return NextResponse.json(
      { error: 'No academic year is set as current.' },
      { status: 400 }
    );
  }

  // Only this year's classes. A teacher's rows from a closed year are history
  // and must not quietly gain a substitute.
  const { data: rows, error: readError } = await service
    .from('teacher_assignments')
    .select('id, section_id, section:sections!inner(academic_year_id)')
    .eq('teacher_user_id', coveredId)
    .eq('section.academic_year_id', ayId);

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 });
  }

  const assignments = (rows ?? []) as unknown as Array<{
    id: string;
    section_id: string;
  }>;

  if (assignments.length === 0) {
    return NextResponse.json(
      {
        error: ending
          ? 'That teacher holds no classes this year, so there is nothing to end.'
          : 'That teacher holds no classes this year, so there is nothing to cover.',
      },
      { status: 400 }
    );
  }

  const failed: string[] = [];
  const done: Array<{ id: string; sectionId: string }> = [];

  for (const a of assignments) {
    const { error } = await service
      .from('teacher_assignments')
      .update({
        relief_teacher_user_id: reliefId,
        // Ending clears the window with the name, exactly as the per-class
        // PATCH does — a window left on a class nobody covers would sit there
        // waiting to mean something.
        relief_started_on: ending ? null : startedOn,
        relief_ended_on: ending ? null : endedOn,
      })
      .eq('id', a.id);

    if (error) failed.push(a.id);
    else done.push({ id: a.id, sectionId: a.section_id });
  }

  if (done.length === 0) {
    return NextResponse.json(
      {
        error: ending
          ? 'That cover could not be ended. Nothing was changed.'
          : 'None of those classes could be covered. Nothing was changed.',
      },
      { status: 400 }
    );
  }

  // ONE audit row for the absence, not one per class. The decision was "cover
  // Marrie's classes this week"; N rows saying the same thing with different
  // ids would make the log harder to read, not more complete — and each row's
  // own id is in the context.
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: ending ? 'assignment.relief.end' : 'assignment.relief.start',
    entityType: 'teacher_assignment',
    entityId: done[0].id,
    context: {
      bulk: true,
      covered_teacher_user_id: coveredId,
      relief_teacher_user_id: reliefId,
      relief_started_on: ending ? null : startedOn,
      relief_ended_on: ending ? null : endedOn,
      assignment_ids: done.map((d) => d.id),
      classes_covered: done.length,
      classes_failed: failed.length,
    },
  });

  // Cover changes who may act on these sections, so the teaching modules' drill
  // caches would otherwise serve the wrong person's sheets for up to their 60s
  // TTL. The tags are AY-scoped, not section-scoped, so this is three calls
  // however many classes were covered — no need to loop the sections.
  if (ayRow?.ay_code) {
    invalidateDrillTags('markbook', ayRow.ay_code);
    invalidateDrillTags('evaluation', ayRow.ay_code);
    invalidateDrillTags('attendance', ayRow.ay_code);
  }

  return NextResponse.json({
    ok: true,
    covered: done.length,
    failed: failed.length,
    // Named so a partial write cannot pass for a clean one.
    partial: failed.length > 0,
  });
}

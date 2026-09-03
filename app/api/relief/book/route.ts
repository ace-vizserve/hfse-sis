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
// ATOMIC ACROSS CLASSES, as of the phase-5 query pass. This route used to write
// one UPDATE per class in a serial loop, count the failures, and report a
// partial write — a shape that needed a `done`/`failed` split, a `partial` flag
// on the response, and a paragraph here explaining why silence on a half-done
// booking was the real risk. Every class takes the SAME patch, so all of it
// collapses to one `.update(patch).in('id', ids)`: Postgres applies it to every
// matched row or to none, and the partial-write failure mode stops existing
// rather than being documented. The `done`/`failed` bookkeeping was deleted
// with it — code implying a state that can no longer occur is worse than no
// code.
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

  // The substitute must be a STAFF account — any staff role. Teaching admins
  // cover lessons here in practice, and until now this gate refused to record
  // it, so the arrangement happened off-system.
  //
  // ⚠ `getTeacherList()`, NEVER `getStaffDisplayNameById()`. The
  // latter returns every auth user with an email, which in this database is
  // ~1,000 parent portal accounts (KD #1), and there is no FK across schemas
  // to stop one being written here — a parent's uuid in this column would give
  // them the covering teacher's read on the class through the migration-117
  // RLS helpers. Widening from teachers to staff does not touch that: the
  // helper filters `role !== null`, and a parent carries no role at all.
  //
  // Disabled accounts stay out (the helper's default), deliberately
  // disagreeing with POST /api/teacher-assignments, which passes
  // `excludeDisabled: false`. The two answer different questions: there it is
  // "whose class is this?" — the name of record, who may be on long leave and
  // is still the name on the report card; here it is "who is actually taking
  // the lesson?", and a disabled account cannot sign in to enter a mark or
  // take the register.
  if (!ending) {
    const { getTeacherList } = await import('@/lib/auth/staff-list');
    const assignable = await getTeacherList();
    if (!assignable.some((t) => t.id === reliefId)) {
      // Not "refresh the list and try again", for the reason POST
      // /api/teacher-assignments spells out: the list this check reads is
      // cached on the SERVER for five minutes and shared by everyone, so a
      // refresh in the browser cannot change the answer. The account is what
      // has to change. Same cache, same helper, same 400 — the three gates say
      // the same thing.
      return NextResponse.json(
        {
          error:
            'Choose a member of staff with an active account. Check that person on the Staff page, then try again.',
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
    .select('id, section:sections!inner(academic_year_id)')
    .eq('teacher_user_id', coveredId)
    .eq('section.academic_year_id', ayId);

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 });
  }

  // `section_id` came back here too, purely to build the per-class `done` list
  // the serial loop reported on. The join stays — it is what scopes the read to
  // this academic year — but the column is gone with the loop.
  const assignments = (rows ?? []) as unknown as Array<{ id: string }>;

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

  const assignmentIds = assignments.map((a) => a.id);

  // ONE update for every class the teacher holds. The ids come from the read
  // above, which is already scoped to this teacher AND this academic year, so
  // `.in('id', …)` cannot reach a row that read did not authorise.
  const { error: writeError } = await service
    .from('teacher_assignments')
    .update({
      relief_teacher_user_id: reliefId,
      // Ending clears the window with the name, exactly as the per-class
      // PATCH does — a window left on a class nobody covers would sit there
      // waiting to mean something.
      relief_started_on: ending ? null : startedOn,
      relief_ended_on: ending ? null : endedOn,
    })
    .in('id', assignmentIds);

  if (writeError) {
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
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: ending ? 'assignment.relief.end' : 'assignment.relief.start',
    entityType: 'teacher_assignment',
    entityId: assignmentIds[0],
    context: {
      bulk: true,
      covered_teacher_user_id: coveredId,
      relief_teacher_user_id: reliefId,
      relief_started_on: ending ? null : startedOn,
      relief_ended_on: ending ? null : endedOn,
      assignment_ids: assignmentIds,
      classes_covered: assignmentIds.length,
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

  // `failed` and `partial` used to ride along here so a half-done booking
  // could not pass for a clean one. One UPDATE cannot be half-done, no caller
  // ever read either field (`components/relief/book-cover-dialog.tsx`,
  // `components/relief/end-cover-button.tsx`), and a flag that is structurally
  // always false invites someone to branch on it.
  return NextResponse.json({ ok: true, covered: assignmentIds.length });
}

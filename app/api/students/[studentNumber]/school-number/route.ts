import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SchoolStudentNumberSchema } from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/students/[studentNumber]/school-number
//
// Body: { schoolStudentNumber: string | null }
//
// Sets the number the SCHOOL uses for this child. Deliberately cannot touch
// `student_number` itself: that one must stay equal to the admissions
// studentNumber, because the student sync looks a child up by it and creates a
// SECOND child when it finds no match. Editing it from here would split a
// child in two the next time they synced. See migration 169.
//
// ⚠ `[studentNumber]` is a new dynamic segment under `app/api/students/`. Its
// only siblings are the static `sync/` routes, which Next.js resolves ahead of
// a dynamic segment — so this introduces no route conflict.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { studentNumber } = await params;

  const body = await request.json().catch(() => null);
  const parsed = SchoolStudentNumberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the number and try again.',
      },
      { status: 400 }
    );
  }
  const next = parsed.data.schoolStudentNumber;

  const service = createServiceClient();

  const { data: studentRow, error: readErr } = await service
    .from('students')
    .select('id, student_number, school_student_number, last_name, first_name')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (readErr)
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!studentRow)
    return NextResponse.json(
      { error: 'No student with that ID.' },
      { status: 404 }
    );

  const student = studentRow as {
    id: string;
    student_number: string;
    school_student_number: string | null;
    last_name: string;
    first_name: string;
  };
  const before = student.school_student_number;

  if (before === next) return NextResponse.json({ ok: true, changed: false });

  // The column is unique where present. Checking first turns a 23505 into a
  // message that names the child already holding it — which is the whole
  // question the person is asking when they hit this.
  if (next) {
    const { data: clash } = await service
      .from('students')
      .select('student_number, last_name, first_name')
      .eq('school_student_number', next)
      .neq('id', student.id)
      .maybeSingle();
    if (clash) {
      const c = clash as {
        student_number: string;
        last_name: string;
        first_name: string;
      };
      return NextResponse.json(
        {
          error: `${next} is already the school number for ${c.last_name}, ${c.first_name} (${c.student_number}).`,
        },
        { status: 409 }
      );
    }
  }

  const { error: updateErr } = await service
    .from('students')
    .update({ school_student_number: next })
    .eq('id', student.id);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const ayCode = await requireCurrentAyCode(service);

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.school_student_number.update',
    entityType: 'student',
    entityId: student.student_number,
    context: {
      ay_code: ayCode,
      student_id: student.id,
      student_number: student.student_number,
      student_name: `${student.first_name} ${student.last_name}`.trim(),
      before,
      after: next,
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('records', ayCode);

  return NextResponse.json({
    ok: true,
    changed: true,
    schoolStudentNumber: next,
  });
}

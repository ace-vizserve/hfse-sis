import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { SectionIndexSwapSchema } from '@/lib/schemas/section';
import { composeFullName } from '@/lib/sis/full-name';
import { validateSwap, type SwapCandidate } from '@/lib/sis/index-swap';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/swap-index
//
// Exchanges two students' index numbers via `swap_section_index_numbers`
// (migration 147). Body: { enrolment_a, enrolment_b } — both section_students
// ids, because the number belongs to the placement, not the person.
//
// WHY THIS ROUTE EXISTS. "Generate index" is a derivation, not an edit: it
// recomputes the whole roster from the student's name, their enrollment_date
// against the first day of the year, and the numbers burned by withdrawn rows.
// It is deterministic, so when its answer is wrong — a misspelled surname, an
// enrollment_date the sync stamped as today, a paper register that was never
// numbered by that rule — running it again returns the same wrong answer. This
// is the second lever: correct two students without touching anyone else.
//
// Auth: `sections.edit`, the same capability that gates Generate. Correcting
// one number is strictly narrower than renumbering the class, so a separate,
// tighter gate would be a gate nobody with a reason to be here could pass.
//
// Cache: invalidates the AY's operational drills — index numbers are rendered
// across rosters, mark sheets and attendance in several modules.
//
// Audit: `section.index.swap`, carrying both students with old + new numbers,
// so the log answers "which two numbers moved" without a diff.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('sections.edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing section id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SectionIndexSwapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { enrolment_a, enrolment_b } = parsed.data;

  const service = createServiceClient();

  // Resolve the section → AY, for the cache invalidation and the audit stamp.
  const { data: sectionRow, error: sectionError } = await service
    .from('sections')
    .select('name, academic_year_id, academic_years!inner(ay_code)')
    .eq('id', id)
    .single();

  if (sectionError || !sectionRow) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  const ayJoin = sectionRow.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;
  if (!ayCode) {
    return NextResponse.json(
      { error: 'Could not resolve academic year for section' },
      { status: 500 }
    );
  }
  const sectionName: string = sectionRow.name ?? id;

  // Load both rows so a bad pair is refused with a sentence the admin can act
  // on. The RPC repeats every one of these checks under SELECT ... FOR UPDATE —
  // that copy is what makes them atomic against a concurrent transfer or
  // withdrawal, this one is what makes the message readable.
  type RosterFetchRow = {
    id: string;
    section_id: string;
    index_number: number | null;
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    student:
      | { last_name: string; first_name: string; middle_name: string | null }
      | { last_name: string; first_name: string; middle_name: string | null }[]
      | null;
  };
  const { data: rawRows, error: rowsError } = await service
    .from('section_students')
    .select(
      'id, section_id, index_number, enrollment_status, student:students(last_name, first_name, middle_name)'
    )
    .in('id', [enrolment_a, enrolment_b]);

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  const toCandidate = (r: RosterFetchRow): SwapCandidate => {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    return {
      enrolmentId: r.id,
      sectionId: r.section_id,
      indexNumber: r.index_number,
      enrollmentStatus: r.enrollment_status,
      studentName: composeFullName({
        firstName: s?.first_name,
        middleName: s?.middle_name,
        lastName: s?.last_name,
      }),
    };
  };
  const candidates = ((rawRows ?? []) as RosterFetchRow[]).map(toCandidate);
  const a = candidates.find((c) => c.enrolmentId === enrolment_a);
  const b = candidates.find((c) => c.enrolmentId === enrolment_b);

  const check = validateSwap(id, a, b);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.message, code: check.reason },
      { status: 400 }
    );
  }

  const { data, error: rpcError } = await service.rpc(
    'swap_section_index_numbers',
    {
      p_section_id: id,
      p_enrolment_a: enrolment_a,
      p_enrolment_b: enrolment_b,
    }
  );

  if (rpcError) {
    console.error('[swap-index] RPC error', rpcError.message);
    // 22023 (invalid_parameter_value) is what the RPC raises for every one of
    // its own guards, and reaching one means the pair changed between the
    // friendly check above and the lock — someone withdrew or moved a student
    // while this dialog was open. That is the caller's problem, not a fault.
    //
    // The RPC's own message is NOT forwarded. It is written for whoever reads
    // the Postgres log and reads as `swap_section_index_numbers: a withdrawn
    // student's number is retired…` — a function name and a schema rule put in
    // front of a school admin. They get the sentence instead.
    const isValidation = rpcError.code === '22023';
    return NextResponse.json(
      {
        error: isValidation
          ? 'The class list changed while this was open. Close this and try again.'
          : 'Could not swap the numbers. Nothing was changed.',
        ...(isValidation ? { code: 'stale' } : {}),
      },
      { status: isValidation ? 400 : 500 }
    );
  }

  const result = data as {
    a: {
      name: string;
      student_number: string;
      old_index: number;
      new_index: number;
    };
    b: {
      name: string;
      student_number: string;
      old_index: number;
      new_index: number;
    };
  };

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'section.index.swap',
    entityType: 'section',
    entityId: id,
    context: { sectionName, ayCode, a: result.a, b: result.b },
  });

  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({ ok: true, a: result.a, b: result.b });
}

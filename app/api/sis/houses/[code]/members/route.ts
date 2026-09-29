import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentAcademicYear } from '@/lib/academic-year';
import { logActions } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { planHouseAdds } from '@/lib/house-points/member-moves';
import {
  loadEnrolledRoster,
  type RosterStudent,
} from '@/lib/house-points/queries';
import {
  HouseMemberRemoveSchema,
  HouseMembersAddSchema,
} from '@/lib/schemas/house-points';
import { houseAuditContext } from '@/lib/sis/house-audit';
import { listHouses, type HouseRow } from '@/lib/sis/houses';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// POST   /api/sis/houses/[code]/members  { ayCode, sectionStudentIds }
// DELETE /api/sis/houses/[code]/members  { ayCode, sectionStudentId }
//
// The house page's member management
// (/records/house-points/houses/[code]): put several students in this house at
// once, or take one out of it. Writes `students.house_id` — the same column,
// gate and audit row as the single-student route
// (PATCH /api/sis/students/[enroleeNumber]/house); read that route's header
// for why a house is a placement decision (ENROLMENT_PLACEMENT_WRITERS) and why
// it lives on the cross-AY `students` row.
//
// `code` is the house's stable code (H1–H4). Students are named by
// section_student id and must be ENROLLED in a class of `ayCode` — what the
// page's picker and Members table list.
//
// One `sis.house.update` audit row PER student, shaped by the shared
// houseAuditContext, so the audit log shows each child's move exactly as a
// move made from their record would, plus `source: 'house-page'`.

type Ctx = { params: Promise<{ code: string }> };

const SOURCE = 'house-page';

type Actor = { id: string; email: string | null; role: string | null };

type Resolved =
  | { error: NextResponse }
  | {
      house: HouseRow;
      houses: HouseRow[];
      ayCode: string;
      roster: RosterStudent[];
    };

/** Resolve the house by code and the AY's enrolled roster. */
async function resolve(code: string, ayCode: string): Promise<Resolved> {
  const service = createServiceClient();
  const houses = await listHouses();
  const wanted = code.trim().toUpperCase();
  const house = houses.find((h) => h.code.toUpperCase() === wanted);
  if (!house) {
    return {
      error: NextResponse.json({ error: 'House not found.' }, { status: 404 }),
    };
  }

  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (ayErr) {
    return {
      error: NextResponse.json({ error: ayErr.message }, { status: 500 }),
    };
  }
  if (!ayRow) {
    return {
      error: NextResponse.json(
        { error: 'That school year does not exist.' },
        { status: 400 }
      ),
    };
  }

  const ay = ayRow as { id: string; ay_code: string };
  const roster = await loadEnrolledRoster(ay.id);
  return { house, houses, ayCode: ay.ay_code, roster };
}

/**
 * studentNumber → enroleeNumber for the AY, so each audit row carries the same
 * entity id a move from the student's record would. Best effort: a year with
 * no admissions table, or a child with no application row, still gets an
 * audit row — keyed by null, with the student number in its context.
 */
async function enroleeNumbers(
  ayCode: string,
  studentNumbers: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (studentNumbers.length === 0) return out;
  try {
    const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    const { data, error } = await createAdmissionsClient()
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber')
      .in('studentNumber', studentNumbers);
    if (error) {
      console.error('[houses/members] enrolee lookup failed', error.message);
      return out;
    }
    for (const row of (data ?? []) as {
      enroleeNumber: string | null;
      studentNumber: string | null;
    }[]) {
      if (row.studentNumber && row.enroleeNumber)
        out.set(row.studentNumber, row.enroleeNumber);
    }
  } catch (e) {
    console.error(
      '[houses/members] enrolee lookup threw',
      e instanceof Error ? e.message : e
    );
  }
  return out;
}

/** The same tags the single-student route revalidates, for every AY shown. */
async function revalidate(ayCode: string): Promise<void> {
  const current = await getCurrentAcademicYear(createServiceClient());
  const codes = new Set([ayCode]);
  if (current?.ay_code) codes.add(current.ay_code);
  for (const code of codes) {
    revalidateTag(`sis:${code}`, 'max');
    invalidateDrillTags('records', code);
  }
}

async function audit(
  actor: Actor,
  ayCode: string,
  moves: { student: RosterStudent; after: string | null }[],
  houses: HouseRow[]
): Promise<void> {
  const nameById = new Map(houses.map((h) => [h.id, h.name]));
  const enrolees = await enroleeNumbers(
    ayCode,
    moves.map((m) => m.student.studentNumber)
  );
  await logActions(
    createServiceClient(),
    actor,
    moves.map(({ student, after }) => {
      const enroleeNumber = enrolees.get(student.studentNumber) ?? null;
      return {
        action: 'sis.house.update' as const,
        entityType: 'enrolment_application' as const,
        entityId: enroleeNumber,
        context: houseAuditContext({
          enroleeNumber,
          studentNumber: student.studentNumber,
          studentId: student.studentId,
          before: student.houseId,
          after,
          nameById,
          source: SOURCE,
        }),
      };
    })
  );
}

export async function POST(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { code } = await params;
  const parsed = HouseMembersAddSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const resolved = await resolve(code, parsed.data.ayCode);
  if ('error' in resolved) return resolved.error;
  const { house, houses, ayCode, roster } = resolved;

  const plan = planHouseAdds(roster, parsed.data.sectionStudentIds, house.id);
  if (plan.unknownIds.length > 0) {
    return NextResponse.json(
      {
        error: `Some of those students aren't enrolled in ${ayCode}. Refresh the page and try again.`,
      },
      { status: 400 }
    );
  }

  if (plan.change.length > 0) {
    const service = createServiceClient();
    const { error: updateErr } = await service
      .from('students')
      .update({ house_id: house.id })
      .in(
        'id',
        plan.change.map((s) => s.studentId)
      );
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await audit(
      { id: auth.user.id, email: auth.user.email ?? null, role: auth.role },
      ayCode,
      plan.change.map((student) => ({ student, after: house.id })),
      houses
    );
    await revalidate(ayCode);
  }

  return NextResponse.json({
    ok: true,
    changed: plan.change.length,
    skipped: plan.skipped,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { code } = await params;
  const parsed = HouseMemberRemoveSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const resolved = await resolve(code, parsed.data.ayCode);
  if ('error' in resolved) return resolved.error;
  const { house, houses, ayCode, roster } = resolved;

  const student = roster.find(
    (s) => s.sectionStudentId === parsed.data.sectionStudentId
  );
  if (!student) {
    return NextResponse.json(
      { error: `That student isn't enrolled in ${ayCode}.` },
      { status: 404 }
    );
  }
  if (student.houseId !== house.id) {
    return NextResponse.json(
      {
        error: `${student.name} is no longer in ${house.name}. Refresh the page to see their current house.`,
      },
      { status: 409 }
    );
  }

  const service = createServiceClient();
  // Conditional on the house still being this one, so a change made elsewhere
  // in the meantime is not silently undone.
  const { data: updated, error: updateErr } = await service
    .from('students')
    .update({ house_id: null })
    .eq('id', student.studentId)
    .eq('house_id', house.id)
    .select('id');
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error: `${student.name} is no longer in ${house.name}. Refresh the page to see their current house.`,
      },
      { status: 409 }
    );
  }

  await audit(
    { id: auth.user.id, email: auth.user.email ?? null, role: auth.role },
    ayCode,
    [{ student, after: null }],
    houses
  );
  await revalidate(ayCode);

  return NextResponse.json({ ok: true, changed: 1, skipped: 0 });
}

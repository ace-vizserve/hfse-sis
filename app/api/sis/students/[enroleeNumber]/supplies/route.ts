import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logActions } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { roleCan } from '@/lib/auth/permission-map';
import { ROLES } from '@/lib/auth/roles';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import {
  STUDENT_RECORD_WRITERS,
  canWriteStudentRecord,
} from '@/lib/auth/student-record';
import { getCurrentSection } from '@/lib/sis/queries';
import {
  itemIdsOf,
  loadStudentSupplies,
} from '@/lib/sis/supplies/student-list';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// /api/sis/students/[enroleeNumber]/supplies — the books & supplies tracker
// on the Admissions Supplies stage (migration 199).
//
//   GET  ?ay=AY2027                          → the student's list
//   POST { ay, itemIds, given }              → tick (given) or untick each
//                                              item, then the fresh list
//
// The list is the books for the student's current class (level + track) plus
// the supplies for their level — lib/sis/supplies/student-list.ts. No class
// yet → `{ needsClass: true }`.
//
// ⚠ TICKING NEVER TOUCHES THE STAGE. `suppliesStatus` is the stage card's to
// set; this route writes `supply_handovers` and the audit log only.

const AY_RE = /^AY\d{4}$/i;

const PostSchema = z.object({
  ay: z.string().trim().regex(AY_RE, 'Invalid academic year'),
  itemIds: z.array(z.string().uuid()).min(1).max(500),
  given: z.boolean(),
});

/**
 * enroleeNumber → studentNumber (the application row) → current class. Null
 * studentNumber means the applicant has none on file, so there is no class
 * and no handover key either.
 */
async function resolveStudent(
  ayCode: string,
  enroleeNumber: string
): Promise<
  { error: string } | { studentNumber: string | null; sectionId: string | null }
> {
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data, error } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (error) return { error: `Application lookup failed: ${error.message}` };
  const studentNumber =
    (data as { studentNumber: string | null } | null)?.studentNumber?.trim() ||
    null;
  if (!studentNumber) return { studentNumber: null, sectionId: null };
  const section = await getCurrentSection(ayCode, studentNumber);
  return { studentNumber, sectionId: section?.id ?? null };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Whoever can open the application page may read the list — the same two
  // arms its page guard uses: a student-record writer, or a holder of the
  // pre-enrolment documents read capability (read-only there).
  const auth = await requireRole(ROLES);
  if ('error' in auth) return auth.error;
  if (
    !canWriteStudentRecord(auth.role) &&
    !(await roleCan(auth.role, 'documents_pre_enrolment.read'))
  ) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { enroleeNumber } = await params;
  // Upper-cased: the class and item lookups match ay_code exactly, so
  // "ay2027" would otherwise read as "no class".
  const ayCode = (new URL(request.url).searchParams.get('ay') ?? '')
    .trim()
    .toUpperCase();
  if (!enroleeNumber.trim() || !AY_RE.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const student = await resolveStudent(ayCode, enroleeNumber);
  if ('error' in student) {
    return NextResponse.json({ error: student.error }, { status: 500 });
  }
  if (!student.studentNumber) return NextResponse.json({ needsClass: true });

  try {
    const list = await loadStudentSupplies(createServiceClient(), {
      ayCode,
      studentNumber: student.studentNumber,
      sectionId: student.sectionId,
    });
    return NextResponse.json(list);
  } catch (e) {
    console.error('[sis supplies GET]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Books and supplies lookup failed' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Same writers as the stage cards (lib/auth/student-record.ts).
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!enroleeNumber.trim() || !parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid payload',
        ...(parsed.success ? {} : { details: parsed.error.flatten() }),
      },
      { status: 400 }
    );
  }
  const { given } = parsed.data;
  const ayCode = parsed.data.ay.toUpperCase();
  const itemIds = [...new Set(parsed.data.itemIds)];

  const student = await resolveStudent(ayCode, enroleeNumber);
  if ('error' in student) {
    return NextResponse.json({ error: student.error }, { status: 500 });
  }
  if (!student.studentNumber || !student.sectionId) {
    return NextResponse.json(
      { error: "Assign a class to see this student's books and supplies." },
      { status: 422 }
    );
  }
  const studentNumber = student.studentNumber;

  const service = createServiceClient();
  const load = () =>
    loadStudentSupplies(service, {
      ayCode,
      studentNumber,
      sectionId: student.sectionId,
    });

  let before;
  try {
    before = await load();
  } catch (e) {
    console.error('[sis supplies POST]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Books and supplies lookup failed' },
      { status: 500 }
    );
  }

  // Only items on THIS student's list may be ticked — an id from another
  // level, track or year is refused outright, not skipped.
  const allowed = itemIdsOf(before);
  const foreign = itemIds.filter((id) => !allowed.has(id));
  if (foreign.length > 0) {
    return NextResponse.json(
      {
        error: "Some of these items are not on this student's list.",
        itemIds: foreign,
      },
      { status: 400 }
    );
  }

  // Already in the state asked for → nothing to write and nothing to audit.
  const titleById = new Map<string, string>();
  const givenNow = new Set<string>();
  if (!('needsClass' in before)) {
    for (const g of before.groups) {
      for (const i of g.items) {
        titleById.set(i.id, i.title);
        if (i.given) givenNow.add(i.id);
      }
    }
  }
  const changing = itemIds.filter((id) => givenNow.has(id) !== given);

  if (changing.length > 0) {
    // The rows the write actually changed. Two clicks landing together both
    // see the item as not given; only the one whose write took effect is
    // audited, so one handover never logs twice.
    let changed: string[];
    if (given) {
      const names = new Map(await getStaffDisplayNameById());
      const byName = names.get(auth.user.id) ?? auth.user.email ?? null;
      // ignoreDuplicates: a double click that lands twice keeps the first
      // handover rather than failing on the (item, student) key.
      const { data, error } = await service
        .from('supply_handovers')
        .upsert(
          changing.map((id) => ({
            item_id: id,
            student_number: studentNumber,
            given_by: auth.user.id,
            given_by_name: byName,
          })),
          { onConflict: 'item_id,student_number', ignoreDuplicates: true }
        )
        .select('item_id');
      if (error) {
        console.error('[sis supplies POST] insert failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      changed = (data ?? []).map((r) => r.item_id as string);
    } else {
      const { data, error } = await service
        .from('supply_handovers')
        .delete()
        .eq('student_number', studentNumber)
        .in('item_id', changing)
        .select('item_id');
      if (error) {
        console.error('[sis supplies POST] delete failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      changed = (data ?? []).map((r) => r.item_id as string);
    }

    await logActions(
      service,
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      changed.map((id) => ({
        action: given ? 'sis.supplies.given' : 'sis.supplies.ungiven',
        entityType: 'supply_item' as const,
        entityId: id,
        context: {
          ay_code: ayCode,
          enroleeNumber,
          studentNumber,
          title: titleById.get(id) ?? null,
        },
      }))
    );
  }

  try {
    return NextResponse.json(await load());
  } catch (e) {
    console.error(
      '[sis supplies POST] reload failed:',
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      { error: 'Books and supplies lookup failed' },
      { status: 500 }
    );
  }
}

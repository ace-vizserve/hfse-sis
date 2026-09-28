import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import {
  resolveChosenSection,
  validateSectionChoice,
} from '@/lib/sis/class-assignment';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import {
  completePlacement,
  type MidTermPayload,
  type PlacementCompletion,
} from '@/lib/sis/placement-completion';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import {
  isEnrolledApplicationStatus,
  syncOneStudent,
} from '@/lib/sync/students';

// POST /api/sis/students/[enroleeNumber]/assign-section?ay=AY2026
//
// First-time class assignment for an enrolled applicant whose admissions
// row never received a `classSection` (chronic Directus drift — the
// student is stranded outside the grading schema because syncOneStudent
// gates on both studentNumber + classSection). Writes the admissions
// row, then runs syncOneStudent so the student lands in
// `public.students` + a `section_students` row, then audits + busts
// caches. Response `{ mode: 'placed', ... }`.
//
// Class assignment is Enrolled-only (Enrolled / Enrolled (Conditional)).
// Any other status → 422. A class set early in Directus stays on the
// admissions row; the sync holds that child back until they are Enrolled
// (`NOT_ENROLLED_REASON`), and the nightly auto-sync places them then.
// A 2026-09-28 "choose a class before Enrolled" mode was built and removed
// the same day, before it was deployed
// (docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md).
//
// Differs from transfer-section: this is the not-on-a-class-list-yet path.
// If the student is already on a class list THIS AY, the registrar should
// use the transfer-section route instead — this route refuses with a 422
// pointing there. A class merely NAMED on the admissions row (Directus) is
// not that: the picked class is written over it, or, when it is the same
// class, only the sync runs.
//
// Atomicity: the admissions UPDATE happens before syncOneStudent runs.
// If sync fails the UPDATE is reverted (best-effort — the Supabase JS
// client doesn't expose multi-statement transactions) so a retry sees
// a clean state instead of a half-assigned student.

const AssignSectionBodySchema = z.object({
  sectionId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Placement, not the student record — that used to mean `admissions` was
  // deliberately excluded here (KD #51). As of 2026-09-10 admissions
  // absorbed the retired p_file_officer role along with Records, and
  // placement came with it, so ENROLMENT_PLACEMENT_WRITERS now equals
  // STUDENT_RECORD_WRITERS (four roles, not three) — see
  // lib/auth/student-record.ts. KD #51 itself (Admissions as its own module)
  // is unaffected; only the "who may place" rule once derived from it
  // changed.
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = AssignSectionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Pick a section before assigning.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const { sectionId } = parsed.data;

  const admissions = createAdmissionsClient();
  const service = createServiceClient();
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const prefix = `ay${year}`;

  // ── 1. Fetch admissions rows ──────────────────────────────────────────
  const [appsRes, statusRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber, enroleeFullName, levelApplied')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    admissions
      .from(`${prefix}_enrolment_status`)
      // `classUpdatedby` is the real column — lower-case b, as created by
      // migration 012 and frozen since. Aliased back to camelCase so the row
      // below keeps a sane key. See lib/sis/queries.ts for the other eight.
      .select(
        'enroleeNumber, classLevel, classSection, classStatus, classUpdatedDate, classUpdatedBy:classUpdatedby, applicationStatus'
      )
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
  ]);

  if (appsRes.error) {
    return NextResponse.json(
      { error: `Couldn't load the applicant: ${appsRes.error.message}` },
      { status: 500 }
    );
  }
  if (statusRes.error) {
    return NextResponse.json(
      {
        error: `Couldn't load the application status: ${statusRes.error.message}`,
      },
      { status: 500 }
    );
  }
  if (!appsRes.data || !statusRes.data) {
    return NextResponse.json(
      { error: 'Applicant not found in this academic year.' },
      { status: 404 }
    );
  }

  const appsRow = appsRes.data as {
    enroleeNumber: string;
    studentNumber: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
  };
  const statusRow = statusRes.data as {
    enroleeNumber: string;
    classLevel: string | null;
    classSection: string | null;
    classStatus: string | null;
    classUpdatedDate: string | null;
    classUpdatedBy: string | null;
    applicationStatus: string | null;
  };

  // ── 2. Pre-checks ─────────────────────────────────────────────────────
  const status = (statusRow.applicationStatus ?? '').trim();
  if (status === 'Cancelled' || status === 'Withdrawn') {
    return NextResponse.json(
      {
        error: `This applicant is ${status} — they can't be assigned to a class section.`,
      },
      { status: 422 }
    );
  }
  if (!isEnrolledApplicationStatus(status)) {
    return NextResponse.json(
      {
        error: `Only Enrolled applicants can be assigned to a class (this one is ${status || 'not set'}). They can be given a class once their application is Enrolled.`,
      },
      { status: 422 }
    );
  }

  if (!appsRow.studentNumber) {
    // A sync can't invent a student number — it's issued at parent-portal
    // submission alongside the enrolee number. Telling the registrar to run
    // one sends them somewhere that cannot help.
    return NextResponse.json(
      {
        error:
          'This applicant has no student number yet, so they can’t be added to a class roster. Student numbers are issued when the application is submitted — contact admissions support to assign one.',
      },
      { status: 422 }
    );
  }

  const existingSection =
    typeof statusRow.classSection === 'string' &&
    statusRow.classSection.trim().length > 0
      ? statusRow.classSection.trim()
      : null;

  // "Already in a class" means ON A CLASS LIST THIS YEAR — an active or
  // late-enrollee `section_students` row in one of this AY's sections. That
  // child is moved (Move student), never assigned a second time.
  //
  // ⚠ NOT "has a `students` row". This used to refuse whenever the admissions
  // row named a class and a `students` row existed — but a returning (Current)
  // child has a `students` row from last year, so a child whose row named a
  // class (Directus) and who sat in NO class this year was told "use Move
  // student", and the Class Assignment card offers no Move without a class
  // row. Stranded, with nowhere to click.
  const activeClass = await findActiveClassThisAy(
    service,
    appsRow.studentNumber,
    ayCode
  );
  if ('error' in activeClass) {
    return NextResponse.json(
      { error: `Couldn't check the student's class: ${activeClass.error}` },
      { status: 500 }
    );
  }
  if (activeClass.sectionName !== null) {
    return NextResponse.json(
      {
        error: `This student is already in ${activeClass.sectionName}. To move them, use Move student instead.`,
      },
      { status: 422 }
    );
  }

  // resyncOnly = the admissions row ALREADY names the class that was picked
  // (the chronic Directus drift: class set, never synced), so Step A has
  // nothing to write and only the sync runs. Decided by resolving the row's
  // class the way the sync does (`resolveChosenSection`) and comparing ids —
  // NOT merely by the row naming some class. When the person picked a
  // DIFFERENT class, Step A writes their pick over the row's, so the child
  // lands where they chose and the response + audit name the class they are
  // actually in. (Before 2026-09-28 any named class skipped Step A: the sync
  // then placed the child in the row's class while the response and audit
  // reported the picked one.) A row class that does not resolve simply
  // isn't the picked class.
  let resyncOnly = false;
  if (existingSection) {
    const rowClass = await resolveChosenSection(
      service,
      ayCode,
      statusRow.classLevel,
      statusRow.classSection
    );
    resyncOnly = 'sectionId' in rowClass && rowClass.sectionId === sectionId;
  }

  // ── 3. Resolve + validate target section ──────────────────────────────
  // Existence + AY match + level match + capacity re-check at write time
  // (max 50 active per section) — shared with the stage route's Enrolled-flip
  // via lib/sis/class-assignment.ts::validateSectionChoice. Runs on the
  // PICKED class in every path, resync included.
  // `exclude`: in the resync branch the admissions row already names this
  // class, so without it the child's own waiting seat would count against them.
  const validated = await validateSectionChoice(
    service,
    sectionId,
    ayCode,
    appsRow.levelApplied,
    { enroleeNumber, studentNumber: appsRow.studentNumber }
  );
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 422 });
  }
  const { section } = validated;

  // ── 4. Step A — write admissions classSection / classLevel ───────────
  // Skipped in the resync-only branch: the admissions row already names the
  // picked class, only the class list is missing it. Step B picks up from
  // there. Otherwise this writes the picked class, replacing any other class
  // the row named (kept in `statusRow` for the rollback and the audit).
  const nowIso = new Date().toISOString();
  const actorEmail = auth.user.email ?? '(unknown)';
  if (!resyncOnly) {
    const { error: assignErr } = await admissions
      .from(`${prefix}_enrolment_status`)
      .update({
        classSection: section.name,
        classLevel: section.levelLabel,
        classStatus: 'Finished',
        classUpdatedDate: nowIso,
        classUpdatedby: actorEmail,
      })
      .eq('enroleeNumber', enroleeNumber);
    if (assignErr) {
      return NextResponse.json(
        { error: `Couldn't save the class assignment: ${assignErr.message}` },
        { status: 500 }
      );
    }
  }

  // ── 5. Step B — sync to grading schema ───────────────────────────────
  const syncResult = await syncOneStudent(
    service,
    admissions,
    enroleeNumber,
    ayCode
  );
  if (!syncResult.ok) {
    // Roll back the admissions UPDATE so a retry sees a clean state —
    // but only if we actually ran the Step A UPDATE. In the resync-only
    // path we never touched the admissions row, so there's nothing to
    // roll back.
    let rollbackFailed = false;
    if (!resyncOnly) {
      // Restore the exact pre-image captured before Step A, not hardcoded blanks.
      const { error: rollbackErr } = await admissions
        .from(`${prefix}_enrolment_status`)
        .update({
          classSection: statusRow.classSection,
          classLevel: statusRow.classLevel,
          classStatus: statusRow.classStatus,
          classUpdatedDate: statusRow.classUpdatedDate,
          classUpdatedby: statusRow.classUpdatedBy,
        })
        .eq('enroleeNumber', enroleeNumber);
      if (rollbackErr) {
        rollbackFailed = true;
        console.warn(
          '[assign-section] sync failed AND rollback failed:',
          rollbackErr.message
        );
      }
    }
    const baseReason = syncResult.reason ?? syncResult.error ?? 'unknown error';
    // Only a FAILED rollback leaves something committed: the admissions row
    // now names a class the roster does not have. That is a half-written
    // placement nobody would otherwise find, so it is audited. A clean
    // rollback (or a resync that never wrote) leaves nothing to record.
    if (rollbackFailed) {
      await logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: 'sis.student.assign_section',
        entityType: 'enrolment_status',
        entityId: enroleeNumber,
        context: {
          ay_code: ayCode,
          enroleeNumber,
          studentNumber: appsRow.studentNumber,
          enroleeFullName: appsRow.enroleeFullName,
          sectionId: section.id,
          sectionName: section.name,
          levelLabel: section.levelLabel,
          partial: true,
          committed: ['admissions_class_assignment'],
          failed_step: 'roster_sync',
          sync_error: baseReason,
          rollback_failed: true,
          // What the admissions row held before, so it can be put back by hand.
          admissions_before: {
            classSection: statusRow.classSection,
            classLevel: statusRow.classLevel,
            classStatus: statusRow.classStatus,
          },
        },
      });
    }
    const tail = resyncOnly
      ? ' The admissions record was not changed.'
      : rollbackFailed
        ? ' The class assignment may still be applied on the admissions row — contact a system administrator.'
        : ' The class assignment has been reverted — please try again.';
    return NextResponse.json(
      {
        error: `Couldn't sync the student into the grading roster: ${baseReason}.${tail}`,
      },
      { status: 500 }
    );
  }

  // ── 5b. The student now has a seat ───────────────────────────────────
  // Stamp the attendance start date and work out whether they're joining
  // late. This is step 11 of HFSE's admission process, and for a student who
  // was enrolled (step 10) weeks ago it is THIS moment — not the enrolment —
  // that their register starts from.
  //
  // Runs after the sync has succeeded, so it is past the rollback point: a
  // failure here must never fail the request, and `completePlacement` is
  // best-effort by contract. Before the audit, so the audit row records what
  // actually happened.
  let midTermEnrolment: MidTermPayload | null = null;
  let placement: PlacementCompletion | null = null;
  if (
    syncResult.change === 'enrolled' ||
    syncResult.change === 'inserted' ||
    syncResult.change === 'reactivated'
  ) {
    placement = await completePlacement(service, {
      enroleeNumber,
      ayCode,
      sectionId: section.id,
    });
    midTermEnrolment = placement.midTermEnrolment;
  }

  // ── 6. Step C — audit ────────────────────────────────────────────────
  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.student.assign_section',
    entityType: 'enrolment_status',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber: appsRow.studentNumber,
      enroleeFullName: appsRow.enroleeFullName,
      sectionId: section.id,
      sectionName: section.name,
      levelLabel: section.levelLabel,
      assignedBy: actorEmail,
      syncChange: syncResult.change,
      section_student_id: placement?.sectionStudentId ?? null,
      index_number: placement?.indexNumber ?? null,
      enrollmentDateStamped: placement?.enrollmentDateStamped ?? false,
      // The start date is overwritten with today on placement — on a
      // reactivated row that replaces the earlier spell's date, so both sides
      // are kept here.
      enrollment_date_before: placement?.enrollmentDateBefore ?? null,
      enrollment_date_after: placement?.enrollmentDateAfter ?? null,
      lateEnrolleeCandidate: midTermEnrolment?.termLabel ?? null,
      // The row named a different class and this assignment replaced it.
      ...(existingSection && !resyncOnly
        ? {
            replaced_class: {
              classLevel: statusRow.classLevel,
              classSection: statusRow.classSection,
            },
          }
        : {}),
    },
  });

  // ── 7. Step D — invalidate caches ────────────────────────────────────
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({
    ok: true,
    mode: 'placed' as const,
    sectionName: section.name,
    levelLabel: section.levelLabel,
    syncChange: syncResult.change,
    // Non-null when the student is joining after the year began — the dialog
    // then asks which term they're joining, which can move their start date
    // forward to that term's first day.
    midTermEnrolment,
  });
}

/**
 * The class this student is on the list of THIS AY — an active or
 * late-enrollee `section_students` row (`ENROLLED_STATUSES`) in one of the
 * AY's sections — or `sectionName: null` when there is none. A withdrawn row
 * does not count: it is not a seat, and the sync reactivates it on placement.
 *
 * Only a failed read is an error. Guessing "not in a class" there would let a
 * child on a class list be assigned a second one.
 */
async function findActiveClassThisAy(
  service: ReturnType<typeof createServiceClient>,
  studentNumber: string,
  ayCode: string
): Promise<{ sectionName: string | null } | { error: string }> {
  const [studentRes, ayRes] = await Promise.all([
    service
      .from('students')
      .select('id')
      .eq('student_number', studentNumber)
      .maybeSingle(),
    service
      .from('academic_years')
      .select('id')
      .eq('ay_code', ayCode)
      .maybeSingle(),
  ]);
  if (studentRes.error) return { error: studentRes.error.message };
  if (ayRes.error) return { error: ayRes.error.message };
  const studentId = (studentRes.data as { id: string } | null)?.id ?? null;
  const ayId = (ayRes.data as { id: string } | null)?.id ?? null;
  // No students row = never synced, so on no class list anywhere.
  if (!studentId || !ayId) return { sectionName: null };

  // 'sections.academic_year_id' (table name, not the alias) — PostgREST
  // silently ignores an embedded filter written against the alias and
  // returns every AY's rows, which would bring last year's class back.
  const { data, error } = await service
    .from('section_students')
    .select('id, section:sections!inner(name, academic_year_id)')
    .eq('student_id', studentId)
    .in('enrollment_status', ENROLLED_STATUSES)
    .eq('sections.academic_year_id', ayId)
    .limit(1);
  if (error) return { error: error.message };
  const row = (
    (data ?? []) as unknown as Array<{
      section: { name: string } | { name: string }[] | null;
    }>
  )[0];
  if (!row) return { sectionName: null };
  const section = Array.isArray(row.section) ? row.section[0] : row.section;
  return { sectionName: section?.name ?? 'a class' };
}

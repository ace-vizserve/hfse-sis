import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole, type RequireRoleUser } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { validateSectionChoice } from '@/lib/sis/class-assignment';
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
// Two modes, decided by the application status — never by the caller
// (docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md):
//
// ── CHOOSE (any status except Enrolled / Cancelled / Withdrawn) ──────────
// A class can be chosen at any point in the application, as admissions do in
// practice. Choosing writes ONLY the admissions class columns (classLevel,
// classSection, classStatus='Finished', class updated date/by). No `students`
// or `section_students` row, no index number, no start date — the child joins
// the class when the application becomes Enrolled (the sync refuses them until
// then, `NOT_ENROLLED_REASON`). Choosing again overwrites the earlier choice:
// nothing is on a roster yet, so a change of mind costs nothing. The choice is
// still validated (level match, class exists, class not full counting other
// chosen seats) — that is the point of choosing here instead of in Directus,
// which checks none of it. Response `{ mode: 'chosen', ... }`.
//
// ── PLACE (Enrolled / Enrolled (Conditional)) ───────────────────────────
// First-time class assignment for an enrolled applicant whose admissions
// row never received a `classSection` (chronic Directus drift — the
// student is stranded outside the grading schema because syncOneStudent
// gates on both studentNumber + classSection). Writes the admissions
// row, then runs syncOneStudent so the student lands in
// `public.students` + a `section_students` row, then audits + busts
// caches. Response `{ mode: 'placed', ... }`.
//
// Cancelled / Withdrawn → 422, in both modes.
//
// Differs from transfer-section: this is the no-classSection-yet path.
// If the student already HAS a classSection, the registrar should use
// the transfer-section route instead — this route refuses with a 422
// pointing there.
//
// Atomicity (place mode): the admissions UPDATE happens before syncOneStudent runs.
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
    return chooseClass({
      auth,
      service,
      ayCode,
      prefix,
      enroleeNumber,
      sectionId,
      appsRow,
      statusRow,
    });
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

  // The 'already in a section' guard only applies when the student is also
  // present in public.students (the fully-synced state). The other case —
  // classSection set on the admissions row but no public.students row yet
  // ('not_synced' in the loader's vocabulary) — is the chronic Directus
  // drift this feature exists to recover from. We treat that as a re-sync:
  // skip the UPDATE in Step A (admissions already has the values), proceed
  // straight to syncOneStudent.
  let alreadySynced = false;
  if (existingSection && appsRow.studentNumber) {
    const { data: existingStudentRow } = await service
      .from('students')
      .select('id')
      .eq('student_number', appsRow.studentNumber)
      .maybeSingle();
    alreadySynced = existingStudentRow != null;
  }
  if (existingSection && alreadySynced) {
    return NextResponse.json(
      {
        error: `This student is already in ${existingSection}. To move them, use Move student instead.`,
      },
      { status: 422 }
    );
  }
  // resyncOnly = student already has the right admissions-side values but
  // never made it into public.students. Step A becomes a no-op; we still
  // run Step B + C + D.
  const resyncOnly = existingSection !== null && !alreadySynced;

  // ── 3. Resolve + validate target section ──────────────────────────────
  // Existence + AY match + capacity re-check at write time (Hard Rule #5 —
  // max 50 active per section) — shared with the stage route's Enrolled-flip
  // via lib/sis/class-assignment.ts::validateSectionChoice.
  // `exclude`: in the resync branch the admissions row already names this
  // class, so without it the child's own chosen seat would count against them.
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
  // Skipped in the resync-only branch: the admissions row already has
  // the correct values, only public.students is missing. Step B picks
  // up from there.
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

// ── Choose mode ────────────────────────────────────────────────────────────
// See the header. Writes the admissions class columns and nothing else.
async function chooseClass(input: {
  auth: { user: RequireRoleUser; role: Role };
  service: ReturnType<typeof createServiceClient>;
  ayCode: string;
  prefix: string;
  enroleeNumber: string;
  sectionId: string;
  appsRow: {
    studentNumber: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
  };
  statusRow: {
    classLevel: string | null;
    classSection: string | null;
    classStatus: string | null;
    applicationStatus: string | null;
  };
}) {
  const {
    auth,
    service,
    ayCode,
    prefix,
    enroleeNumber,
    sectionId,
    appsRow,
    statusRow,
  } = input;

  // A child already on a class list keeps it — this work never moves anyone
  // already on a roster (the plan's last rule; some children are in a class
  // while their application still reads Submitted). Rewriting their chosen
  // class here would leave the admissions row naming one class and the class
  // list another, so it is refused and pointed at Move student, which moves
  // both together.
  //
  // Every lookup here refuses on error rather than reading "no rows": a failed
  // read that passed as "not in a class" would overwrite the class of a child
  // who is in one — the exact thing this check exists to stop.
  const lookupFailed = (what: string, message: string) =>
    NextResponse.json(
      {
        error: `Couldn't check whether this child is already in a class (${what}: ${message}). Try again.`,
      },
      { status: 500 }
    );
  if (appsRow.studentNumber) {
    const [
      { data: studentRow, error: studentErr },
      { data: ayRow, error: ayErr },
    ] = await Promise.all([
      service
        .from('students')
        .select('id')
        .eq('student_number', appsRow.studentNumber)
        .maybeSingle(),
      service
        .from('academic_years')
        .select('id')
        .eq('ay_code', ayCode)
        .maybeSingle(),
    ]);
    if (studentErr) return lookupFailed('student', studentErr.message);
    if (ayErr) return lookupFailed('year', ayErr.message);
    const studentId = (studentRow as { id: string } | null)?.id ?? null;
    const ayId = (ayRow as { id: string } | null)?.id ?? null;
    if (studentId && !ayId) return lookupFailed('year', `${ayCode} not found`);
    if (studentId && ayId) {
      // Unaliased embedded filter — see the stage route's reversal guard for
      // why the `section:` alias would be silently ignored here.
      const { data: onRoster, error: rosterErr } = await service
        .from('section_students')
        .select('id, section:sections!inner(name, academic_year_id)')
        .eq('student_id', studentId)
        .eq('sections.academic_year_id', ayId)
        .in('enrollment_status', ENROLLED_STATUSES)
        .limit(1);
      if (rosterErr) return lookupFailed('class list', rosterErr.message);
      const current = (
        (onRoster ?? []) as unknown as Array<{
          section: { name: string } | { name: string }[] | null;
        }>
      )[0];
      if (current) {
        const section = Array.isArray(current.section)
          ? current.section[0]
          : current.section;
        return NextResponse.json(
          {
            error: `This child is already in ${section?.name ?? 'a class'}. To put them in a different class, use Move student.`,
          },
          { status: 422 }
        );
      }
    }
  }

  // Same checks as placing — level match, class exists, room left — with
  // this child's own earlier choice left out of the count, so changing their
  // mind to the same class, or away from it, is never blocked by themselves.
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

  const unchanged =
    (statusRow.classSection ?? '').trim() === section.name &&
    (statusRow.classLevel ?? '').trim() === section.levelLabel &&
    statusRow.classStatus === 'Finished';
  if (unchanged) {
    return NextResponse.json({
      ok: true,
      mode: 'chosen' as const,
      sectionName: section.name,
      levelLabel: section.levelLabel,
    });
  }

  const actorEmail = auth.user.email ?? '(unknown)';
  const admissions = createAdmissionsClient();
  const { error: writeErr } = await admissions
    .from(`${prefix}_enrolment_status`)
    .update({
      classSection: section.name,
      classLevel: section.levelLabel,
      classStatus: 'Finished',
      classUpdatedDate: new Date().toISOString(),
      classUpdatedby: actorEmail,
    })
    .eq('enroleeNumber', enroleeNumber);
  if (writeErr) {
    return NextResponse.json(
      { error: `Couldn't save the class: ${writeErr.message}` },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'sis.student.choose_section',
    entityType: 'enrolment_status',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber: appsRow.studentNumber,
      enroleeFullName: appsRow.enroleeFullName,
      applicationStatus: statusRow.applicationStatus,
      sectionId: section.id,
      sectionName: section.name,
      levelLabel: section.levelLabel,
      // A choice can overwrite an earlier one, so both sides are kept.
      before: {
        classLevel: statusRow.classLevel,
        classSection: statusRow.classSection,
        classStatus: statusRow.classStatus,
      },
      after: {
        classLevel: section.levelLabel,
        classSection: section.name,
        classStatus: 'Finished',
      },
    },
  });

  // The seat counts in every picker for this year just changed.
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({
    ok: true,
    mode: 'chosen' as const,
    sectionName: section.name,
    levelLabel: section.levelLabel,
  });
}

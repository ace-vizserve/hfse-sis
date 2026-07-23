import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { validateSectionChoice } from '@/lib/sis/class-assignment';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { syncOneStudent } from '@/lib/sync/students';

// POST /api/sis/students/[enroleeNumber]/assign-section?ay=AY2026
//
// First-time class assignment for an enrolled applicant whose admissions
// row never received a `classSection` (chronic Directus drift — the
// student is stranded outside the grading schema because syncOneStudent
// gates on both studentNumber + classSection). Writes the admissions
// row, then runs syncOneStudent so the student lands in
// `public.students` + a `section_students` row, then audits + busts
// caches.
//
// Differs from transfer-section: this is the no-classSection-yet path.
// If the student already HAS a classSection, the registrar should use
// the transfer-section route instead — this route refuses with a 422
// pointing there.
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
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
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
      .select(
        'enroleeNumber, classLevel, classSection, classStatus, classUpdatedDate, classUpdatedBy, applicationStatus'
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
  if (!appsRow.studentNumber) {
    return NextResponse.json(
      {
        error:
          'This applicant has no student number yet. Run a student sync first so the grading roster can pick them up.',
      },
      { status: 422 }
    );
  }

  const status = (statusRow.applicationStatus ?? '').trim();
  if (status !== 'Enrolled' && status !== 'Enrolled (Conditional)') {
    if (status === 'Cancelled' || status === 'Withdrawn') {
      return NextResponse.json(
        {
          error: `This applicant is ${status} — they can't be assigned to a class section.`,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      {
        error: `Only Enrolled applicants can be assigned to a class section (this one is ${status || 'unset'}).`,
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
  const validated = await validateSectionChoice(
    service,
    sectionId,
    ayCode,
    appsRow.levelApplied
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
        classUpdatedBy: actorEmail,
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
          classUpdatedBy: statusRow.classUpdatedBy,
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

  // ── 6. Step C — audit ────────────────────────────────────────────────
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
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
    },
  });

  // ── 7. Step D — invalidate caches ────────────────────────────────────
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({
    ok: true,
    sectionName: section.name,
    levelLabel: section.levelLabel,
    syncChange: syncResult.change,
  });
}

import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { EnrolmentMetadataSchema } from '@/lib/schemas/enrolment';
import {
  getEnrolmentPosition,
  getTermForDate,
  loadTermsForAY,
} from '@/lib/sis/terms';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sections/[id]/students/[enrolmentId]
//
// Edits per-enrolment metadata:
//   - bus_no                  (display-only sheet header)
//   - classroom_officer_role  (HAPI HAUS etc.)
//   - enrollment_status       ('active' | 'late_enrollee' | 'withdrawn')
//
// Doesn't change index_number (immutable per KD) or the underlying student row
// (edit those via /markbook/sync-students or /records/students/[enroleeNumber]).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; enrolmentId: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId, enrolmentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = EnrolmentMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Load before state for the audit diff + section sanity-check. Includes
  // enrollment_date so the late-enrollee transition can detect whether to
  // refresh it (and resolve the joining term).
  const { data: before, error: loadErr } = await service
    .from('section_students')
    .select(
      'id, section_id, bus_no, classroom_officer_role, enrollment_status, enrollment_date, withdrawal_date, withdrawal_reason, withdrawal_notes, late_enrollee_term_number'
    )
    .eq('id', enrolmentId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'enrolment not found' }, { status: 404 });
  if (before.section_id !== sectionId) {
    return NextResponse.json(
      { error: 'enrolment does not belong to that section' },
      { status: 400 }
    );
  }

  // Section AY (used by the late-enrollee enrollment_date derivation + audit).
  const { data: secAyRow } = await service
    .from('sections')
    .select('academic_year:academic_years!inner(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();
  const secAy = (
    secAyRow as {
      academic_year: { ay_code: string } | { ay_code: string }[];
    } | null
  )?.academic_year;
  const sectionAyCode =
    (Array.isArray(secAy) ? secAy[0]?.ay_code : secAy?.ay_code) ?? null;

  // Flag set inside the withdrawal cascade when the admissions row already
  // has a terminal reason — lets us skip overwriting it and record why.
  let terminalCascadeSkipped = false;

  // Build the update payload. Only touch fields actually provided.
  const patch: Record<string, unknown> = {};
  if ('bus_no' in parsed.data) patch.bus_no = parsed.data.bus_no;
  if ('classroom_officer_role' in parsed.data) {
    patch.classroom_officer_role = parsed.data.classroom_officer_role;
  }
  // Track whether we just transitioned INTO late_enrollee so the response
  // can carry the resolved term back to the UI for the success toast.
  let lateEnrolleeTransition = false;
  if (parsed.data.enrollment_status !== undefined) {
    patch.enrollment_status = parsed.data.enrollment_status;
    // Bookkeeping: when transitioning to/from 'withdrawn', manage withdrawal_date.
    if (
      parsed.data.enrollment_status === 'withdrawn' &&
      !before.withdrawal_date
    ) {
      patch.withdrawal_date = new Date().toISOString().slice(0, 10);
      // Persist structured withdrawal reason + notes on the → withdrawn boundary.
      patch.withdrawal_reason = parsed.data.withdrawal_reason ?? null;
      patch.withdrawal_notes = parsed.data.withdrawal_notes ?? null;
    } else if (
      parsed.data.enrollment_status !== 'withdrawn' &&
      before.withdrawal_date
    ) {
      // Reactivation: only clear withdrawal_date. Withdrawal reason + notes are
      // intentionally preserved so the audit history stays intact.
      patch.withdrawal_date = null;
    }
    // Late-enrollee transition: refresh enrollment_date to today so the
    // joining-term lookup reflects when the registrar actually tagged the
    // student as a late enrollee (not the row's original creation date).
    // Only fires on the boundary (active → late_enrollee), not on idempotent
    // re-saves, so the date stays stable once set.
    if (parsed.data.enrollment_status === 'late_enrollee') {
      if (parsed.data.late_enrollee_term_number !== undefined) {
        patch.late_enrollee_term_number =
          parsed.data.late_enrollee_term_number ?? null;
      }
      if (before.enrollment_status !== 'late_enrollee') {
        // Derive the joining date from the chosen term: today when the chosen
        // term contains today ("join current"), else that term's start date
        // ("start next term" — they begin fresh, attendance prorates from there).
        const today = new Date().toISOString().slice(0, 10);
        let stampDate = today;
        const chosenTermN = parsed.data.late_enrollee_term_number ?? null;
        if (chosenTermN != null && sectionAyCode) {
          const terms = await loadTermsForAY(sectionAyCode);
          const chosen = terms.find((t) => t.termNumber === chosenTermN);
          if (chosen && chosen.startDate > today) stampDate = chosen.startDate;
        }
        patch.enrollment_date = stampDate;
        lateEnrolleeTransition = true;
      }
    }
  }

  // Standalone late_enrollee_term_number correction: the registrar is correcting
  // the term without changing enrollment_status (student is already late_enrollee).
  if (
    parsed.data.late_enrollee_term_number !== undefined &&
    parsed.data.enrollment_status === undefined &&
    before.enrollment_status === 'late_enrollee'
  ) {
    patch.late_enrollee_term_number =
      parsed.data.late_enrollee_term_number ?? null;
  }

  // Standalone withdrawal reason/notes correction: the row is already withdrawn
  // and the registrar is correcting the reason without changing status.
  if (
    parsed.data.withdrawal_reason !== undefined &&
    parsed.data.enrollment_status === undefined &&
    before.enrollment_status === 'withdrawn'
  ) {
    patch.withdrawal_reason = parsed.data.withdrawal_reason ?? null;
    patch.withdrawal_notes = parsed.data.withdrawal_notes ?? null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await service
    .from('section_students')
    .update(patch)
    .eq('id', enrolmentId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Resolve the joining term for late-enrollee transitions so the audit
  // trail records "Tagged as late enrollee · T2" — and so the response can
  // carry the term back for the EnrolmentEditSheet's success toast.
  let lateEnrolleeTerm: { termNumber: number; termLabel: string } | null = null;
  if (lateEnrolleeTransition) {
    // Need the section's AY to look up terms.
    const { data: secRow } = await service
      .from('sections')
      .select('academic_year:academic_years!inner(ay_code)')
      .eq('id', sectionId)
      .maybeSingle();
    const ay = (
      secRow as {
        academic_year: { ay_code: string } | { ay_code: string }[];
      } | null
    )?.academic_year;
    const ayCode = Array.isArray(ay) ? ay[0]?.ay_code : ay?.ay_code;
    if (ayCode) {
      lateEnrolleeTerm = await getTermForDate(
        new Date().toISOString().slice(0, 10),
        ayCode,
        service
      );
    }
  }

  const isReEnrolment =
    before.enrollment_status === 'withdrawn' &&
    parsed.data.enrollment_status !== undefined &&
    parsed.data.enrollment_status !== 'withdrawn';

  // Reverse cascade: when the registrar flips this row to 'withdrawn' from
  // an active state, propagate to admissions so the applicationStatus also
  // becomes 'Withdrawn'. The UI confirms this in an AlertDialog before
  // calling, so the cascade is intentional — no ambiguity vs transfer.
  // Idempotent: re-saves of an already-withdrawn row don't re-cascade
  // because the boundary check requires before !== 'withdrawn'.
  let admissionsCascade: { enroleeNumber: string; ayCode: string } | null =
    null;
  if (
    parsed.data.enrollment_status === 'withdrawn' &&
    before.enrollment_status !== 'withdrawn'
  ) {
    // Resolve enroleeNumber + ayCode for this section_students row.
    const { data: ctxRow } = await service
      .from('section_students')
      .select(
        'enrolee_number, student:students!inner(student_number), section:sections!inner(academic_year:academic_years!inner(ay_code))'
      )
      .eq('id', enrolmentId)
      .maybeSingle();
    type CtxShape = {
      enrolee_number: string | null;
      student:
        | { student_number: string | null }
        | { student_number: string | null }[]
        | null;
      section:
        | { academic_year: { ay_code: string } | { ay_code: string }[] | null }
        | {
            academic_year: { ay_code: string } | { ay_code: string }[] | null;
          }[]
        | null;
    };
    const ctx = ctxRow as CtxShape | null;
    const enroleeNumber = ctx?.enrolee_number ?? null;
    const sectionNode = ctx
      ? Array.isArray(ctx.section)
        ? ctx.section[0]
        : ctx.section
      : null;
    const ayNode = sectionNode
      ? Array.isArray(sectionNode.academic_year)
        ? sectionNode.academic_year[0]
        : sectionNode.academic_year
      : null;
    const ayCode = ayNode?.ay_code ?? null;

    if (enroleeNumber && ayCode) {
      const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
      const admissions = createAdmissionsClient();
      const todayIso = new Date().toISOString();
      const actorEmail = auth.user.email ?? '(unknown)';

      // Fetch current admissions terminal reason before overwriting so we
      // can skip writing over an already-set reason (e.g. admissions team
      // already marked the student Cancelled with a reason before the SIS
      // withdrawal was recorded).
      const { data: currentAdmRow } = await admissions
        .from(
          `${prefix}_enrolment_status` as Parameters<typeof admissions.from>[0]
        )
        .select('"applicationTerminalReason"')
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle();

      const admissionsAlreadyTerminal =
        (
          currentAdmRow as {
            applicationTerminalReason: string | null;
          } | null
        )?.applicationTerminalReason != null;

      if (admissionsAlreadyTerminal) {
        terminalCascadeSkipped = true;
      }

      const statusUpdate: Record<string, unknown> = {
        applicationStatus: 'Withdrawn',
        applicationUpdatedDate: todayIso,
        applicationUpdatedBy: actorEmail,
      };
      // Only write the reason to admissions when none is already recorded.
      if (!admissionsAlreadyTerminal && parsed.data.withdrawal_reason) {
        statusUpdate.applicationTerminalReason = parsed.data.withdrawal_reason;
        statusUpdate.applicationTerminalNotes =
          parsed.data.withdrawal_notes ?? null;
      }

      const { error: admErr } = await admissions
        .from(
          `${prefix}_enrolment_status` as Parameters<typeof admissions.from>[0]
        )
        .update(statusUpdate)
        .eq('enroleeNumber', enroleeNumber);
      if (admErr) {
        console.warn(
          '[enrolment PATCH] admissions cascade failed:',
          admErr.message
        );
      } else {
        admissionsCascade = { enroleeNumber, ayCode };
        await logAction({
          service,
          actor: { id: auth.user.id, email: auth.user.email ?? null },
          action: 'student.withdrawal.cascade',
          entityType: 'enrolment_status',
          entityId: enroleeNumber,
          context: {
            ay_code: ayCode,
            trigger: 'section_student.withdrawn',
            enroleeNumber,
            section_student_id: enrolmentId,
            section_id: sectionId,
            applicationStatus_after: 'Withdrawn',
            ...(terminalCascadeSkipped
              ? { terminalCascadeSkipped: 'admissions-already-terminal' }
              : {}),
          },
        });
      }
    }
  }

  // Re-enrolment cascade: before='withdrawn' → after NOT 'withdrawn'.
  // Reverse the admissions cascade: flip applicationStatus back to 'Enrolled'
  // and clear withdrawal_date (already cleared in patch above).
  let reEnrolmentCascade: { enroleeNumber: string; ayCode: string } | null =
    null;
  if (isReEnrolment) {
    const { data: reCtxRow } = await service
      .from('section_students')
      .select(
        'enrolee_number, student:students!inner(student_number), section:sections!inner(academic_year:academic_years!inner(ay_code))'
      )
      .eq('id', enrolmentId)
      .maybeSingle();
    type ReCtxShape = {
      enrolee_number: string | null;
      student:
        | { student_number: string | null }
        | { student_number: string | null }[]
        | null;
      section:
        | { academic_year: { ay_code: string } | { ay_code: string }[] | null }
        | {
            academic_year: { ay_code: string } | { ay_code: string }[] | null;
          }[]
        | null;
    };
    const reCtx = reCtxRow as ReCtxShape | null;
    const reEnroleeNumber = reCtx?.enrolee_number ?? null;
    const reSectionNode = reCtx
      ? Array.isArray(reCtx.section)
        ? reCtx.section[0]
        : reCtx.section
      : null;
    const reAyNode = reSectionNode
      ? Array.isArray(reSectionNode.academic_year)
        ? reSectionNode.academic_year[0]
        : reSectionNode.academic_year
      : null;
    const reAyCode = reAyNode?.ay_code ?? null;

    if (reEnroleeNumber && reAyCode) {
      const rePrefix = `ay${reAyCode.replace(/^AY/i, '').toLowerCase()}`;
      const reAdmissions = createAdmissionsClient();
      const reNow = new Date().toISOString();
      const { error: reErr } = await reAdmissions
        .from(`${rePrefix}_enrolment_status`)
        .update({
          applicationStatus: 'Enrolled',
          applicationUpdatedDate: reNow,
          applicationUpdatedBy: auth.user.email ?? '(unknown)',
        })
        .eq('enroleeNumber', reEnroleeNumber);
      if (reErr) {
        console.warn(
          '[enrolment PATCH] re-enrolment cascade failed:',
          reErr.message
        );
      } else {
        reEnrolmentCascade = {
          enroleeNumber: reEnroleeNumber,
          ayCode: reAyCode,
        };
        await logAction({
          service,
          actor: { id: auth.user.id, email: auth.user.email ?? null },
          action: 'student.reenrolment.cascade',
          entityType: 'enrolment_status',
          entityId: reEnroleeNumber,
          context: {
            ay_code: reAyCode,
            trigger: 'section_student.re-enrolled',
            enroleeNumber: reEnroleeNumber,
            section_student_id: enrolmentId,
            section_id: sectionId,
            applicationStatus_after: 'Enrolled',
          },
        });
      }
    }
  }

  // Primary audit log — placed after the cascade so terminalCascadeSkipped is
  // accurate (the cascade sets it when it discovers an existing terminal reason).
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'enrolment.metadata.update',
    entityType: 'section_student',
    entityId: enrolmentId,
    context: {
      section_id: sectionId,
      before: {
        bus_no: before.bus_no ?? null,
        classroom_officer_role: before.classroom_officer_role ?? null,
        enrollment_status: before.enrollment_status,
      },
      after: patch,
      ...(lateEnrolleeTransition
        ? {
            lateEnrolleeTransition: true,
            lateEnrolleeTransitionAt: new Date().toISOString(),
            lateEnrolleeTermNumber: lateEnrolleeTerm?.termNumber ?? null,
            lateEnrolleeTermLabel: lateEnrolleeTerm?.termLabel ?? null,
          }
        : {}),
      ...(parsed.data.enrollment_status === 'withdrawn' &&
      (parsed.data.withdrawal_reason || parsed.data.withdrawal_notes)
        ? {
            withdrawal_reason: parsed.data.withdrawal_reason ?? null,
            withdrawal_notes: parsed.data.withdrawal_notes ?? null,
          }
        : {}),
      ...(parsed.data.withdrawal_reason !== undefined
        ? {
            withdrawalReason: parsed.data.withdrawal_reason,
            withdrawalNotes: parsed.data.withdrawal_notes ?? null,
          }
        : {}),
      ...(parsed.data.late_enrollee_term_number !== undefined
        ? { lateEnrolleeTermOverride: parsed.data.late_enrollee_term_number }
        : {}),
      ...(terminalCascadeSkipped
        ? { terminalCascadeSkipped: 'admissions-already-terminal' }
        : {}),
      ...(isReEnrolment ? { reEnrolment: true } : {}),
    },
  });

  // Resolve the section's AY so we invalidate the right operational drills.
  // Reuse the join we already do on late-enrollee transitions; cheap when not.
  const { data: ayLookup } = await service
    .from('sections')
    .select('academic_year:academic_years!inner(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();
  const ayLookupRow = (
    ayLookup as {
      academic_year: { ay_code: string } | { ay_code: string }[];
    } | null
  )?.academic_year;
  const ayCodeForInvalidate = Array.isArray(ayLookupRow)
    ? ayLookupRow[0]?.ay_code
    : ayLookupRow?.ay_code;
  if (ayCodeForInvalidate) {
    invalidateAllOperationalDrills(ayCodeForInvalidate);
  }

  // Detect mid-term on re-enrolment so the client can prompt the registrar
  // to mark as late_enrollee. Only fires when a previously-withdrawn student
  // was re-enrolled as 'active' (not 'late_enrollee' — the user already made
  // the tagging choice explicitly in that case, checked via lateEnrolleeTransition).
  let midTermEnrolment: {
    termNumber: number;
    termLabel: string;
    sectionId: string;
    sectionStudentId: string;
  } | null = null;
  if (isReEnrolment && !lateEnrolleeTransition && ayCodeForInvalidate) {
    const pos = await getEnrolmentPosition(ayCodeForInvalidate);
    if (pos.isLateEnrollee && pos.activeTerm) {
      midTermEnrolment = {
        termNumber: pos.activeTerm.termNumber,
        termLabel: `T${pos.activeTerm.termNumber}`,
        sectionId,
        sectionStudentId: enrolmentId,
      };
    }
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    ...(lateEnrolleeTransition
      ? { lateEnrolleeTerm: lateEnrolleeTerm ?? null }
      : {}),
    admissionsCascade,
    ...(isReEnrolment ? { reEnrolment: true, reEnrolmentCascade } : {}),
    midTermEnrolment,
  });
}

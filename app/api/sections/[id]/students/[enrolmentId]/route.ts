import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { EnrolmentMetadataSchema } from '@/lib/schemas/enrolment';
import {
  getEnrolmentPosition,
  getTermForDate,
  loadTermsForAY,
} from '@/lib/sis/terms';
import { stampEnrolledAtIfNull } from '@/lib/sis/enrolled-at';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';

// Shape of the joined student node when name columns are selected, used by both
// the withdrawal + re-enrolment cascade context queries.
type StudentNameShape = {
  student_number: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
};

// Build a display name ("First Middle Last") from a joined student node
// (handles PostgREST returning the relation as an object or a single-element
// array). Returns '' when no name parts are available.
function studentNameFromNode(
  node: StudentNameShape | StudentNameShape[] | null
): string {
  const s = Array.isArray(node) ? node[0] : node;
  if (!s) return '';
  return [s.first_name, s.middle_name, s.last_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

// Pure helper — builds the payload written to `ay{YY}_enrolment_status` when a
// student is withdrawn post-enrolment.
//
// applicationStatus is the application OUTCOME (append-only) — current state
// lives on section_students.enrollment_status. Do NOT cascade a terminal status
// here; the application succeeded (the student enrolled) and that fact must
// never be overwritten by a subsequent academic event.
export function buildWithdrawalAdmissionsPatch({
  actorEmail,
  todayIso,
  admissionsAlreadyTerminal,
  withdrawalReason,
  withdrawalNotes,
}: {
  actorEmail: string;
  todayIso: string;
  admissionsAlreadyTerminal: boolean;
  withdrawalReason?: string | null;
  withdrawalNotes?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    applicationUpdatedDate: todayIso,
    applicationUpdatedBy: actorEmail,
  };
  // Only write the reason to admissions when none is already recorded.
  if (!admissionsAlreadyTerminal && withdrawalReason) {
    patch.applicationTerminalReason = withdrawalReason;
    patch.applicationTerminalNotes = withdrawalNotes ?? null;
  }
  return patch;
}

// PATCH /api/sections/[id]/students/[enrolmentId]
//
// Edits per-enrolment metadata:
//   - bus_no                  (display-only sheet header)
//   - classroom_officer_role  (HAPI HAUS etc.)
//   - enrollment_status       ('active' | 'late_enrollee' | 'withdrawn')
//
// Doesn't change index_number (immutable per KD) or the underlying student row
// (edit those via /records/students/[enroleeNumber]; POST /api/students/sync
// is kept as an admin/script escape hatch — no UI trigger since the sync
// page was removed, KD #154).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; enrolmentId: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
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

  // Per-field write gate: admin_notes is school_admin/superadmin only. The
  // broader route-level requireRole union above already covers everything
  // else, including academics_notes (academic_coordinator + school_admin +
  // superadmin). Checked before any DB access so a forbidden field never
  // reaches the update.
  const isAdminRole =
    auth.role === 'school_admin' || auth.role === 'superadmin';
  if ('admin_notes' in parsed.data && !isAdminRole) {
    return NextResponse.json(
      {
        error: 'admin_notes is editable by school_admin or superadmin only',
        code: 'field_forbidden',
      },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  // Load before state for the audit diff + section sanity-check. Includes
  // enrollment_date so the late-enrollee transition can detect whether to
  // refresh it (and resolve the joining term).
  const { data: before, error: loadErr } = await service
    .from('section_students')
    .select(
      'id, section_id, bus_no, classroom_officer_role, academics_notes, admin_notes, enrollment_status, enrollment_date, withdrawal_date, withdrawal_reason, withdrawal_notes, late_enrollee_term_number'
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

  // Set when a T1 late enrollee is converted back to a normal (active) enrollee
  // — drives the audit context line. revertReason is audit-only.
  let lateEnrolleeReverted = false;
  let revertReason: string | null = null;

  // Build the update payload. Only touch fields actually provided.
  const patch: Record<string, unknown> = {};
  if ('bus_no' in parsed.data) patch.bus_no = parsed.data.bus_no;
  if ('classroom_officer_role' in parsed.data) {
    patch.classroom_officer_role = parsed.data.classroom_officer_role;
  }
  if ('academics_notes' in parsed.data)
    patch.academics_notes = parsed.data.academics_notes;
  if ('admin_notes' in parsed.data) patch.admin_notes = parsed.data.admin_notes;
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
      patch.withdrawal_date = sgToday();
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
        const today = sgToday();
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

  // Convert late enrollee → normal (active). T1-only, requires a reason, clears
  // the late-term tag, and NEVER touches enrollment_date (KD #117 / spec
  // 2026-06-12). enrollment_date staying put means the attendance rollup is
  // unchanged + no recompute fires (the guard below requires 'enrollment_date'
  // in patch). For T2–T4 the UI disables this; this is the server backstop.
  if (
    before.enrollment_status === 'late_enrollee' &&
    parsed.data.enrollment_status === 'active'
  ) {
    let lateTermNumber =
      (before.late_enrollee_term_number as number | null) ?? null;
    if (lateTermNumber == null && before.enrollment_date && sectionAyCode) {
      const derived = await getTermForDate(
        before.enrollment_date as string,
        sectionAyCode,
        service
      );
      lateTermNumber = derived?.termNumber ?? null;
    }
    if (lateTermNumber !== 1) {
      return NextResponse.json(
        {
          error: 'Only a Term 1 late enrollee can be converted to normal.',
          code: 'late_revert_not_t1',
        },
        { status: 422 }
      );
    }
    revertReason = parsed.data.lateRevertReason ?? null;
    if (!revertReason) {
      return NextResponse.json(
        {
          error: 'A reason is required to convert a late enrollee to normal.',
          code: 'reason_required',
        },
        { status: 422 }
      );
    }
    // Drop the late-only classification tag. enrollment_status is already staged
    // to 'active' above; enrollment_date is intentionally left untouched.
    patch.late_enrollee_term_number = null;
    lateEnrolleeReverted = true;
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

  // Idempotency guard. The provided fields (enrollment_status,
  // late_enrollee_term_number, …) are staged into `patch` even when the registrar
  // re-saves the SAME value — e.g. re-marking an already-`late_enrollee` row — so
  // an empty-key check alone isn't enough. Compare each staged field against
  // `before`; when nothing actually changed, return a no-op BEFORE the update,
  // audit, and cascades. Without this, repeat saves pile up redundant
  // `enrolment.metadata.update` audit rows (and movement-feed noise). The
  // late-enrollee transition flag is already boundary-guarded, so a genuine
  // active→late_enrollee change still has a differing enrollment_status here and
  // proceeds normally.
  const meaningfulChange = Object.keys(patch).some(
    (k) => (before as Record<string, unknown>)[k] !== patch[k]
  );
  if (!meaningfulChange) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await service
    .from('section_students')
    .update(patch)
    .eq('id', enrolmentId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Re-prorate attendance when enrollment_date actually changed.
  //
  // The recompute_attendance_rollup RPC (KD #113, migration 068) filters
  // attendance_daily to `date >= enrollment_date` before counting school
  // days / present / absent — so a changed enrollment_date changes proration
  // for EVERY term, not just one. Nothing else re-runs the rollups on a date
  // edit, so a wrongly-prorated student would stay wrong until the next
  // attendance write. Fire the same recompute the attendance writer uses,
  // once per term in this section's AY. Only on a real change (compare to the
  // prior value) — idempotent re-saves don't re-prorate. Non-fatal: the edit
  // already committed, so a rollup hiccup is warned, never 500'd.
  let attendanceRecomputed = false;
  let attendanceRecomputeTermCount = 0;
  const enrollmentDateChanged =
    'enrollment_date' in patch &&
    (patch.enrollment_date ?? null) !== (before.enrollment_date ?? null);
  if (enrollmentDateChanged && sectionAyCode) {
    try {
      const { data: ayRow } = await service
        .from('academic_years')
        .select('id')
        .eq('ay_code', sectionAyCode)
        .maybeSingle();
      const ayId = (ayRow as { id: string } | null)?.id ?? null;
      if (ayId) {
        const { data: termRows } = await service
          .from('terms')
          .select('id')
          .eq('academic_year_id', ayId);
        const termIds = ((termRows as { id: string }[] | null) ?? []).map(
          (t) => t.id
        );
        for (const termId of termIds) {
          const { error: rollupErr } = await service.rpc(
            'recompute_attendance_rollup',
            { p_term_id: termId, p_section_student_id: enrolmentId }
          );
          if (rollupErr) {
            console.warn(
              `[enrolment PATCH] attendance rollup recompute failed for term ${termId}:`,
              rollupErr.message
            );
            continue;
          }
          attendanceRecomputeTermCount += 1;
        }
        attendanceRecomputed = attendanceRecomputeTermCount > 0;
      }
    } catch (e) {
      console.warn(
        '[enrolment PATCH] attendance re-proration skipped:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  // Resolve the joining term for the audit trail + success toast. Prefer the
  // registrar's explicit choice; only derive from today when none was given.
  let lateEnrolleeTerm: { termNumber: number; termLabel: string } | null = null;
  if (lateEnrolleeTransition) {
    const chosenN = parsed.data.late_enrollee_term_number ?? null;
    if (chosenN != null) {
      lateEnrolleeTerm = { termNumber: chosenN, termLabel: `T${chosenN}` };
    } else if (sectionAyCode) {
      lateEnrolleeTerm = await getTermForDate(
        sgToday(),
        sectionAyCode,
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
        'enrolee_number, student:students!inner(student_number, first_name, last_name, middle_name), section:sections!inner(academic_year:academic_years!inner(ay_code))'
      )
      .eq('id', enrolmentId)
      .maybeSingle();
    type CtxShape = {
      enrolee_number: string | null;
      student: StudentNameShape | StudentNameShape[] | null;
      section:
        | { academic_year: { ay_code: string } | { ay_code: string }[] | null }
        | {
            academic_year: { ay_code: string } | { ay_code: string }[] | null;
          }[]
        | null;
    };
    const ctx = ctxRow as CtxShape | null;
    const enroleeNumber = ctx?.enrolee_number ?? null;
    const studentName = studentNameFromNode(ctx?.student ?? null);
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

      const statusUpdate = buildWithdrawalAdmissionsPatch({
        actorEmail,
        todayIso,
        admissionsAlreadyTerminal,
        withdrawalReason: parsed.data.withdrawal_reason,
        withdrawalNotes: parsed.data.withdrawal_notes,
      });

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
          actor: {
            id: auth.user.id,
            email: auth.user.email ?? null,
            role: auth.role,
          },
          action: 'student.withdrawal.cascade',
          entityType: 'enrolment_status',
          entityId: enroleeNumber,
          context: {
            ay_code: ayCode,
            trigger: 'section_student.withdrawn',
            enroleeNumber,
            ...(studentName ? { studentName } : {}),
            section_student_id: enrolmentId,
            section_id: sectionId,
            // applicationStatus (outcome) is NOT changed — outcome is
            // append-only and the application succeeded when the student enrolled.
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
        'enrolee_number, student:students!inner(student_number, first_name, last_name, middle_name), section:sections!inner(academic_year:academic_years!inner(ay_code))'
      )
      .eq('id', enrolmentId)
      .maybeSingle();
    type ReCtxShape = {
      enrolee_number: string | null;
      student: StudentNameShape | StudentNameShape[] | null;
      section:
        | { academic_year: { ay_code: string } | { ay_code: string }[] | null }
        | {
            academic_year: { ay_code: string } | { ay_code: string }[] | null;
          }[]
        | null;
    };
    const reCtx = reCtxRow as ReCtxShape | null;
    const reEnroleeNumber = reCtx?.enrolee_number ?? null;
    const reStudentName = studentNameFromNode(reCtx?.student ?? null);
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
        // Capture the enrolment moment (write-once, migration 075). Only
        // stamps when enrolledAt is still NULL, so a student who was already
        // enrolled before keeps their original moment; a legacy/pre-075
        // enrolment with no captured moment gets stamped here (best available
        // signal). Best-effort — never blocks the re-enrolment.
        await stampEnrolledAtIfNull(
          reAdmissions,
          `${rePrefix}_enrolment_status`,
          reEnroleeNumber
        );
        reEnrolmentCascade = {
          enroleeNumber: reEnroleeNumber,
          ayCode: reAyCode,
        };
        await logAction({
          service,
          actor: {
            id: auth.user.id,
            email: auth.user.email ?? null,
            role: auth.role,
          },
          action: 'student.reenrolment.cascade',
          entityType: 'enrolment_status',
          entityId: reEnroleeNumber,
          context: {
            ay_code: reAyCode,
            trigger: 'section_student.re-enrolled',
            enroleeNumber: reEnroleeNumber,
            ...(reStudentName ? { studentName: reStudentName } : {}),
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
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'enrolment.metadata.update',
    entityType: 'section_student',
    entityId: enrolmentId,
    context: {
      section_id: sectionId,
      before: {
        bus_no: before.bus_no ?? null,
        classroom_officer_role: before.classroom_officer_role ?? null,
        academics_notes: before.academics_notes ?? null,
        admin_notes: before.admin_notes ?? null,
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
      ...(lateEnrolleeReverted
        ? { lateEnrolleeReverted: true, revertReason }
        : {}),
      ...(attendanceRecomputed
        ? {
            recomputedAttendance: true,
            recomputedAttendanceTermCount: attendanceRecomputeTermCount,
          }
        : {}),
    },
  });

  // Invalidate operational drills for this AY using the canonical sectionAyCode
  // resolved near the top of the handler (no redundant AY query needed here).
  if (sectionAyCode) {
    invalidateAllOperationalDrills(sectionAyCode);
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
  if (isReEnrolment && !lateEnrolleeTransition && sectionAyCode) {
    const pos = await getEnrolmentPosition(sectionAyCode);
    // Late once the year has started — joining the active term (mid-term) OR
    // the next term (re-enrolled during a break). Use joiningTerm so the
    // fallback prompt also fires between terms, not only mid-term.
    if (pos.isLateEnrollee && pos.joiningTerm) {
      midTermEnrolment = {
        termNumber: pos.joiningTerm.termNumber,
        termLabel: `T${pos.joiningTerm.termNumber}`,
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

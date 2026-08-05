import type { SupabaseClient } from '@supabase/supabase-js';

import { sgToday } from '@/lib/dates';
import type { EnrolmentPosition } from '@/lib/sis/enrolment-position';
import { getEnrolmentPosition } from '@/lib/sis/terms';

// ──────────────────────────────────────────────────────────────────────────
// What has to happen the moment a student is PLACED in a class.
//
// Two things, and they belong together because they both key off the same
// moment: the attendance start date, and the late-enrollee prompt.
//
// This used to live inline in the stage route, which was fine while the only
// way to be Enrolled was to pick a class at the same time. HFSE's admission
// process separates them — Enrolment is step 10, Class Assignment is step 11
// (docs/context/admission-process.md) — so placement now happens in either of
// two routes, and both need this. Hence a module rather than a copy.
//
// `enrolledAt` on the admissions row and `section_students.enrollment_date`
// are DIFFERENT moments and must not be conflated: the first is step 10 (the
// student is in), the second is step 11 (the student has a seat, and their
// attendance register starts). A student enrolled in March and placed in
// April is marked present/absent from April, not March.
// ──────────────────────────────────────────────────────────────────────────

export type MidTermPayload = {
  /** Joining term — the active term mid-term, otherwise the next term. */
  termNumber: number;
  termLabel: string;
  sectionId: string;
  sectionStudentId: string;
  /** Null when the student joins during a break between terms. */
  activeTermNumber: number | null;
  nextTermNumber: number | null;
  canDeferToNext: boolean;
  daysLeftInActiveTerm: number | null;
};

/**
 * Shapes the late-enrollee prompt from a resolved enrolment position, or
 * returns null when there is nothing to ask.
 *
 * Late once the year has started — mid-term OR between terms (joining the
 * next one). Keying off `joiningTerm` rather than `activeTerm` is what makes
 * the prompt fire in a break too; the active-term-only fields stay null and
 * the dialog then renders the single "start next term" option.
 *
 * Pure — no DB, no clock.
 */
export function buildMidTermPayload(
  pos: EnrolmentPosition,
  sectionId: string,
  sectionStudentId: string
): MidTermPayload | null {
  if (!pos.isLateEnrollee || !pos.joiningTerm) return null;
  return {
    termNumber: pos.joiningTerm.termNumber,
    termLabel: `T${pos.joiningTerm.termNumber}`,
    sectionId,
    sectionStudentId,
    activeTermNumber: pos.activeTerm?.termNumber ?? null,
    nextTermNumber: pos.nextTerm?.termNumber ?? null,
    canDeferToNext: pos.canDeferToNext,
    daysLeftInActiveTerm: pos.daysLeftInActiveTerm,
  };
}

/**
 * Stamps the attendance start date on the student's `section_students` row
 * and resolves the late-enrollee prompt.
 *
 * The stamp overwrites whatever `syncOneStudent` defaulted, so downstream
 * term inference (the KD #68 per-row "·T2" badge, the late-enrollee N/A
 * logic, KD #113 attendance proration) reads the day the student actually
 * got a seat rather than the admissions row's earlier date.
 *
 * BEST-EFFORT BY CONTRACT. Both callers reach here after the placement has
 * already committed — in `assign-section` the admissions write is past its
 * rollback point — so a failure here must never fail the request. Everything
 * warns and returns a null payload instead of throwing.
 *
 * Pass `sectionId` whenever the caller knows it: without it the lookup is
 * `.maybeSingle()` over every non-withdrawn row for the student, which
 * throws if a botched transfer left two.
 */
export async function completePlacement(
  service: SupabaseClient,
  args: {
    enroleeNumber: string;
    ayCode: string;
    sectionId?: string | null;
  }
): Promise<{
  midTermEnrolment: MidTermPayload | null;
  enrollmentDateStamped: boolean;
}> {
  const { enroleeNumber, ayCode, sectionId } = args;
  const empty = { midTermEnrolment: null, enrollmentDateStamped: false };

  try {
    let query = service
      .from('section_students')
      .select('id, section_id, enrollment_date')
      .eq('enrolee_number', enroleeNumber)
      .neq('enrollment_status', 'withdrawn');
    if (sectionId) query = query.eq('section_id', sectionId);

    const { data: ss, error: ssErr } = await query.maybeSingle();
    if (ssErr) {
      console.warn(
        '[sis/placement-completion] section_students lookup failed:',
        ssErr.message
      );
      return empty;
    }

    const ssRow = ss as {
      id: string;
      section_id: string;
      enrollment_date: string | null;
    } | null;
    if (!ssRow?.id || !ssRow?.section_id) return empty;

    let stamped = false;
    const today = sgToday();
    if (ssRow.enrollment_date !== today) {
      const { error: dateErr } = await service
        .from('section_students')
        .update({ enrollment_date: today })
        .eq('id', ssRow.id);
      if (dateErr) {
        console.warn(
          '[sis/placement-completion] enrollment_date stamp failed:',
          dateErr.message
        );
      } else {
        stamped = true;
      }
    }

    const pos = await getEnrolmentPosition(ayCode);
    return {
      midTermEnrolment: buildMidTermPayload(pos, ssRow.section_id, ssRow.id),
      enrollmentDateStamped: stamped,
    };
  } catch (err: unknown) {
    console.warn(
      '[sis/placement-completion] failed:',
      err instanceof Error ? err.message : String(err)
    );
    return empty;
  }
}

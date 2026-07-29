import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { sgToday } from '@/lib/dates';
import { getTermForDate } from '@/lib/sis/terms';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';

export type TransferTermInfo = {
  termNumber: number;
  termLabel: string;
} | null;

export type TransferOk = {
  ok: true;
  studentNumber: string;
  fromSection: string;
  fromLevel: string;
  toSection: string;
  toLevel: string;
  transferDate: string;
  term: TransferTermInfo;
};

export type TransferErr = {
  ok: false;
  error: string;
  status: 404 | 409 | 422 | 500;
};

export type TransferResult = TransferOk | TransferErr;

type TransferParams = {
  ayCode: string;
  enroleeNumber: string;
  targetSectionId: string;
  actorEmail: string | null;
};

// Atomic move of an enrolled student from one section to another. Per
// Hard Rule #6 (section_students is append-only), the move = WITHDRAW the
// old section_students row + INSERT a new active row in the target section.
// The admissions-side classLevel/classSection fields are also updated so
// the cross-AY records lookup reflects the new section.
//
// The withdraw + insert pair IS transactional as of migration 097: it runs
// inside the `transfer_student_section` RPC, which also locks the source row
// `for update` and assigns the target index_number. Before that it was two
// separate statements with a manual rollback, and under a concurrent
// double-submit that rollback could restore the source row after a competing
// transfer had committed — leaving the student active in two sections.
//
// The surrounding steps (admissions-side classSection/classLevel update, audit,
// cache invalidation) are still sequential and best-effort: they run after the
// enrolment move has committed, and a failure there leaves the move in place
// with the mirror stale rather than corrupting the roster. That is the
// deliberate trade — the roster is the source of truth, the admissions columns
// are its mirror (KD #147).
export async function transferStudentSection(
  service: SupabaseClient,
  params: TransferParams
): Promise<TransferResult> {
  const { ayCode, enroleeNumber, targetSectionId, actorEmail } = params;
  const today = sgToday();

  // ── 1. Resolve AY ──────────────────────────────────────────────────────
  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (ayErr || !ayRow) {
    return {
      ok: false,
      error: `Academic year ${ayCode} not found`,
      status: 404,
    };
  }
  const ayId = (ayRow as { id: string }).id;

  // ── 2. Resolve target section + level ──────────────────────────────────
  const { data: targetSecRow, error: targetSecErr } = await service
    .from('sections')
    .select('id, name, level_id, academic_year_id, levels!inner(label)')
    .eq('id', targetSectionId)
    .maybeSingle();
  if (targetSecErr || !targetSecRow) {
    return { ok: false, error: 'Target section not found', status: 404 };
  }
  const targetSec = targetSecRow as {
    id: string;
    name: string;
    level_id: string;
    academic_year_id: string;
    levels: { label: string } | { label: string }[];
  };
  if (targetSec.academic_year_id !== ayId) {
    return {
      ok: false,
      error: 'Target section belongs to a different academic year',
      status: 422,
    };
  }
  const targetLevelLabel = Array.isArray(targetSec.levels)
    ? targetSec.levels[0]?.label
    : targetSec.levels?.label;
  if (!targetLevelLabel) {
    return {
      ok: false,
      error: 'Target section has no level label',
      status: 500,
    };
  }

  // ── 3. Resolve student via admissions enroleeNumber ────────────────────
  const admissions = createAdmissionsClient();
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const { data: appRow, error: appErr } = await admissions
    .from(`ay${year}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr || !appRow) {
    return {
      ok: false,
      error: 'Applicant not found in admissions roster',
      status: 404,
    };
  }
  const studentNumber = (appRow as { studentNumber: string | null })
    .studentNumber;
  if (!studentNumber) {
    return {
      ok: false,
      error:
        'Applicant has no studentNumber — cannot transfer (sync them first)',
      status: 422,
    };
  }

  const { data: studentRow, error: studentErr } = await service
    .from('students')
    .select('id')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (studentErr || !studentRow) {
    return {
      ok: false,
      error: 'Student record not found in grading roster',
      status: 404,
    };
  }
  const studentId = (studentRow as { id: string }).id;

  // ── 4. Find current active enrolment ───────────────────────────────────
  // Scope to sections in the same AY so a stale row from a prior AY doesn't
  // confuse the lookup.
  const { data: aySectionRows, error: aySecErr } = await service
    .from('sections')
    .select('id, level_id, name, levels!inner(label)')
    .eq('academic_year_id', ayId);
  if (aySecErr) {
    return {
      ok: false,
      error: `Section lookup failed: ${aySecErr.message}`,
      status: 500,
    };
  }
  const aySections = (aySectionRows ?? []) as Array<{
    id: string;
    level_id: string;
    name: string;
    levels: { label: string } | { label: string }[];
  }>;
  const aySectionIds = aySections.map((s) => s.id);
  if (aySectionIds.length === 0) {
    return {
      ok: false,
      error: 'No sections configured for this AY',
      status: 422,
    };
  }

  const { data: enrRows, error: enrErr } = await service
    .from('section_students')
    .select(
      'id, section_id, enrollment_status, enrollment_date, late_enrollee_term_number'
    )
    .eq('student_id', studentId)
    .in('section_id', aySectionIds);
  if (enrErr) {
    return {
      ok: false,
      error: `Enrolment lookup failed: ${enrErr.message}`,
      status: 500,
    };
  }
  // A `late_enrollee` (enrolled but joining a future term) is a legitimate
  // transfer source — the registrar can move them to the section they'll start
  // in. Match both active + late_enrollee (the class-headcount statuses); the
  // late-enrollee semantics are carried onto the destination row below.
  const activeRows = (enrRows ?? []).filter(
    (r) =>
      r.enrollment_status === 'active' ||
      r.enrollment_status === 'late_enrollee'
  );
  if (activeRows.length === 0) {
    return {
      ok: false,
      error: 'Student has no active enrolment to transfer from',
      status: 422,
    };
  }
  if (activeRows.length > 1) {
    return {
      ok: false,
      error: `Student is active in ${activeRows.length} sections — run bulk sync first to reconcile`,
      status: 409,
    };
  }
  const sourceEnr = activeRows[0] as {
    id: string;
    section_id: string;
    enrollment_status: string;
    enrollment_date: string | null;
    late_enrollee_term_number: number | null;
  };
  const sourceSec = aySections.find((s) => s.id === sourceEnr.section_id);
  if (!sourceSec) {
    return { ok: false, error: 'Source section metadata missing', status: 500 };
  }
  const sourceLevelLabel = Array.isArray(sourceSec.levels)
    ? sourceSec.levels[0]?.label
    : sourceSec.levels?.label;

  // ── 5. Reject same-section ─────────────────────────────────────────────
  if (sourceSec.id === targetSec.id) {
    return {
      ok: false,
      error: `Student is already in ${sourceSec.name}`,
      status: 422,
    };
  }

  // ── 6. Reject cross-level ──────────────────────────────────────────────
  if (sourceSec.level_id !== targetSec.level_id) {
    return {
      ok: false,
      error: `Cannot transfer ${sourceLevelLabel ?? 'student'} to a ${targetLevelLabel} section — moves are within the same level only`,
      status: 422,
    };
  }

  // ── 7. Capacity check on target ────────────────────────────────────────
  const targetActive = (enrRows ?? []).filter(
    (r) =>
      r.section_id === targetSec.id &&
      (r.enrollment_status === 'active' ||
        r.enrollment_status === 'late_enrollee')
  ).length;
  // The student being transferred isn't in target yet (filtered above as
  // single active row in source), so the count above is the standalone
  // target-section size. Compare directly to the cap.
  // Per Hard Rule #5 the cap is 50 active-or-late_enrollee (both count toward
  // the class headcount for grading and attendance purposes).
  const { count: targetTotalActive, error: capErr } = await service
    .from('section_students')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', targetSec.id)
    .in('enrollment_status', ['active', 'late_enrollee']);
  if (capErr) {
    return {
      ok: false,
      error: `Capacity check failed: ${capErr.message}`,
      status: 500,
    };
  }
  const totalActive = targetTotalActive ?? targetActive;
  if (totalActive >= MAX_ACTIVE_PER_SECTION) {
    return {
      ok: false,
      error: `Section ${targetSec.name} is at capacity (${MAX_ACTIVE_PER_SECTION} students)`,
      status: 422,
    };
  }

  // ── 8. Resolve current term ────────────────────────────────────────────
  // Uses the shared `getTermForDate` helper so admissions section transfers,
  // late-enrollee tagging, and any future date→term lookup share one
  // implementation.
  const term = await getTermForDate(today, ayCode, service);

  // ── 9. Mutation block (atomic, migration 097) ──────────────────────────
  //
  // The target's next index_number used to be computed here, before the
  // mutation. It now happens inside the RPC's transaction instead: read here,
  // two concurrent transfers into the same section could compute the same
  // index; read there, they cannot.
  //
  // Withdraw-source + insert-target now happen in ONE transaction inside
  // `transfer_student_section`. This was two independent statements with a
  // best-effort rollback of the first if the second failed — and under a
  // concurrent double-submit that rollback was the bug: the loser's insert
  // collided on the (section_id, student_id) unique constraint, so it restored
  // the SOURCE row to active AFTER the winner had committed both halves,
  // leaving the student active in two sections. Exactly the dual-section
  // failure this module was written to prevent (KD #67).
  //
  // In a transaction there is nothing to roll back by hand: the loser's insert
  // raises and Postgres unwinds its own withdraw with it.
  //
  // The RPC also re-reads the source row under `for update` and recomputes the
  // target's next index_number inside the transaction, so it no longer trusts
  // the caller's earlier read (which a concurrent transfer could have staled)
  // and two transfers into the same section can't pick the same index.
  //
  // Enrolment semantics are preserved in the RPC exactly as they were here: an
  // active student transfers as active starting today; a late enrollee stays a
  // late enrollee with its original joining date + term override, so attendance
  // proration (KD #113/#130) and the joining-term badge (KD #68/#117) carry
  // over rather than resetting to today.
  const { error: transferErr } = await service.rpc('transfer_student_section', {
    p_source_enrolment_id: sourceEnr.id,
    p_target_section_id: targetSec.id,
    // Denormalized AY-scoped key — every other writer (sync, seeder)
    // populates it; omitting it left transferred rows with NULL
    // enrolee_number, so enrolee_number-keyed lookups silently missed
    // transferred students (KD #83).
    p_enrolee_number: enroleeNumber,
    p_today: today,
  });
  if (transferErr) {
    return {
      ok: false,
      error: `Failed to transfer section: ${transferErr.message}`,
      status: 500,
    };
  }

  // Step C: update admissions-side classSection / classLevel
  const { error: admissionsErr } = await admissions
    .from(`ay${year}_enrolment_status`)
    .update({
      classSection: targetSec.name,
      classLevel: targetLevelLabel,
      classStatus: 'Finished',
      classUpdatedDate: new Date().toISOString(),
      classUpdatedBy: actorEmail ?? '(unknown)',
    })
    .eq('enroleeNumber', enroleeNumber);
  if (admissionsErr) {
    // Don't roll back — the grading-side mutation is the source of truth
    // for the student's current section. Surface the admissions failure so
    // the caller can decide whether to retry.
    console.warn(
      '[section-transfer] grading mutation succeeded but admissions update failed:',
      admissionsErr.message
    );
  }

  return {
    ok: true,
    studentNumber,
    fromSection: sourceSec.name,
    fromLevel: sourceLevelLabel ?? '',
    toSection: targetSec.name,
    toLevel: targetLevelLabel,
    transferDate: today,
    term,
  };
}

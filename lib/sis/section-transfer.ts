import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { sgToday } from '@/lib/dates';
import { getTermForDate } from '@/lib/sis/terms';

// Max active students per section (Hard Rule #5). Mirrored from
// lib/sis/class-assignment.ts — kept inline here to avoid a circular import
// chain via the route handler. Single-source candidate if a third caller
// shows up.
const MAX_ACTIVE_PER_SECTION = 50;

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
// The Supabase JS client doesn't expose multi-statement transactions; the
// operations run in tight order. If any step fails after a prior step has
// committed, the helper returns an error and downstream callers (the route)
// surface it to the user. The atomicity guarantee is best-effort, not
// transactional — but each step is idempotent enough that re-running the
// transfer is safe.
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
    .select('id, section_id, enrollment_status')
    .eq('student_id', studentId)
    .in('section_id', aySectionIds);
  if (enrErr) {
    return {
      ok: false,
      error: `Enrolment lookup failed: ${enrErr.message}`,
      status: 500,
    };
  }
  const activeRows = (enrRows ?? []).filter(
    (r) => r.enrollment_status === 'active'
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
  const sourceEnr = activeRows[0] as { id: string; section_id: string };
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
    (r) => r.section_id === targetSec.id && r.enrollment_status === 'active'
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

  // ── 9. Compute next index_number for target section ────────────────────
  const { data: targetIdxRows } = await service
    .from('section_students')
    .select('index_number')
    .eq('section_id', targetSec.id)
    .order('index_number', { ascending: false })
    .limit(1);
  const maxIdx =
    (targetIdxRows?.[0] as { index_number: number } | undefined)
      ?.index_number ?? 0;
  const nextIndex = maxIdx + 1;

  // ── 10. Mutation block (best-effort atomic) ────────────────────────────
  // Step A: withdraw old row
  const { error: withdrawErr } = await service
    .from('section_students')
    .update({ enrollment_status: 'withdrawn', withdrawal_date: today })
    .eq('id', sourceEnr.id);
  if (withdrawErr) {
    return {
      ok: false,
      error: `Failed to withdraw from source section: ${withdrawErr.message}`,
      status: 500,
    };
  }

  // Step B: insert new active row
  const { error: insertErr } = await service.from('section_students').insert({
    section_id: targetSec.id,
    student_id: studentId,
    index_number: nextIndex,
    enrollment_status: 'active',
    enrollment_date: today,
  });
  if (insertErr) {
    // Best-effort rollback of step A so the student isn't left orphaned.
    await service
      .from('section_students')
      .update({ enrollment_status: 'active', withdrawal_date: null })
      .eq('id', sourceEnr.id);
    return {
      ok: false,
      error: `Failed to insert into target section: ${insertErr.message}`,
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

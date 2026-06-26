// Pure planner for the admissions → grading-DB sync.
// Takes a snapshot of current grading-DB state and the admissions roster,
// returns a plan of inserts/updates/withdrawals and errors.
// Kept pure so it's testable without hitting either database.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdmissionsRow } from '@/lib/supabase/admissions';
import { sgToday } from '@/lib/dates';
import { normalizeSectionName } from '@/lib/sync/section-normalizer';
import { normalizeLevelLabel } from '@/lib/sync/level-normalizer';

export type LevelRow = { id: string; label: string };
export type SectionRow = { id: string; level_id: string; name: string };
export type StudentRow = {
  id: string;
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
};
export type EnrollmentRow = {
  id: string;
  section_id: string;
  student_id: string;
  index_number: number;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
};

export type GradingSnapshot = {
  levels: LevelRow[];
  sections: SectionRow[]; // only sections for the target academic year
  students: StudentRow[];
  enrollments: EnrollmentRow[]; // only for sections in the target academic year
};

export type StudentUpsert = {
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  kind: 'insert' | 'update';
  existing_id?: string;
};

export type EnrollmentInsert = {
  section_id: string;
  student_number: string; // resolved to student_id at commit time
  index_number: number;
  enrolee_number: string | null; // admissions key, stamped onto section_students
};

export type EnrollmentStatusChange = {
  enrollment_id: string;
  student_number: string;
  section_id: string;
  from: EnrollmentRow['enrollment_status'];
  to: EnrollmentRow['enrollment_status'];
};

export type SyncError = {
  row_index: number;
  student_number: string | null;
  reason: string;
};

export type SyncPlan = {
  student_upserts: StudentUpsert[];
  enrollment_inserts: EnrollmentInsert[];
  enrollment_status_changes: EnrollmentStatusChange[];
  errors: SyncError[];
  stats: {
    total_source_rows: number;
    students_to_add: number;
    students_to_update: number;
    enrollments_to_add: number;
    enrollments_to_withdraw: number;
    enrollments_to_reactivate: number;
    errors: number;
    by_level: Record<string, { add: number; update: number; withdraw: number }>;
  };
};

export function buildSyncPlan(
  rows: AdmissionsRow[],
  snapshot: GradingSnapshot
): SyncPlan {
  const levelByLabel = new Map(snapshot.levels.map((l) => [l.label, l]));
  const sectionByLevelAndName = new Map<string, SectionRow>();
  for (const s of snapshot.sections) {
    sectionByLevelAndName.set(`${s.level_id}::${s.name}`, s);
  }
  const studentByNumber = new Map(
    snapshot.students.map((s) => [s.student_number, s])
  );
  const enrollmentBySectionAndStudent = new Map<string, EnrollmentRow>();
  for (const e of snapshot.enrollments) {
    enrollmentBySectionAndStudent.set(`${e.section_id}::${e.student_id}`, e);
  }

  // Current max index per section (for appending new enrollees).
  const maxIndexBySection = new Map<string, number>();
  for (const e of snapshot.enrollments) {
    const prev = maxIndexBySection.get(e.section_id) ?? 0;
    if (e.index_number > prev)
      maxIndexBySection.set(e.section_id, e.index_number);
  }

  const plan: SyncPlan = {
    student_upserts: [],
    enrollment_inserts: [],
    enrollment_status_changes: [],
    errors: [],
    stats: {
      total_source_rows: rows.length,
      students_to_add: 0,
      students_to_update: 0,
      enrollments_to_add: 0,
      enrollments_to_withdraw: 0,
      enrollments_to_reactivate: 0,
      errors: 0,
      by_level: {},
    },
  };

  const bumpLevel = (label: string, key: 'add' | 'update' | 'withdraw') => {
    const b = (plan.stats.by_level[label] ??= {
      add: 0,
      update: 0,
      withdraw: 0,
    });
    b[key]++;
  };

  // Track the set of (section_id, student_number) seen in this sync to detect
  // students no longer in admissions (candidates for withdrawal).
  const seen = new Set<string>();
  // Track planned student_number → student row shape so duplicate rows from the
  // source don't create duplicate insert plans.
  const plannedStudents = new Map<string, StudentUpsert>();
  // Track planned enrollments (section_id + student_number) so duplicates in
  // the source roster don't claim two index numbers.
  const plannedEnrollments = new Set<string>();

  rows.forEach((row, i) => {
    const number = row.student_number?.trim() || null;
    if (!number) {
      plan.errors.push({
        row_index: i,
        student_number: null,
        reason: 'null or empty studentNumber',
      });
      return;
    }
    const levelLabel = normalizeLevelLabel(row.class_level);
    if (!levelLabel) {
      plan.errors.push({
        row_index: i,
        student_number: number,
        reason: 'missing classLevel',
      });
      return;
    }
    const level = levelByLabel.get(levelLabel);
    if (!level) {
      plan.errors.push({
        row_index: i,
        student_number: number,
        reason: `unknown classLevel "${row.class_level}"`,
      });
      return;
    }
    const sectionName = normalizeSectionName(row.class_section);
    if (!sectionName) {
      plan.errors.push({
        row_index: i,
        student_number: number,
        reason: 'missing classSection',
      });
      return;
    }
    const section = sectionByLevelAndName.get(`${level.id}::${sectionName}`);
    if (!section) {
      plan.errors.push({
        row_index: i,
        student_number: number,
        reason: `section "${sectionName}" not found under ${level.label}`,
      });
      return;
    }

    // ----- Student upsert -----
    const existing = studentByNumber.get(number);
    const last_name = (row.last_name ?? '').trim();
    const first_name = (row.first_name ?? '').trim();
    const middle_name = row.middle_name?.trim() || null;

    if (!existing) {
      if (!plannedStudents.has(number)) {
        const upsert: StudentUpsert = {
          student_number: number,
          last_name,
          first_name,
          middle_name,
          kind: 'insert',
        };
        plannedStudents.set(number, upsert);
        plan.student_upserts.push(upsert);
        plan.stats.students_to_add++;
      }
    } else {
      const changed =
        existing.last_name !== last_name ||
        existing.first_name !== first_name ||
        (existing.middle_name ?? null) !== middle_name;
      if (changed && !plannedStudents.has(number)) {
        const upsert: StudentUpsert = {
          student_number: number,
          last_name,
          first_name,
          middle_name,
          kind: 'update',
          existing_id: existing.id,
        };
        plannedStudents.set(number, upsert);
        plan.student_upserts.push(upsert);
        plan.stats.students_to_update++;
      }
    }

    // ----- Enrollment -----
    const seenKey = `${section.id}::${number}`;
    seen.add(seenKey);

    // Reactivate if previously withdrawn and back in admissions.
    if (existing) {
      const prevEnrollment = enrollmentBySectionAndStudent.get(
        `${section.id}::${existing.id}`
      );
      if (prevEnrollment) {
        if (prevEnrollment.enrollment_status === 'withdrawn') {
          plan.enrollment_status_changes.push({
            enrollment_id: prevEnrollment.id,
            student_number: number,
            section_id: section.id,
            from: 'withdrawn',
            to: 'active',
          });
          plan.stats.enrollments_to_reactivate++;
        }
        return; // already enrolled in this section, nothing else to do
      }
    }

    if (plannedEnrollments.has(seenKey)) return;
    plannedEnrollments.add(seenKey);

    const nextIndex = (maxIndexBySection.get(section.id) ?? 0) + 1;
    maxIndexBySection.set(section.id, nextIndex);
    plan.enrollment_inserts.push({
      section_id: section.id,
      student_number: number,
      index_number: nextIndex,
      enrolee_number: row.enrolee_number?.trim() || null,
    });
    plan.stats.enrollments_to_add++;
    bumpLevel(level.label, 'add');
  });

  // ----- Detect withdrawals: active enrollments not seen in this sync -----
  const studentById = new Map(snapshot.students.map((s) => [s.id, s]));
  const sectionById = new Map(snapshot.sections.map((s) => [s.id, s]));
  const levelById = new Map(snapshot.levels.map((l) => [l.id, l]));

  for (const e of snapshot.enrollments) {
    if (
      e.enrollment_status !== 'active' &&
      e.enrollment_status !== 'late_enrollee'
    )
      continue;
    const student = studentById.get(e.student_id);
    if (!student) continue;
    const key = `${e.section_id}::${student.student_number}`;
    if (seen.has(key)) continue;
    plan.enrollment_status_changes.push({
      enrollment_id: e.id,
      student_number: student.student_number,
      section_id: e.section_id,
      from: e.enrollment_status,
      to: 'withdrawn',
    });
    plan.stats.enrollments_to_withdraw++;
    const section = sectionById.get(e.section_id);
    const level = section ? levelById.get(section.level_id) : undefined;
    if (level) bumpLevel(level.label, 'withdraw');
  }

  plan.stats.errors = plan.errors.length;
  return plan;
}

// ──────────────────────────────────────────────────────────────────────────
// Single-student sync (Sprint 13.3)
//
// Called from the SIS stage PATCH when class.status flips to 'Assigned'.
// Builds a narrow snapshot scoped to the target student + materialises their
// grading-schema rows immediately (no need to run the bulk sync).
//
// Deliberately narrow: does NOT detect withdrawals from other sections.
// If a student moves from P1 Patience to P1 Obedience mid-year via admissions,
// this helper enrols them in Obedience but leaves the Patience row untouched.
// Bulk sync (registrar, /markbook/sync-students) handles that reconciliation.
// ──────────────────────────────────────────────────────────────────────────

export type SyncOneResult = {
  ok: boolean;
  change:
    | 'inserted'
    | 'updated'
    | 'enrolled'
    | 'reactivated'
    | 'unchanged'
    | 'skipped';
  reason?: string;
  error?: string;
};

export async function syncOneStudent(
  service: SupabaseClient,
  admissions: SupabaseClient,
  enroleeNumber: string,
  ayCode: string
): Promise<SyncOneResult> {
  try {
    const year = ayCode.replace(/^AY/i, '').toLowerCase();
    const appsTable = `ay${year}_enrolment_applications`;
    const statusTable = `ay${year}_enrolment_status`;

    // 1. Fetch the admissions pair for this enrolee.
    const [appRes, statusRes] = await Promise.all([
      admissions
        .from(appsTable)
        .select('enroleeNumber, studentNumber, lastName, firstName, middleName')
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle(),
      admissions
        .from(statusTable)
        .select(
          'enroleeNumber, classLevel, classSection, classAY, applicationStatus'
        )
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle(),
    ]);
    if (appRes.error) {
      return {
        ok: false,
        change: 'skipped',
        error: `apps fetch: ${appRes.error.message}`,
      };
    }
    if (statusRes.error) {
      return {
        ok: false,
        change: 'skipped',
        error: `status fetch: ${statusRes.error.message}`,
      };
    }
    if (!appRes.data || !statusRes.data) {
      return {
        ok: false,
        change: 'skipped',
        reason: 'admissions rows missing',
      };
    }
    const app = appRes.data as {
      studentNumber: string | null;
      lastName: string | null;
      firstName: string | null;
      middleName: string | null;
    };
    const status = statusRes.data as {
      classLevel: string | null;
      classSection: string | null;
      applicationStatus: string | null;
    };

    if (!app.studentNumber)
      return { ok: false, change: 'skipped', reason: 'no studentNumber' };
    if (!status.classSection || !status.classLevel) {
      return {
        ok: false,
        change: 'skipped',
        reason: 'missing classLevel or classSection',
      };
    }
    // NOTE (KD #147 / post-enrolment withdrawal model): this guard catches the
    // pre-enrolment 'Cancelled'/'Withdrawn' terminal states where the student
    // never received a section_students row.
    //
    // POST-KD-#147 LIMITATION: an enrolled-then-withdrawn student keeps
    // applicationStatus='Enrolled' (the OUTCOME is append-only); their
    // withdrawal is signalled only via section_students.enrollment_status='withdrawn'.
    // That case is NOT caught here.
    //
    // This is currently SAFE because:
    //  (a) The bulk sync path's upstream `fetchAdmissionsRoster` /
    //      `filterWithdrawnFromRoster` strips post-enrolment withdrawals before
    //      any rows reach this function.
    //  (b) Today's only direct callers operate on the *unsynced queue* — students
    //      with NO section_students row at all, so a 'withdrawn' ss row cannot
    //      coexist.
    //
    // IF a new call-site is added that may target already-enrolled students
    // (e.g. a re-sync-on-demand route), the caller MUST guard against
    // reactivating a withdrawn student. The canonical check is:
    //   resolveIsWithdrawn(applicationStatus, ssEnrollmentStatuses)
    // from `lib/sis/process.ts` — pass the student's current
    // section_students.enrollment_status values for the AY.
    if (
      status.applicationStatus === 'Cancelled' ||
      status.applicationStatus === 'Withdrawn'
    ) {
      return {
        ok: false,
        change: 'skipped',
        reason: `application is ${status.applicationStatus}`,
      };
    }

    const admissionsRow: AdmissionsRow = {
      student_number: app.studentNumber,
      last_name: app.lastName,
      first_name: app.firstName,
      middle_name: app.middleName,
      class_level: status.classLevel,
      class_section: status.classSection,
      class_ay: ayCode,
      enrolee_number: enroleeNumber,
    };

    // 2. Load a minimal grading snapshot in parallel. The three queries are
    //    independent (levels + student + sections-joined-to-ay), so firing
    //    them together cuts round-trips from ~4 sequential to 1 Promise.all
    //    + 1 follow-up for enrolments (Sprint 14.5 fix).
    const [levelsRes, studentRes, sectionsRes] = await Promise.all([
      service.from('levels').select('id, label'),
      service
        .from('students')
        .select('id, student_number, last_name, first_name, middle_name')
        .eq('student_number', app.studentNumber)
        .maybeSingle(),
      service
        .from('sections')
        .select(
          'id, level_id, name, academic_year:academic_years!inner(ay_code)'
        )
        .eq('academic_year.ay_code', ayCode),
    ]);

    type SectionJoin = {
      id: string;
      level_id: string;
      name: string;
      academic_year: { ay_code: string } | { ay_code: string }[] | null;
    };
    const sections = ((sectionsRes.data ?? []) as SectionJoin[]).map((s) => ({
      id: s.id,
      level_id: s.level_id,
      name: s.name,
    }));
    const levels = (levelsRes.data ?? []) as Array<{
      id: string;
      label: string;
    }>;

    const studentRow = studentRes.data as null | {
      id: string;
      student_number: string;
      last_name: string;
      first_name: string;
      middle_name: string | null;
    };

    // Enrolments for this specific student (across all sections in this AY)
    // so a stale row in another section doesn't produce a phantom insert.
    let enrollments: EnrollmentRow[] = [];
    if (studentRow) {
      const sectionIds = sections.map((s) => s.id);
      if (sectionIds.length > 0) {
        const enrRes = await service
          .from('section_students')
          .select('id, section_id, student_id, index_number, enrollment_status')
          .eq('student_id', studentRow.id)
          .in('section_id', sectionIds);
        enrollments = (enrRes.data ?? []) as EnrollmentRow[];
      }
    }

    const snapshot: GradingSnapshot = {
      levels,
      sections,
      students: studentRow ? [studentRow] : [],
      enrollments,
    };

    const plan = buildSyncPlan([admissionsRow], snapshot);

    if (plan.errors.length > 0) {
      return { ok: false, change: 'skipped', reason: plan.errors[0].reason };
    }

    // 3. Commit. Same shape as /api/students/sync but narrowed to this one row.
    const inserts = plan.student_upserts.filter((u) => u.kind === 'insert');
    const updates = plan.student_upserts.filter((u) => u.kind === 'update');

    if (inserts.length > 0) {
      const { error } = await service.from('students').insert(
        inserts.map((u) => ({
          student_number: u.student_number,
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
        }))
      );
      if (error)
        return {
          ok: false,
          change: 'skipped',
          error: `student insert: ${error.message}`,
        };
    }
    for (const u of updates) {
      const { error } = await service
        .from('students')
        .update({
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', u.existing_id!);
      if (error)
        return {
          ok: false,
          change: 'skipped',
          error: `student update: ${error.message}`,
        };
    }

    // Resolve student_id for fresh enrolments (newly-inserted students need
    // their generated UUID looked up).
    let studentId: string | null = studentRow?.id ?? null;
    if (!studentId && plan.enrollment_inserts.length > 0) {
      const { data } = await service
        .from('students')
        .select('id')
        .eq('student_number', app.studentNumber)
        .maybeSingle();
      studentId = (data as { id: string } | null)?.id ?? null;
    }

    for (const e of plan.enrollment_inserts) {
      if (!studentId)
        return {
          ok: false,
          change: 'skipped',
          error: 'student_id not resolved',
        };
      const { error } = await service.from('section_students').insert({
        section_id: e.section_id,
        student_id: studentId,
        index_number: e.index_number,
        enrollment_status: 'active',
        enrollment_date: sgToday(),
        // Stamp the admissions key on the row. enrolee_number-keyed lookups
        // depend on it — notably the stage route's late-enrollee prompt
        // (it finds the freshly-synced row by enrolee_number) and the Records
        // directory index/status maps (KD #135). Omitting it left it NULL, so
        // the late-enrollee suggestion never fired for a just-enrolled applicant.
        enrolee_number: enroleeNumber,
      });
      if (error)
        return {
          ok: false,
          change: 'skipped',
          error: `enrolment insert: ${error.message}`,
        };
    }

    for (const change of plan.enrollment_status_changes) {
      const patch: Record<string, unknown> = { enrollment_status: change.to };
      if (change.to === 'withdrawn') {
        patch.withdrawal_date = sgToday();
      } else {
        patch.withdrawal_date = null;
      }
      const { error } = await service
        .from('section_students')
        .update(patch)
        .eq('id', change.enrollment_id);
      if (error)
        return {
          ok: false,
          change: 'skipped',
          error: `status change: ${error.message}`,
        };
    }

    // Summarise what happened.
    if (plan.enrollment_inserts.length > 0) {
      return { ok: true, change: 'enrolled' };
    }
    if (plan.enrollment_status_changes.some((c) => c.to === 'active')) {
      return { ok: true, change: 'reactivated' };
    }
    if (updates.length > 0) return { ok: true, change: 'updated' };
    if (inserts.length > 0) return { ok: true, change: 'inserted' };
    return { ok: true, change: 'unchanged' };
  } catch (err) {
    return {
      ok: false,
      change: 'skipped',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

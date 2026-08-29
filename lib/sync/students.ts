// Pure planner for the admissions → grading-DB sync.
// Takes a snapshot of current grading-DB state and the admissions roster,
// returns a plan of inserts/updates/withdrawals and errors.
// Kept pure so it's testable without hitting either database.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdmissionsRow } from '@/lib/supabase/admissions';
import { sgToday } from '@/lib/dates';
import { fetchAllPages } from '@/lib/supabase/paginate';
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
  /**
   * Highest index_number currently used in each section, INCLUDING withdrawn
   * rows — an index number is a permanent per-section ID and is never handed
   * to a second student, so a section that looks empty can still have 1..N
   * taken.
   *
   * Required because `enrollments` is not always section-complete. A
   * single-student sync deliberately narrows it to that one student's rows
   * (otherwise every other student in the year looks like a withdrawal), and
   * the highest index in a section cannot be read off a slice like that: it
   * came back 0, so the next index was always 1, and assigning anyone into a
   * section whose #1 was held by a withdrawn student failed on the unique
   * constraint. Callers with a section-complete `enrollments` may leave this
   * undefined; the ceiling is then derived from it as before.
   */
  maxIndexBySection?: Record<string, number>;
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

  // Current max index per section (for appending new enrollees). Seeded from
  // the caller's section-wide ceilings where it supplied them, then raised by
  // anything in `enrollments` — whichever is higher wins, so a caller that
  // supplies neither, either or both cannot end up handing out a taken number.
  const maxIndexBySection = new Map<string, number>(
    Object.entries(snapshot.maxIndexBySection ?? {})
  );
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
// Bulk sync (POST /api/students/sync) handles that reconciliation — kept as
// an admin/script escape hatch; no UI trigger since the sync page was
// removed (KD #154). Day-to-day reconciliation runs via the daily cron
// (POST /api/sis/students/auto-sync) + the Records unsynced-students queue.
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

// AY-invariant lookup tables a bulk caller can fetch ONCE and pass to every
// syncOneStudent call in the run. Both arrays are identical across every
// student in a batch (levels is global; sections is per-AY), so re-fetching
// them per student in the bulk auto-sync was O(N) redundant full-table reads.
// Shapes match what syncOneStudent derives internally: `sections` is the
// post-join mapping WITHOUT the joined `academic_year` object.
export type PreloadedSyncSnapshot = {
  levels: LevelRow[];
  sections: SectionRow[]; // only sections for the target academic year
};

export async function syncOneStudent(
  service: SupabaseClient,
  admissions: SupabaseClient,
  enroleeNumber: string,
  ayCode: string,
  // Optional bulk-run optimisation: when provided, the `levels` and
  // `sections` fetches below are skipped and these arrays are used instead.
  // When omitted, behavior is identical to before this parameter existed.
  preloaded?: PreloadedSyncSnapshot
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
    //
    //    When a bulk caller passes `preloaded` (levels + per-AY sections are
    //    identical across every student in a run), only the per-student
    //    `students` row is fetched here.
    type SectionJoin = {
      id: string;
      level_id: string;
      name: string;
      academic_year: { ay_code: string } | { ay_code: string }[] | null;
    };

    const studentQuery = service
      .from('students')
      .select('id, student_number, last_name, first_name, middle_name')
      .eq('student_number', app.studentNumber)
      .maybeSingle();

    let levels: LevelRow[];
    let sections: SectionRow[];
    let studentRes: Awaited<typeof studentQuery>;

    if (preloaded) {
      levels = preloaded.levels;
      sections = preloaded.sections;
      studentRes = await studentQuery;
    } else {
      const [levelsRes, sRes, sectionsRes] = await Promise.all([
        service.from('levels').select('id, label'),
        studentQuery,
        service
          .from('sections')
          .select(
            'id, level_id, name, academic_year:academic_years!inner(ay_code)'
          )
          .eq('academic_year.ay_code', ayCode),
      ]);
      studentRes = sRes;
      sections = ((sectionsRes.data ?? []) as SectionJoin[]).map((s) => ({
        id: s.id,
        level_id: s.level_id,
        name: s.name,
      }));
      levels = (levelsRes.data ?? []) as Array<{
        id: string;
        label: string;
      }>;
    }

    const studentRow = studentRes.data as null | {
      id: string;
      student_number: string;
      last_name: string;
      first_name: string;
      middle_name: string | null;
    };

    // Enrolments for this specific student (across all sections in this AY)
    // so a stale row in another section doesn't produce a phantom insert.
    const sectionIds = sections.map((s) => s.id);
    let enrollments: EnrollmentRow[] = [];
    if (studentRow && sectionIds.length > 0) {
      const enrRes = await service
        .from('section_students')
        .select('id, section_id, student_id, index_number, enrollment_status')
        .eq('student_id', studentRow.id)
        .in('section_id', sectionIds);
      enrollments = (enrRes.data ?? []) as EnrollmentRow[];
    }

    // The highest index_number already used in each section — read separately
    // BECAUSE the slice above is one student's rows. An index number is a
    // permanent per-section ID that is never reassigned, so a section holding
    // nothing but withdrawn students still has 1..N taken, and appending at
    // "0 + 1" hit the unique (section_id, index_number) constraint. Every row
    // counts here, withdrawn included.
    //
    // Paged: one row per enrolment per AY, so this is students-sized (405
    // non-withdrawn in AY2026 on 2026-08-13, ~500 rows including withdrawn)
    // and will cross the 1,000-row cap as the school grows.
    const maxIndexBySection: Record<string, number> = {};
    if (sectionIds.length > 0) {
      const indexRows = await fetchAllPages<{
        section_id: string;
        index_number: number;
      }>((from, to) =>
        service
          .from('section_students')
          .select('section_id, index_number')
          .in('section_id', sectionIds)
          .range(from, to)
      );
      for (const r of indexRows) {
        const prev = maxIndexBySection[r.section_id] ?? 0;
        if (r.index_number > prev)
          maxIndexBySection[r.section_id] = r.index_number;
      }
    }

    const snapshot: GradingSnapshot = {
      levels,
      sections,
      students: studentRow ? [studentRow] : [],
      enrollments,
      maxIndexBySection,
    };

    const plan = buildSyncPlan([admissionsRow], snapshot);

    if (plan.errors.length > 0) {
      return { ok: false, change: 'skipped', reason: plan.errors[0].reason };
    }

    // 3. Commit. Same shape as /api/students/sync but narrowed to this one row.
    //
    // ⚠ The four loops below look like row-at-a-time writes and are not, which
    // is why `scripts/audit/row-at-a-time-writes.ts` flags three of them.
    // `buildSyncPlan` was handed a ONE-ROW roster and a snapshot holding one
    // student, so it can plan at most one student upsert and at most one
    // enrolment insert; `enrollment_status_changes` is bounded by that one
    // student's enrolment rows in this AY (one normally, two after a mid-year
    // transfer). Batching them would collapse nothing.
    //
    // The roster-sized caller is POST /api/students/sync, which already writes
    // in single batched statements. The per-student fan-out through here is
    // bounded to waves of five by the auto-sync route.
    //
    // Do NOT widen these writes to spread a planned row: the object literals
    // are field-scoped on purpose so an admissions sync cannot touch the
    // SIS-owned columns that also live on `students`
    // (__tests__/sis/students-sync-preserves-attributes.test.ts, KD #178).
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

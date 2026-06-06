import type { SupabaseClient } from '@supabase/supabase-js';

import { seedDemoExtras, type DemoExtrasResult } from './demo-extras';
import { seedMovements } from './movements';
import { seedEdgeCases, type EdgeCaseResult } from './edge-cases';
import { hashString, mulberry32, prefixFor } from './random';

import {
  buildSyncPlan,
  type LevelRow,
  type SectionRow,
  type StudentRow,
  type EnrollmentRow,
} from '@/lib/sync/students';
import type { AdmissionsRow } from '@/lib/supabase/admissions';

import { computeQuarterly } from '@/lib/compute/quarterly';
import {
  LEVEL_LABELS,
  LEVEL_CODES,
  LEVEL_TYPE_BY_CODE,
  type LevelCode,
} from '@/lib/sis/levels';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { DOCUMENT_SLOTS, OPTIONAL_DOCUMENT_SLOT_KEYS } from '@/lib/sis/queries';
import { fetchAllPages } from '@/lib/supabase/paginate';

import { pickNames } from './names';

// Populated seeder — layers on top of `ensureTestStructure`. Once structure
// + students are in place, this fills grade entries, attendance, evaluation
// writeups, admissions-funnel rows, discount codes, and a demo publication
// window so every module renders populated screens instead of empty states.
//
// Each step is self-healing: computes the expected row set, subtracts what
// already exists keyed on the natural identifier (grading_sheet ×
// section_student, term × student, enroleeNumber, etc.), and inserts the
// remainder. Re-running fills in gaps from a previously-aborted seed
// without duplicating existing rows. Tables with a true unique constraint
// use `upsert({ ignoreDuplicates: true })`; append-only tables filter
// in JS before insert.

export type PopulatedSeedResult = {
  students_inserted: number;
  enrolments_inserted: number;
  grade_entries_inserted: number;
  attendance_daily_inserted: number;
  attendance_rollups_built: number;
  evaluation_writeups_inserted: number;
  admissions_apps_inserted: number;
  enrolled_applications_inserted: number;
  test_teachers_created: number;
  teacher_form_adviser_assignments: number;
  teacher_subject_assignments: number;
  discount_codes_inserted: number;
  publications_inserted: number;
  documents_inserted: number;
  movements_inserted: number;
  edge_cases_inserted: number;
  demo_extras: DemoExtrasResult | null;
  // Reconciliation pass — guarantees every enrolled admissions row resolved to
  // a public.students row via the sync. `orphans` MUST be 0; a non-zero value
  // is the "enrolled but no matching student record" symptom this refactor
  // exists to prevent.
  reconciliation: {
    enrolled: number;
    synced: number;
    orphans: number;
  };
};

// ─── Test teacher personas ────────────────────────────────────────────────────
// Created once per test env setup; purged when the env is reset. Identified
// for cleanup via `user_metadata.seeded_teacher = true`.

export const TEST_TEACHERS = [
  { email: 'sarah.chen@demo.com', displayName: 'Sarah Chen' },
  { email: 'michael.santos@demo.com', displayName: 'Michael Santos' },
  { email: 'priya.nair@demo.com', displayName: 'Priya Nair' },
  { email: 'james.tan@demo.com', displayName: 'James Tan' },
  { email: 'emily.rodriguez@demo.com', displayName: 'Emily Rodriguez' },
  { email: 'david.kim@demo.com', displayName: 'David Kim' },
  { email: 'anne.deleon@demo.com', displayName: 'Anne De Leon' },
  { email: 'robert.williams@demo.com', displayName: 'Robert Williams' },
  { email: 'maria.cruz@demo.com', displayName: 'Maria Cruz' },
  { email: 'kevin.lim@demo.com', displayName: 'Kevin Lim' },
] as const;

export const TEST_TEACHER_PASSWORD = 'demo-2026!Teacher';

async function seedTestTeachers(service: SupabaseClient): Promise<number> {
  const { data: existingUsers } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  const existingByEmail = new Map<string, string>();
  for (const u of existingUsers?.users ?? []) {
    if (u.email) existingByEmail.set(u.email.toLowerCase(), u.id);
  }
  let created = 0;
  for (const t of TEST_TEACHERS) {
    if (existingByEmail.has(t.email.toLowerCase())) continue;
    const { error } = await service.auth.admin.createUser({
      email: t.email,
      password: TEST_TEACHER_PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'teacher' },
      user_metadata: { display_name: t.displayName, seeded_teacher: true },
    });
    if (error) {
      console.error(
        `[populated seeder] teacher create failed for ${t.email}:`,
        error.message
      );
      continue;
    }
    created++;
  }
  return created;
}

export type SeedPopulatedOptions = {
  // When true, every term (T1-T4) is filled as a closed/completed term
  // — full grades, full attendance, full evaluation writeups, all sheets
  // locked. Use for prior-year AYs (AY9998) where the closed-year picture
  // matters for the Masterfile awards demo + T4 report card General
  // Average + compare-mode prior-period data.
  //
  // When false (default), the active-AY pattern: T1 closed/full, T2
  // partial/in-progress, T3+T4 empty — gives the registrar a "live"
  // sheet to demo entry edits + change-request submission against.
  allTermsFull?: boolean;
};

export async function seedPopulated(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  options: SeedPopulatedOptions = {}
): Promise<PopulatedSeedResult> {
  const { allTermsFull = false } = options;
  const result: PopulatedSeedResult = {
    students_inserted: 0,
    enrolments_inserted: 0,
    grade_entries_inserted: 0,
    attendance_daily_inserted: 0,
    attendance_rollups_built: 0,
    evaluation_writeups_inserted: 0,
    admissions_apps_inserted: 0,
    enrolled_applications_inserted: 0,
    test_teachers_created: 0,
    teacher_form_adviser_assignments: 0,
    teacher_subject_assignments: 0,
    discount_codes_inserted: 0,
    publications_inserted: 0,
    documents_inserted: 0,
    movements_inserted: 0,
    edge_cases_inserted: 0,
    demo_extras: null,
    reconciliation: { enrolled: 0, synced: 0, orphans: 0 },
  };

  // The enrolled roster is now seeded production-style: admissions rows first,
  // then public.students + section_students materialised through the SAME pure
  // sync planner (`buildSyncPlan`) the live admissions→grading sync uses. This
  // guarantees every enrolled student has matching admissions rows — the exact
  // invariant the old "students-first, admissions-backfilled" order could
  // silently break.

  // ---- 0a. Resolve the per-section enrolled-roster config (P6 Grit 13,
  //          P6 Loyalty 12, S4 Excellence 25) from the sections in this AY. ----
  const enrolledConfig = await resolveEnrolledRosterConfig(service, testAy);

  // ---- 0b. Enrolled-stage admissions rows FIRST. Personas are generated
  //          deterministically from the per-section config (no dependency on
  //          section_students existing yet) and inserted into
  //          ay{YY}_enrolment_applications + _enrolment_status. ----
  const personas = buildEnrolledPersonas(testAy, enrolledConfig);
  result.enrolled_applications_inserted = await seedEnrolledAdmissionsRows(
    service,
    testAy,
    personas
  );

  // ---- 0c. Admissions pre-enrolment funnel (non-enrolled stages). ----
  result.admissions_apps_inserted = await seedAdmissionsFunnel(service, testAy);

  // ---- 0d. Admissions documents — reads ALL apps rows (enrolled + funnel),
  //          so it must run after both 0b and 0c. ----
  result.documents_inserted = await seedAdmissionsDocuments(service, testAy);

  // ---- 0d-ii. P-Files revision history — a few sample prior versions so the
  //          revision dialog isn't empty in test (enrolled only, KD #71). ----
  await seedPFileRevisions(service, testAy);

  // ---- 0e. Run the sync: buildSyncPlan(rows, snapshot) → commit students +
  //          section_students + back-write enrolee_number. Withdrawn/Cancelled
  //          personas are excluded from the roster rows so they never create an
  //          active enrollment (matching the live roster filter). ----
  const sync = await syncEnrolledPersonas(service, testAy, personas);
  result.students_inserted = sync.students_inserted;
  result.enrolments_inserted = sync.enrolments_inserted;

  // ---- 1. Grade entries (now reads the section_students created in 0e) ----
  result.grade_entries_inserted = await seedGradeEntries(
    service,
    testAy,
    allTermsFull
  );

  // Lock the appropriate set of grading sheets. Active-AY (default): only
  // T1 is locked, T2 stays unlocked so the registrar can demo entry edits
  // + change-request submission. Closed-AY (allTermsFull=true): every
  // term is locked so the Masterfile + T4 report card render with final
  // numbers, and the change-request flow has locked sheets to file
  // requests against.
  {
    const lockTermNumbers = allTermsFull ? [1, 2, 3, 4] : [1];
    const { data: termsToLock } = await service
      .from('terms')
      .select('id, term_number, end_date')
      .eq('academic_year_id', testAy.id)
      .in('term_number', lockTermNumbers);
    for (const term of (termsToLock ?? []) as Array<{
      id: string;
      term_number: number;
      end_date: string | null;
    }>) {
      if (!term.end_date) continue;
      const endDateIso = `${term.end_date}T23:59:59+08:00`;
      const { error } = await service
        .from('grading_sheets')
        .update({ is_locked: true, locked_at: endDateIso })
        .eq('term_id', term.id)
        .eq('is_locked', false);
      if (error) {
        console.error(
          `[populated seeder] T${term.term_number} lock pass failed:`,
          error.message
        );
      }
    }
  }

  // ---- 2. Attendance daily + rollups ----
  const att = await seedAttendanceSummary(service, testAy, allTermsFull);
  result.attendance_daily_inserted = att.daily;
  result.attendance_rollups_built = att.rollups;

  // ---- 3a. Seed test teacher accounts (idempotent — skips existing) ----
  result.test_teachers_created = await seedTestTeachers(service);

  // ---- 3b. Teacher assignments (form advisers + subject teachers) ----
  const ta = await seedTeacherAssignments(service, testAy);
  result.teacher_form_adviser_assignments = ta.form_adviser;
  result.teacher_subject_assignments = ta.subject_teacher;

  // ---- 4. Evaluation writeups ----
  result.evaluation_writeups_inserted = await seedEvaluationWriteups(
    service,
    testAy,
    allTermsFull
  );

  // ---- 7. Discount codes ----
  result.discount_codes_inserted = await seedDiscountCodes(service, testAy);

  // ---- 8. Publication windows (all seeded sections × all target terms) ----
  result.publications_inserted = await seedPublication(
    service,
    testAy,
    allTermsFull
  );

  // ---- 10 + 11. Demo-extras and movements are independent of each other —
  //          both depend only on enrolled apps (seeded in 0b) which is already
  //          complete. Run in parallel for a 2× speedup on these two passes.
  //          These are NON-CRITICAL embellishment passes: a failure here must
  //          NOT abort the seed before the cache-invalidation step below (a
  //          skipped invalidation leaves the long-TTL dashboard/list caches
  //          stale → "0 metric / empty lists while the drill sheet has data").
  try {
    const [demoExtras, movementsInserted] = await Promise.all([
      seedDemoExtras(service, testAy),
      seedMovements(service, testAy),
    ]);
    result.demo_extras = demoExtras;
    result.movements_inserted = movementsInserted;
  } catch (err) {
    console.error(
      '[populated seeder] demo-extras/movements pass failed (non-fatal):',
      err instanceof Error ? err.message : err
    );
  }

  // ---- 13. School-realistic edge cases (late enrollees, withdrawals,
  //          change requests, P-Files chase, compassionate quota, GA 88.4,
  //          mid-year section transfer) — only when all terms are full so
  //          there are locked sheets to file change requests against. Also
  //          non-critical: guarded so a single edge case throwing can't skip
  //          the invalidation + reconciliation below.
  if (allTermsFull) {
    try {
      const ec = await seedEdgeCases(service, testAy);
      result.edge_cases_inserted = ec.edge_cases_inserted;
    } catch (err) {
      console.error(
        '[populated seeder] edge-cases pass failed (non-fatal):',
        err instanceof Error ? err.message : err
      );
    }
  }

  // ---- 14. Bust the per-AY drill + dashboard + list caches so a freshly-
  //          seeded environment renders without waiting for the (up to 10-min)
  //          unstable_cache TTL. A stale snapshot shows 0 on dashboard metrics
  //          and empty admissions/records lists while the lazy-fetched drill
  //          sheet shows the real rows. MUST run even if a late pass above
  //          failed — hence the try/catch guards on 10/11/13.
  invalidateAllOperationalDrills(testAy.ay_code);

  // ---- 15. Reconciliation pass — assert the production invariant that every
  //          enrolled admissions row resolved to a public.students record.
  //          Loud console.error if any orphan exists (the symptom this
  //          admissions-first refactor exists to eliminate).
  result.reconciliation = await reconcileEnrolled(service, testAy);

  return result;
}

// ─── Enrolled-roster config + persona generation (admissions-first) ──────────

// The deterministic per-section enrolled roster. Mirrors the counts the old
// students-first path passed to seedTestAy (P6 Grit 13, P6 Loyalty 12,
// S4 Excellence 25). Resolved against the sections actually present in this AY.
type EnrolledSection = {
  sectionId: string;
  sectionName: string;
  levelCode: string;
  levelLabel: string;
  count: number;
};

const ENROLLED_ROSTER_SPEC = [
  { sectionName: 'Grit', levelCode: 'P6', count: 13 },
  { sectionName: 'Loyalty', levelCode: 'P6', count: 12 },
  { sectionName: 'Excellence', levelCode: 'S4', count: 25 },
] as const;

async function resolveEnrolledRosterConfig(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<EnrolledSection[]> {
  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code, label)')
    .eq('academic_year_id', testAy.id);
  type Row = {
    id: string;
    name: string;
    levels:
      | { code: string; label: string }
      | { code: string; label: string }[]
      | null;
  };
  const sections = (sectionRows ?? []) as Row[];
  const levelOf = (s: Row) =>
    Array.isArray(s.levels) ? s.levels[0] : s.levels;

  const config: EnrolledSection[] = [];
  for (const spec of ENROLLED_ROSTER_SPEC) {
    const match = sections.find((s) => {
      const lvl = levelOf(s);
      return s.name === spec.sectionName && lvl?.code === spec.levelCode;
    });
    if (!match) continue;
    const lvl = levelOf(match)!;
    config.push({
      sectionId: match.id,
      sectionName: match.name,
      levelCode: lvl.code,
      levelLabel: lvl.label,
      count: spec.count,
    });
  }
  return config;
}

// One generated enrolled student. Carries everything the apps/status inserts
// and the sync planner need WITHOUT requiring section_students to exist yet.
type EnrolledPersona = {
  studentNumber: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  levelLabel: string;
  enroleeNumber: string;
  applicationStatus: ApplicationStatus;
};

// Generates the enrolled personas deterministically from the per-section
// config — the same global-sequence H270{ayDigits}{seq4} numbering + per-section
// pickNames as the legacy seedTestAy, so student_numbers are byte-for-byte
// identical and stable across re-runs. Personas are sorted by student_number so
// the persona-quirk ranges (Conditional / Withdrawn / Verified-docs) and the
// enroleeNumber sequence are deterministic regardless of section iteration order.
function buildEnrolledPersonas(
  testAy: { id: string; ay_code: string },
  config: EnrolledSection[]
): EnrolledPersona[] {
  const ayDigits = testAy.ay_code.replace(/^AY/i, '');
  const upperPrefix = prefixFor(testAy.ay_code).toUpperCase();

  // First pass: mint student_number + names using the SAME global sequence and
  // per-section pickNames key as seedTestAy in students.ts.
  type Base = {
    studentNumber: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    sectionId: string;
    sectionName: string;
    levelCode: string;
    levelLabel: string;
  };
  const base: Base[] = [];
  let globalSeq = 0;
  for (const section of config) {
    const names = pickNames(
      `${testAy.ay_code}:${section.sectionId}`,
      section.count
    );
    for (let i = 0; i < section.count; i++) {
      globalSeq += 1;
      const seq4 = String(globalSeq).padStart(4, '0');
      base.push({
        studentNumber: `H270${ayDigits}${seq4}`,
        firstName: names[i].first_name,
        lastName: names[i].last_name,
        middleName: null, // pickNames yields first/last only — same as seedTestAy
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        levelCode: section.levelCode,
        levelLabel: section.levelLabel,
      });
    }
  }

  // Sort by student_number for stable persona-range + enroleeNumber assignment.
  base.sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));

  // Persona quirks layered on the "everything Enrolled" baseline (counted from
  // the start of the sorted array so they're deterministic across re-seeds):
  //   - 3 Enrolled (Conditional) — registrar carve-outs (waiver path).
  //   - 2 Withdrawn post-enrollment — exercises the withdrawal timeline. These
  //     are EXCLUDED from the sync roster so they never become active enrolments.
  // (Verified-docs is a documentStatus quirk handled in seedEnrolledAdmissionsRows.)
  const CONDITIONAL_RANGE = { start: 0, end: 3 };
  const WITHDRAWN_RANGE = { start: 8, end: 10 };
  const statusFor = (i: number): ApplicationStatus => {
    if (i >= CONDITIONAL_RANGE.start && i < CONDITIONAL_RANGE.end)
      return 'Enrolled (Conditional)';
    if (i >= WITHDRAWN_RANGE.start && i < WITHDRAWN_RANGE.end)
      return 'Withdrawn';
    return 'Enrolled';
  };

  return base.map((b, i) => ({
    ...b,
    enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
    applicationStatus: statusFor(i),
  }));
}

// For every (grading_sheet × section_student) pair in T1, insert a
// fully-computed grade_entry (plausible scores + quarterly via
// `computeQuarterly`). For T2 (the active term), insert a PARTIAL entry
// — one WW slot only, empty pt_scores, null qa_score — so the registrar
// can demo entry edits + change-request submission against an "in
// progress" sheet. T3+T4 stay untouched.
async function seedGradeEntries(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  allTermsFull: boolean
): Promise<number> {
  // Skip if any grade_entries already exist for this AY's sheets.
  const { data: sheetIds } = await service
    .from('grading_sheets')
    .select(
      'id, term_id, section_id, subject_config_id, ww_totals, pt_totals, qa_total'
    )
    .in(
      'term_id',
      (
        await service
          .from('terms')
          .select('id')
          .eq('academic_year_id', testAy.id)
      ).data?.map((r) => (r as { id: string }).id) ?? []
    );
  const sheets = (sheetIds ?? []) as Array<{
    id: string;
    term_id: string;
    section_id: string;
    subject_config_id: string;
    ww_totals: number[] | null;
    pt_totals: number[] | null;
    qa_total: number | null;
  }>;
  if (sheets.length === 0) return 0;

  // Idempotent: rely on the migration-035 unique index
  // `(grading_sheet_id, section_student_id)` — duplicate insert attempts
  // are silently dropped by the upsert below. Re-runs only fill in the
  // rows missing from a partial prior seed.

  // Narrow to T1 only — we want T1 publishable-ready, T2+ mostly empty so
  // the registrar can exercise the entry flow. Fetch terms to identify T1.
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>;
  const t1 = terms.find((t) => t.term_number === 1);
  const t2 = terms.find((t) => t.term_number === 2);
  const t3 = terms.find((t) => t.term_number === 3);
  const t4 = terms.find((t) => t.term_number === 4);
  if (!t1) return 0;

  // Active-AY: T1 full + T2 partial. Closed-AY: T1-T4 all full so the
  // Masterfile awards + T4 report card General Average compute (KD #95).
  const targetTermIds = allTermsFull
    ? [t1, t2, t3, t4]
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => t.id)
    : t2
      ? [t1.id, t2.id]
      : [t1.id];
  const fullTermIds = new Set(
    allTermsFull ? targetTermIds : [t1.id] // active-AY: only T1 is "full"; T2 is the partial term
  );
  const targetSheets = sheets.filter((s) => targetTermIds.includes(s.term_id));

  // Pull every section_student per section we're about to seed.
  const sectionIds = [...new Set(targetSheets.map((s) => s.section_id))];
  const { data: enrolments } = await service
    .from('section_students')
    .select('id, section_id, student_id')
    .in('section_id', sectionIds);
  const enrolmentsBySection = new Map<
    string,
    Array<{ id: string; student_id: string }>
  >();
  for (const e of (enrolments ?? []) as Array<{
    id: string;
    section_id: string;
    student_id: string;
  }>) {
    if (!enrolmentsBySection.has(e.section_id))
      enrolmentsBySection.set(e.section_id, []);
    enrolmentsBySection
      .get(e.section_id)!
      .push({ id: e.id, student_id: e.student_id });
  }

  // Pull weights per subject_config_id (needed for computeQuarterly).
  const configIds = [...new Set(targetSheets.map((s) => s.subject_config_id))];
  const { data: cfgs } = await service
    .from('subject_configs')
    .select('id, ww_weight, pt_weight, qa_weight, subjects(is_examinable)')
    .in('id', configIds);
  const configById = new Map(
    (
      (cfgs ?? []) as Array<{
        id: string;
        ww_weight: number;
        pt_weight: number;
        qa_weight: number;
        subjects:
          | { is_examinable: boolean }
          | { is_examinable: boolean }[]
          | null;
      }>
    ).map((c) => {
      const subj = Array.isArray(c.subjects) ? c.subjects[0] : c.subjects;
      return [c.id, { ...c, is_examinable: subj?.is_examinable ?? true }];
    })
  );

  type InsertRow = {
    grading_sheet_id: string;
    section_student_id: string;
    ww_scores: number[];
    pt_scores: number[];
    qa_score: number | null;
    ww_ps: number | null;
    pt_ps: number | null;
    qa_ps: number | null;
    initial_grade: number | null;
    quarterly_grade: number | null;
    is_na: boolean;
    letter_grade: string | null;
    annual_letter_grade: string | null;
    created_at: string;
    // Real entry saves stamp updated_at = now() on every PATCH (the entries
    // route). The DB default is now() (seed-time, clustered), which makes
    // updated_at-keyed grade features look like every grade was last touched
    // at the instant the env was seeded. Set it to the SAME per-entry
    // term-spread value as created_at so the seeded picture is faithful.
    updated_at: string;
  };
  const inserts: InsertRow[] = [];

  const rand = mulberry32(hashString(`${testAy.ay_code}:grades`));

  // Per-student "academic quality" tier so the AY9998 Masterfile shows a
  // realistic spread across all four award tiers — not just Bronze. Without
  // this, every student's 4-term × 5-subject mean clusters around ~89 (law
  // of large numbers averages random per-cell scores), and every Subject
  // Award badge renders Bronze.
  //
  // Distribution targets approximate per-student award outcomes:
  //   25% high-quality      → raw 92-100% → Quarterly ~95-100 → **Gold**
  //   30% mid-high quality  → raw 85-92%  → Quarterly ~90-95  → **Silver**
  //   30% mid quality       → raw 80-85%  → Quarterly ~87-90  → **Bronze**
  //   15% low quality       → raw 65-80%  → Quarterly ~78-87  → **Not eligible**
  //
  // Per-student quality is memoized so the same student scores consistently
  // across all 4 terms × 5 subjects — that's how real students behave and
  // how the Subject Overall + Subject Award concentrate per tier rather
  // than smearing into Bronze for everyone.
  const studentQuality = new Map<string, number>();
  const qualityFor = (studentId: string): number => {
    const cached = studentQuality.get(studentId);
    if (cached != null) return cached;
    const r = rand();
    let baseline: number;
    if (r < 0.25)
      baseline = 0.92 + rand() * 0.08; // 92-100%
    else if (r < 0.55)
      baseline = 0.85 + rand() * 0.07; // 85-92%
    else if (r < 0.85)
      baseline = 0.8 + rand() * 0.05; // 80-85%
    else baseline = 0.65 + rand() * 0.15; // 65-80%
    studentQuality.set(studentId, baseline);
    return baseline;
  };

  // Per-student term trajectory — assigned once per student and memoized.
  // ~27% of students get a non-steady trajectory so that opening T2/T3/T4
  // grading sheets shows multiple flagged students in the Alerts column
  // (threshold = |diff| ≥ 5 quarterly points, per computeComparisons in
  // score-entry-grid.tsx).
  //
  // ABSOLUTE per-term baselines (percent of max, term 1–4):
  //   improving : [0.60, 0.75, 0.88, 0.98]  → consecutive diffs ≥10 pts ✓
  //   declining : [0.98, 0.84, 0.70, 0.58]  → consecutive diffs ≥12 pts ✓
  //   volatile  : [0.92, 0.66, 0.92, 0.66]  → consecutive diffs ≥24 pts ✓
  //   steady    : uses qualityFor() — no table entry
  //
  // Using ABSOLUTE baselines (not quality+offset) guarantees that the
  // transmutation compression and ±3% per-cell variance cannot collapse a
  // consecutive-term swing below the 5-point alert threshold. High-quality
  // "declining" students no longer clamp at 1.0 for T1 (0.98 never hits
  // the ceiling), and the wide deltas absorb the full variance budget.
  //
  // Math sanity-check (approximate quarterly grades after transmutation;
  // transmutation maps raw% → ~raw%×100 at this score range):
  //   improving : ~60→~75→~88→~98  diffs: 15, 13, 10  (all ≥ 5)  ✓
  //   declining : ~98→~84→~70→~58  diffs: 14, 14, 12  (all ≥ 5)  ✓
  //   volatile  : ~92→~66→~92→~66  diffs: 26, 26, 26  (all ≥ 5)  ✓
  //
  // Alerts only surface when quarterly grades exist for ≥2 terms, which the
  // seeded AYs satisfy because switchEnvironment('test') seeds both AY9999
  // and the prior AY (AY9998) with allTermsFull: true — all 4 terms have
  // computed quarterly grades.
  type Trajectory = 'improving' | 'declining' | 'volatile' | 'steady';
  const TRAJECTORY_BASELINES: Record<
    Exclude<Trajectory, 'steady'>,
    [number, number, number, number]
  > = {
    improving: [0.6, 0.75, 0.88, 0.98],
    declining: [0.98, 0.84, 0.7, 0.58],
    volatile: [0.92, 0.66, 0.92, 0.66],
  };
  const studentTrajectory = new Map<string, Trajectory>();
  const trajectoryFor = (studentId: string): Trajectory => {
    const cached = studentTrajectory.get(studentId);
    if (cached != null) return cached;
    const r = rand();
    let t: Trajectory;
    if (r < 0.09) t = 'improving';
    else if (r < 0.18) t = 'declining';
    else if (r < 0.27) t = 'volatile';
    else t = 'steady';
    studentTrajectory.set(studentId, t);
    return t;
  };

  // Per-cell score.
  //
  // Steady students (~73%): use qualityFor(studentId) as the baseline so the
  // award-tier spread (Gold/Silver/Bronze/NE) is preserved across the
  // masterfile exactly as before.
  //
  // Trajectory students (~27%): use TRAJECTORY_BASELINES[traj][termIdx] as
  // the ABSOLUTE baseline instead of qualityFor — this guarantees consecutive-
  // term quarterly swings ≥5 regardless of the student's quality tier or the
  // ±3% per-cell variance. qualityFor is NOT called for trajectory students so
  // their RNG slot is consumed only by trajectoryFor; the PRNG sequence stays
  // deterministic per AY.
  //
  // Both paths apply the same ±3% cell variance and the same [0.5, 1.0] clamp
  // (the absolute baselines are chosen well inside that range — 0.58–0.98 —
  // so the clamp is effectively dead code for trajectory students).
  const scoreFor = (
    max: number,
    studentId: string,
    termNumber: number
  ): number => {
    const traj = trajectoryFor(studentId);
    // term_number is 1-indexed; array index is 0-indexed
    const termIdx = Math.max(0, Math.min(3, termNumber - 1));
    const baseline =
      traj === 'steady'
        ? qualityFor(studentId)
        : TRAJECTORY_BASELINES[traj][termIdx];
    const variance = (rand() - 0.5) * 0.06; // ±3 percentage points
    const pct = Math.max(0.5, Math.min(1.0, baseline + variance));
    return Math.round(pct * max);
  };

  // Spread `created_at` across the term window so the per-day velocity
  // chart shows a distribution instead of one spike. Closed terms: full
  // start→end span. Active term (T2 in active-AY mode): start→today.
  // Falls back to seed-time if the term lacks dates.
  const termById = new Map<string, (typeof terms)[number]>();
  for (const t of terms) termById.set(t.id, t);
  const todayMs = Date.now();
  const createdAtForTerm = (termId: string): string => {
    const term = termById.get(termId);
    if (!term?.start_date) return new Date().toISOString();
    const startMs = new Date(`${term.start_date}T00:00:00+08:00`).getTime();
    const isFull = fullTermIds.has(termId);
    const upperIso =
      isFull && term.end_date ? `${term.end_date}T23:59:59+08:00` : null;
    const upperMs = upperIso ? new Date(upperIso).getTime() : todayMs;
    if (upperMs <= startMs) return new Date().toISOString();
    const ms = startMs + Math.floor(rand() * (upperMs - startMs));
    return new Date(ms).toISOString();
  };

  for (const sheet of targetSheets) {
    const enrolments = enrolmentsBySection.get(sheet.section_id) ?? [];
    const cfg = configById.get(sheet.subject_config_id);
    if (!cfg) continue;

    const ww_totals =
      (sheet.ww_totals ?? []).length > 0
        ? (sheet.ww_totals as number[])
        : [10, 10];
    const pt_totals =
      (sheet.pt_totals ?? []).length > 0
        ? (sheet.pt_totals as number[])
        : [10, 10, 10];
    const qa_total = sheet.qa_total ?? 30;

    const isFullTerm = fullTermIds.has(sheet.term_id);
    const isNonExam = !(
      configById.get(sheet.subject_config_id)?.is_examinable ?? true
    );
    const isT4 = t4 != null && sheet.term_id === t4.id;

    // Resolve term number (1–4) for this sheet so trajectory offsets can be
    // applied correctly. Falls back to 1 if the term is not found (safe —
    // offset[0] for steady is 0 and for trajectory students it's a valid value).
    const sheetTermNumber = termById.get(sheet.term_id)?.term_number ?? 1;

    for (const e of enrolments) {
      // One per-entry timestamp shared by created_at AND updated_at — mirrors
      // a real save (the entries route stamps updated_at = now() each PATCH).
      const entryTimestamp = createdAtForTerm(sheet.term_id);
      if (isFullTerm) {
        // Full term (T1, or all 4 terms in closed-AY mode): full WW + PT
        // + QA, computed quarterly.
        const ww_scores = ww_totals.map((max) =>
          scoreFor(max, e.student_id, sheetTermNumber)
        );
        const pt_scores = pt_totals.map((max) =>
          scoreFor(max, e.student_id, sheetTermNumber)
        );
        const qa_score = scoreFor(qa_total, e.student_id, sheetTermNumber);

        const computed = computeQuarterly({
          ww_scores,
          ww_totals,
          pt_scores,
          pt_totals,
          qa_score,
          qa_total,
          ww_weight: cfg.ww_weight,
          pt_weight: cfg.pt_weight,
          qa_weight: cfg.qa_weight,
        });

        const naRoll = isNonExam && rand() < 0.05;
        inserts.push({
          grading_sheet_id: sheet.id,
          section_student_id: e.id,
          ww_scores: naRoll ? [] : ww_scores,
          pt_scores: naRoll ? [] : pt_scores,
          qa_score: naRoll ? null : qa_score,
          ww_ps: naRoll ? null : computed.ww_ps,
          pt_ps: naRoll ? null : computed.pt_ps,
          qa_ps: naRoll ? null : computed.qa_ps,
          initial_grade: naRoll ? null : computed.initial_grade,
          quarterly_grade: naRoll ? null : computed.quarterly_grade,
          is_na: naRoll,
          letter_grade: null,
          // T4 non-examinable: always seed 'Passed' (standard year-end final
          // grade per KD #100). N/A rows stay null — they have no final grade.
          annual_letter_grade: isNonExam && isT4 && !naRoll ? 'Passed' : null,
          created_at: entryTimestamp,
          updated_at: entryTimestamp,
        });
      } else {
        // T2 (active): seed a PARTIAL entry — one WW slot only, empty
        // PT, null QA. Sheets look "in progress"; quarterly stays null
        // until the rest of the slots are filled. Still call
        // computeQuarterly so ww_ps reflects the single slot recorded.
        const firstMax = ww_totals[0] ?? 10;
        const ww_scores = [scoreFor(firstMax, e.student_id, sheetTermNumber)];
        const pt_scores: number[] = [];
        const qa_score = null;

        const computed = computeQuarterly({
          ww_scores,
          ww_totals,
          pt_scores,
          pt_totals,
          qa_score,
          qa_total,
          ww_weight: cfg.ww_weight,
          pt_weight: cfg.pt_weight,
          qa_weight: cfg.qa_weight,
        });

        inserts.push({
          grading_sheet_id: sheet.id,
          section_student_id: e.id,
          ww_scores,
          pt_scores,
          qa_score,
          ww_ps: computed.ww_ps,
          pt_ps: computed.pt_ps,
          qa_ps: computed.qa_ps,
          initial_grade: computed.initial_grade,
          quarterly_grade: computed.quarterly_grade,
          is_na: false,
          letter_grade: null,
          annual_letter_grade: null,
          created_at: entryTimestamp,
          updated_at: entryTimestamp,
        });
      }
    }
  }

  // Chunked upsert — 500 rows per round-trip.
  //
  // active-AY (allTermsFull=false): ignoreDuplicates so re-runs only fill
  // missing rows. Existing T1+T2 entries (full + partial respectively)
  // are preserved.
  //
  // closed-AY (allTermsFull=true): OVERWRITE on conflict. Critical — if
  // a prior run was made in active-AY mode (legacy state, before the
  // KD #95 prior-year fix), T2 will have partial entries left from that
  // run. With ignoreDuplicates the partial T2 rows survive, so Subject
  // Overall stays null and the Masterfile awards never render. Overwriting
  // upgrades the partial T2 + writes T3+T4 fresh in one pass.
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error } = await service.from('grade_entries').upsert(slice, {
      onConflict: 'grading_sheet_id,section_student_id',
      ignoreDuplicates: !allTermsFull,
    });
    if (!error) inserted += slice.length;
  }
  return inserted;
}

// Daily attendance for T1+T2 with a temporal split. T1 (closed term):
// every encodable school day is seeded. T2 (active term): only dates up
// to today, so the demo AY shows a partial-month-in-progress state. T3+T4
// stay empty.
//
// Inserts one `attendance_daily` row per (section_student × encodable
// school day in window) with a P-heavy random status distribution, then
// calls the `recompute_attendance_rollup` RPC per (section_student, term)
// so `attendance_records` mirrors what the wide-grid shows. Production
// uses the same rollup path — seeding via the same pipeline keeps the
// two views consistent.
async function seedAttendanceSummary(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  allTermsFull: boolean
): Promise<{ daily: number; rollups: number }> {
  const targetTermNumbers = allTermsFull ? [1, 2, 3, 4] : [1, 2];
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id)
    .in('term_number', targetTermNumbers)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>;
  if (terms.length === 0) return { daily: 0, rollups: 0 };

  // Idempotent: build the full expected (section_student × date) set for
  // each term's encodable days, subtract any tuples that already exist in
  // attendance_daily, and insert the remainder. attendance_daily has no
  // unique constraint (append-only — corrections insert a new row and
  // latest recorded_at wins), so we filter manually before inserting.

  // All enrolments in the AY (shared across both terms).
  const { data: sections } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', testAy.id);
  const sectionIds = (sections ?? []).map((r) => (r as { id: string }).id);
  if (sectionIds.length === 0) return { daily: 0, rollups: 0 };
  const { data: enrolments } = await service
    .from('section_students')
    .select('id')
    .in('section_id', sectionIds);
  const enrolList = ((enrolments ?? []) as Array<{ id: string }>).map(
    (e) => e.id
  );
  if (enrolList.length === 0) {
    console.warn(
      '[populated seeder] attendance: no enrolments in test AY — skipping'
    );
    return { daily: 0, rollups: 0 };
  }

  // Weighted random status picker (P heavy, small mix of L/A/EX). Single
  // PRNG instance threaded across both terms so determinism holds. EX rows
  // also get an `ex_reason` from the HFSE-aligned enum (mc | compassionate
  // | vacation, migration 070) so the donut / compassionate-quota /
  // vacation-quota drills have meaningful spread (KD #94).
  const rand = mulberry32(hashString(`${testAy.ay_code}:attendance-daily`));
  type ExReason = 'mc' | 'compassionate' | 'vacation';
  function pickExReason(): ExReason {
    const r = rand();
    if (r < 0.6) return 'mc';
    if (r < 0.85) return 'compassionate';
    return 'vacation';
  }
  function pickStatus(): {
    status: 'P' | 'L' | 'A' | 'EX';
    ex_reason: ExReason | null;
  } {
    const r = rand();
    if (r < 0.9) return { status: 'P', ex_reason: null };
    if (r < 0.94) return { status: 'L', ex_reason: null };
    if (r < 0.97) return { status: 'A', ex_reason: null };
    return { status: 'EX', ex_reason: pickExReason() };
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  let insertedDaily = 0;
  let rollupCount = 0;

  for (const term of terms) {
    // Encodable school days in this term (school_day + hbl).
    const { data: calendarRows } = await service
      .from('school_calendar')
      .select('date, day_type')
      .eq('term_id', term.id)
      .in('day_type', ['school_day', 'hbl'])
      .order('date');
    let schoolDays = (
      (calendarRows ?? []) as Array<{ date: string; day_type: string }>
    ).map((r) => r.date);
    if (schoolDays.length === 0) {
      console.warn(
        `[populated seeder] attendance: no encodable school days in T${term.term_number} — skipping`
      );
      continue;
    }

    // Temporal split: if today falls inside this term's window, only seed
    // dates up to today. T1 closed (today > end_date) → no filter, all
    // dates seeded. T2 active (start_date <= today <= end_date) → today
    // is the upper bound. Term entirely in the future (today < start_date)
    // → schoolDays becomes empty and we skip.
    //
    // Closed-AY mode (allTermsFull=true): every term is treated as closed
    // regardless of date, so prior-year AYs end up with full attendance
    // across all 4 terms even though their term dates are still calendar-
    // valid relative to today.
    if (!allTermsFull && term.start_date && term.end_date) {
      if (todayIso >= term.start_date && todayIso <= term.end_date) {
        schoolDays = schoolDays.filter((d) => d <= todayIso);
      } else if (todayIso < term.start_date) {
        // Entirely future — leave T-future empty.
        continue;
      }
      // else: entirely past (todayIso > end_date) → no filter.
    }
    if (schoolDays.length === 0) continue;

    // Build the expected set for this term, then exclude tuples that
    // already exist (re-runs only fill in the diff).
    const allRows: Array<{
      section_student_id: string;
      term_id: string;
      date: string;
      status: 'P' | 'L' | 'A' | 'EX';
      ex_reason: ExReason | null;
    }> = [];
    for (const enrolmentId of enrolList) {
      for (const date of schoolDays) {
        const picked = pickStatus();
        allRows.push({
          section_student_id: enrolmentId,
          term_id: term.id,
          date,
          status: picked.status,
          ex_reason: picked.ex_reason,
        });
      }
    }

    // Page over existing tuples for this term so we don't insert
    // duplicates. PostgREST caps single responses at 1000 rows; use the
    // shared paginate helper (KD note in lib/supabase/paginate.ts).
    const existingDailyRows = await fetchAllPages<{
      section_student_id: string;
      date: string;
    }>((from, to) =>
      service
        .from('attendance_daily')
        .select('section_student_id, date')
        .eq('term_id', term.id)
        .range(from, to)
    );
    const existingTuples = new Set(
      existingDailyRows.map((r) => `${r.section_student_id}|${r.date}`)
    );
    const rows = allRows.filter(
      (r) => !existingTuples.has(`${r.section_student_id}|${r.date}`)
    );

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await service.from('attendance_daily').insert(slice);
      if (error) {
        console.error(
          `[populated seeder] attendance_daily T${term.term_number} insert failed:`,
          error.message
        );
        continue;
      }
      insertedDaily += slice.length;
    }

    // Fire the rollup RPC once per section_student × term so
    // `attendance_records` reflects the daily ledger. Same path
    // production uses after each daily write.
    for (const enrolmentId of enrolList) {
      const { error } = await service.rpc('recompute_attendance_rollup', {
        p_term_id: term.id,
        p_section_student_id: enrolmentId,
      });
      if (error) {
        console.error(
          `[populated seeder] rollup RPC failed for T${term.term_number} ${enrolmentId}:`,
          error.message
        );
        continue;
      }
      rollupCount += 1;
    }
  }

  return { daily: insertedDaily, rollups: rollupCount };
}

// Seeds evaluation writeups, faithful to the real adviser write path
// (PATCH /api/evaluation/writeups): every row carries `created_by` (the
// section's form adviser), and `submitted_at` is stamped at the moment of
// submission — which real advisers do spread across the term, NOT all at the
// term-end instant.
//
// Closed-AY mode (allTermsFull=true): T1, T2, T3 each get all enrolled
// students' submitted writeups, submitted_at spread across the term window;
// T4 stays empty per KD #49 (no FCA comment on T4 by design).
//
// Active-AY mode (default): T1 fully submitted (closed term, spread across
// the window). T2 is the live term — a realistic mid-term mix across the WHOLE
// roster (~65% submitted, the rest still drafts), each submission spread
// between the term start and today — not just 3 token rows.
async function seedEvaluationWriteups(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  allTermsFull: boolean
): Promise<number> {
  const targetTermNumbers = allTermsFull ? [1, 2, 3] : [1, 2];
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id)
    .in('term_number', targetTermNumbers)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>;
  if (terms.length === 0) return 0;
  const t1 = terms.find((t) => t.term_number === 1);
  const t2 = terms.find((t) => t.term_number === 2);
  const t3 = terms.find((t) => t.term_number === 3);

  // Idempotent: migration-018 unique `(term_id, student_id)` lets the
  // upsert below silently drop duplicates on re-run.

  const { data: sections } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', testAy.id);
  const sectionIds = (sections ?? []).map((r) => (r as { id: string }).id);
  if (sectionIds.length === 0) return 0;

  // created_by fidelity — the real upsert stamps the acting adviser's user id.
  // Resolve the form adviser per section from teacher_assignments (seeded in
  // step 3b, before this pass). Null when a section has no adviser (the column
  // is nullable; the real route would also write null if somehow unset).
  const { data: faRows } = await service
    .from('teacher_assignments')
    .select('section_id, teacher_user_id')
    .eq('role', 'form_adviser')
    .in('section_id', sectionIds);
  const adviserBySection = new Map<string, string>();
  for (const r of (faRows ?? []) as Array<{
    section_id: string;
    teacher_user_id: string;
  }>) {
    if (!adviserBySection.has(r.section_id))
      adviserBySection.set(r.section_id, r.teacher_user_id);
  }

  const rand = mulberry32(hashString(`${testAy.ay_code}:writeups`));
  const TEMPLATES = [
    'Shows steady improvement this term. Participates well in group activities and demonstrates a strong sense of responsibility during classroom duties.',
    'A diligent learner who asks thoughtful questions. Could benefit from more proactive contributions in discussions.',
    'Exemplifies the virtue through consistent effort and kindness toward peers. Academic focus has strengthened noticeably.',
    'Demonstrates genuine curiosity and persistence in the face of challenges. Continues to develop leadership presence.',
    'A pleasure to have in class — composed, attentive, and supportive of classmates who need help.',
  ];

  const writeupRows: Array<{
    term_id: string;
    student_id: string;
    section_id: string;
    writeup: string;
    submitted: boolean;
    submitted_at: string | null;
    created_by: string | null;
  }> = [];

  // Deterministic submitted_at spread within a term window, matching how a real
  // adviser files write-ups across the term rather than all at one instant.
  // Closed term: anywhere in [start, end]. Active term (start <= today <= end):
  // anywhere in [start, today]. Falls back to a fixed end-of-term stamp / now()
  // when the term lacks dates.
  const todayMs = Date.now();
  const submittedAtFor = (term: {
    start_date: string | null;
    end_date: string | null;
  }): string => {
    if (!term.start_date) {
      return term.end_date
        ? `${term.end_date}T17:00:00+08:00`
        : new Date().toISOString();
    }
    const startMs = new Date(`${term.start_date}T08:00:00+08:00`).getTime();
    const endMs = term.end_date
      ? new Date(`${term.end_date}T17:00:00+08:00`).getTime()
      : todayMs;
    // Active term currently in progress → cap the upper bound at today so we
    // never stamp a future submission.
    const upperMs = Math.min(endMs, Math.max(startMs, todayMs));
    if (upperMs <= startMs) return new Date(startMs).toISOString();
    return new Date(
      startMs + Math.floor(rand() * (upperMs - startMs))
    ).toISOString();
  };

  // Helper — push one student's writeup for a term, with created_at-spread
  // submitted_at when submitted (null when draft).
  const pushWriteup = (
    term: { id: string; start_date: string | null; end_date: string | null },
    sectionId: string,
    studentId: string,
    submitted: boolean
  ) => {
    const tmpl = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
    writeupRows.push({
      term_id: term.id,
      student_id: studentId,
      section_id: sectionId,
      writeup: tmpl,
      submitted,
      submitted_at: submitted ? submittedAtFor(term) : null,
      created_by: adviserBySection.get(sectionId) ?? null,
    });
  };

  for (const sectionId of sectionIds) {
    // T1 — all enrolled students' submitted writeups (closed term; submitted_at
    // spread across the T1 window).
    if (t1) {
      const { data: enrolments } = await service
        .from('section_students')
        .select('student_id')
        .eq('section_id', sectionId);
      const students = (enrolments ?? []) as Array<{ student_id: string }>;
      for (const s of students) pushWriteup(t1, sectionId, s.student_id, true);
    }

    // T2 — closed-AY: all enrolled students' submitted writeups (mirrors T1).
    //      active-AY: live mid-term mix across the WHOLE roster — ~65%
    //      submitted, the rest still drafts (submitted_at null), submissions
    //      spread between term start and today.
    if (t2) {
      const { data: enrolments } = await service
        .from('section_students')
        .select('student_id')
        .eq('section_id', sectionId);
      const students = (enrolments ?? []) as Array<{ student_id: string }>;
      students.forEach((s) => {
        // Closed-AY: every T2 write-up submitted. Active-AY: ~65% submitted.
        const submitted = allTermsFull || rand() < 0.65;
        pushWriteup(t2, sectionId, s.student_id, submitted);
      });
    }

    // T3 (closed-AY only) — all enrolled students' submitted writeups (mirrors T1).
    if (allTermsFull && t3) {
      const { data: enrolments } = await service
        .from('section_students')
        .select('student_id')
        .eq('section_id', sectionId);
      const students = (enrolments ?? []) as Array<{ student_id: string }>;
      for (const s of students) pushWriteup(t3, sectionId, s.student_id, true);
    }
  }

  if (writeupRows.length === 0) return 0;
  const { error } = await service
    .from('evaluation_writeups')
    .upsert(writeupRows, {
      onConflict: 'term_id,student_id',
      ignoreDuplicates: true,
    });
  return error ? 0 : writeupRows.length;
}

// Canonical applicationStatus union — matches STAGE_STATUS_OPTIONS.application
// in lib/schemas/sis.ts (post-Directus consolidation 2026-04-24).
type ApplicationStatus =
  | 'Submitted'
  | 'Ongoing Verification'
  | 'Processing'
  | 'Enrolled'
  | 'Enrolled (Conditional)'
  | 'Cancelled'
  | 'Withdrawn';

// Per-funnel-stage 5-prereq fill profile. The five columns line up with
// ENROLLED_PREREQ_STAGES + STAGE_TERMINAL_STATUS in lib/schemas/sis.ts.
type StageProgression = {
  registrationStatus: string | null;
  documentStatus: string | null;
  assessmentStatus: string | null;
  contractStatus: string | null;
  feeStatus: string | null;
};

// Builds a plausible per-stage status fill given a profile name. Profiles
// map 1:1 to applicationStatus values except for "withdrawn-pre-enrolment"
// which is a sub-flavor of Withdrawn (got far in the pipeline before pulling
// out). The lifecycle aggregate widget keys off this column matrix to slot
// rows into "ungated to enroll" / "at contract" / "at fees" buckets.
function stageProgressionFor(
  profile:
    | 'submitted'
    | 'ongoing-verification'
    | 'processing'
    | 'cancelled'
    | 'withdrawn-pre-enrolment',
  rand: () => number
): StageProgression & { ungatedToEnroll: boolean } {
  switch (profile) {
    case 'submitted':
      return {
        registrationStatus: null,
        documentStatus: null,
        assessmentStatus: null,
        contractStatus: null,
        feeStatus: null,
        ungatedToEnroll: false,
      };
    case 'ongoing-verification':
      return {
        registrationStatus: 'Finished',
        documentStatus: rand() < 0.5 ? 'Pending' : 'Verified',
        assessmentStatus: 'Pending',
        contractStatus: null,
        feeStatus: null,
        ungatedToEnroll: false,
      };
    case 'processing': {
      // ~45% of Processing rows are fully ungated (all 5 prereqs at terminal
      // status) — appears in the "Ungated to enroll" lifecycle bucket as
      // ready-to-flip applicants the registrar should be processing.
      const ungated = rand() < 0.45;
      if (ungated) {
        return {
          registrationStatus: 'Finished',
          documentStatus: 'Finished',
          assessmentStatus: 'Finished',
          contractStatus: 'Signed',
          feeStatus: 'Paid',
          ungatedToEnroll: true,
        };
      }
      const r = rand();
      if (r < 0.33) {
        // At contract stage — assessment finished, contract drafted/sent.
        return {
          registrationStatus: 'Finished',
          documentStatus: 'Finished',
          assessmentStatus: 'Finished',
          contractStatus: rand() < 0.5 ? 'Generated' : 'Sent',
          feeStatus: 'Pending',
          ungatedToEnroll: false,
        };
      } else if (r < 0.66) {
        // At fee stage — contract signed, awaiting payment.
        return {
          registrationStatus: 'Finished',
          documentStatus: 'Finished',
          assessmentStatus: 'Finished',
          contractStatus: 'Signed',
          feeStatus: rand() < 0.5 ? 'Invoiced' : 'Re-invoiced',
          ungatedToEnroll: false,
        };
      } else {
        // At assessment stage — registration + docs done, assessment pending.
        return {
          registrationStatus: 'Finished',
          documentStatus: 'Finished',
          assessmentStatus: rand() < 0.5 ? 'Pending' : 'Ongoing Assessment',
          contractStatus: null,
          feeStatus: null,
          ungatedToEnroll: false,
        };
      }
    }
    case 'cancelled':
      return {
        registrationStatus: rand() < 0.5 ? 'Cancelled' : 'Pending',
        documentStatus: null,
        assessmentStatus: null,
        contractStatus: null,
        feeStatus: null,
        ungatedToEnroll: false,
      };
    case 'withdrawn-pre-enrolment':
      // Got partway then pulled out — show effort-spent through assessment.
      return {
        registrationStatus: 'Finished',
        documentStatus: 'Finished',
        assessmentStatus: 'Finished',
        contractStatus: null,
        feeStatus: null,
        ungatedToEnroll: false,
      };
    default:
      return {
        registrationStatus: null,
        documentStatus: null,
        assessmentStatus: null,
        contractStatus: null,
        feeStatus: null,
        ungatedToEnroll: false,
      };
  }
}

// Canonical funnel mix used by seedAdmissionsFunnel — total 33 rows across
// the five non-Enrolled applicationStatus values. Distribution chosen so the
// dashboard's lifecycle aggregate has data in every bucket: Submitted (no
// admin work), Ongoing Verification (in-flight), Processing (varied — some
// ungated, some at contract/fees/assessment), Cancelled (admin-killed),
// Withdrawn (pulled out partway).
const FUNNEL_PROFILES: ReadonlyArray<{
  applicationStatus: ApplicationStatus;
  count: number;
  stageProfile:
    | 'submitted'
    | 'ongoing-verification'
    | 'processing'
    | 'cancelled'
    | 'withdrawn-pre-enrolment';
}> = [
  { applicationStatus: 'Submitted', count: 8, stageProfile: 'submitted' },
  {
    applicationStatus: 'Ongoing Verification',
    count: 8,
    stageProfile: 'ongoing-verification',
  },
  { applicationStatus: 'Processing', count: 12, stageProfile: 'processing' },
  { applicationStatus: 'Cancelled', count: 3, stageProfile: 'cancelled' },
  {
    applicationStatus: 'Withdrawn',
    count: 2,
    stageProfile: 'withdrawn-pre-enrolment',
  },
];

// 4-value enum mirrored across the apps row's `category` and the status row's
// `enroleeType`. They always agree. Distribution: ~70% Current (returning),
// ~25% New (first-time), ~3% VizSchool Current, ~2% VizSchool New.
type EnroleeCategoryValue =
  | 'New'
  | 'Current'
  | 'VizSchool New'
  | 'VizSchool Current';
function pickEnroleeCategory(rand: () => number): EnroleeCategoryValue {
  const r = rand();
  if (r < 0.7) return 'Current';
  if (r < 0.95) return 'New';
  if (r < 0.98) return 'VizSchool Current';
  return 'VizSchool New';
}

// ─── Student profile data pools ──────────────────────────────────────────────

const GENDERS = ['Male', 'Female'] as const;

const RELIGIONS = [
  'Christianity',
  'Roman Catholic',
  'Islam',
  'Buddhism',
  'Hinduism',
  'No Religion',
] as const;

const PRIMARY_LANGUAGES = [
  'English',
  'Filipino',
  'Mandarin Chinese',
  'Tamil',
  'Hindi',
] as const;

// Singapore residential addresses — realistic district spread.
const SG_ADDRESSES = [
  { street: '12 Nassim Road', postal: 258371 },
  { street: '45 Bukit Timah Road', postal: 229843 },
  { street: '78 Orchard Boulevard', postal: 248649 },
  { street: '23 Holland Grove Road', postal: 278797 },
  { street: '9 Watten Estate Road', postal: 287927 },
  { street: '56 Duchess Road', postal: 269107 },
  { street: '31 Greenwood Avenue', postal: 289210 },
  { street: '14 Coronation Road West', postal: 269173 },
  { street: '88 Lornie Road', postal: 298748 },
  { street: '5 Mount Pleasant Road', postal: 298065 },
  { street: '102 Sunset Way', postal: 597091 },
  { street: '37 Upper Thomson Road', postal: 574319 },
  { street: '19 Jalan Bahasa', postal: 219492 },
  { street: '63 Bartley Road', postal: 539786 },
  { street: '28 Serangoon Garden Way', postal: 555930 },
] as const;

const PREVIOUS_SCHOOLS = [
  'Nanyang Primary School',
  'Anglo-Chinese School (Primary)',
  "St. Joseph's Institution Junior",
  "Raffles Girls' Primary School",
  "Methodist Girls' School (Primary)",
  'CHIJ Our Lady of Good Counsel',
  'Maha Bodhi School',
  'Fairfield Methodist School (Primary)',
  'International School of Singapore',
  'SJI International',
  'Tanglin Trust School',
  'Canadian International School',
  'Chatsworth International School',
  'Overseas Family School',
  'Home-schooled',
] as const;

// Realistic allergy detail strings.
const ALLERGY_DETAILS = [
  'Peanut allergy — carries EpiPen',
  'Shellfish allergy (prawns, crabs)',
  'Dust mite allergy',
  'Cat and dog dander',
  'Bee sting allergy',
] as const;

const FOOD_ALLERGY_DETAILS = [
  'Peanuts and tree nuts',
  'Milk and dairy products',
  'Eggs',
  'Wheat / gluten',
  'Soy products',
] as const;

const DIETARY_RESTRICTIONS = [
  'No pork',
  'Halal',
  'Vegetarian',
  'Vegan',
  'Lactose intolerant — no dairy',
  'No beef',
  'Pescatarian',
] as const;

const OTHER_CONDITIONS = [
  'Mild ADHD — on medication, school informed',
  'Anxiety — counselling in progress',
  'Speech delay — receives therapy',
  'Mild hearing loss (left ear)',
  'Visually impaired — wears corrective lenses',
] as const;

// Derive nationality from pass type for the student row (distinct from parent
// nationality which uses the same NATIONALITY_BY_PASS map on parent fields).
const STUDENT_NATIONALITY_BY_PASS: Record<string, string[]> = {
  'Singapore PR': ['Singaporean', 'Filipino', 'Indian', 'Chinese'],
  'S-PASS': ['Filipino', 'Indian', 'British', 'Australian', 'American'],
  'Dependent Pass': [
    'Indian',
    'British',
    'American',
    'Korean',
    'Japanese',
    'Indonesian',
  ],
};

function pickStudentNationality(
  rand: () => number,
  passType: string | null
): string {
  if (!passType) return 'Singaporean';
  const pool = STUDENT_NATIONALITY_BY_PASS[passType];
  if (!pool) return 'Filipino';
  return pool[Math.floor(rand() * pool.length)];
}

// Returns an approximate birth year range [min, max] for a given level label.
// Level labels follow patterns like "Primary 1", "Secondary 3", "Youngstarters Little".
function birthYearRangeForLevel(levelLabel: string): [number, number] {
  const year = 2026;
  if (/youngstarters/i.test(levelLabel)) return [year - 6, year - 3];
  const pMatch = levelLabel.match(/Primary\s+(\d)/i);
  if (pMatch) {
    const g = parseInt(pMatch[1], 10);
    const age = 5 + g;
    return [year - age - 1, year - age];
  }
  const sMatch = levelLabel.match(/Secondary\s+(\d)/i);
  if (sMatch) {
    const g = parseInt(sMatch[1], 10);
    const age = 11 + g;
    return [year - age - 1, year - age];
  }
  if (/cambridge/i.test(levelLabel)) return [year - 14, year - 12];
  return [year - 12, year - 6];
}

// Builds demographics + contact fields for a student application row.
// Call once per applicant; spread the result into the apps row object.
function buildStudentDemographics(
  rand: () => number,
  levelLabel: string,
  passType: string | null
): Record<string, unknown> {
  const gender = GENDERS[Math.floor(rand() * GENDERS.length)];
  const [byMin, byMax] = birthYearRangeForLevel(levelLabel);
  const birthYear = byMin + Math.floor(rand() * (byMax - byMin + 1));
  const birthMonth = 1 + Math.floor(rand() * 12);
  const birthDay = 1 + Math.floor(rand() * 28);
  const birthDayIso = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
  const nationality = pickStudentNationality(rand, passType);
  const religion = RELIGIONS[Math.floor(rand() * RELIGIONS.length)];
  const primaryLanguage =
    PRIMARY_LANGUAGES[Math.floor(rand() * PRIMARY_LANGUAGES.length)];
  const addr = SG_ADDRESSES[Math.floor(rand() * SG_ADDRESSES.length)];
  const homePhone = 60000000 + Math.floor(rand() * 9999999);
  const livingWith =
    rand() < 0.7
      ? 'Both Parents'
      : rand() < 0.6
        ? 'Mother'
        : rand() < 0.5
          ? 'Father'
          : 'Guardian';
  const maritalStatus =
    rand() < 0.75 ? 'Married' : rand() < 0.6 ? 'Divorced' : 'Single';
  const previousSchool =
    PREVIOUS_SCHOOLS[Math.floor(rand() * PREVIOUS_SCHOOLS.length)];
  const hasLearningNeeds = rand() < 0.08;
  const additionalLearningNeeds = hasLearningNeeds ? 'Yes' : 'No';
  const otherLearningNeeds = hasLearningNeeds
    ? OTHER_CONDITIONS[Math.floor(rand() * OTHER_CONDITIONS.length)]
    : null;

  // Document details — written to the apps row so the Records student-profile
  // card (StudentProfileCard) and P-Files document-config meta can surface them.
  //   NRIC:           Singaporeans (no passType) + Singapore PRs.
  //   passportNumber: every student — even citizens often hold a passport.
  //   passportExpiry: 5–10 years out (long-validity travel document).
  //   passExpiry:     only when the student has a non-PR pass (Dependent /
  //                   S-PASS passes expire in 1–3 years).
  const hasSgStatus = !passType || passType === 'Singapore PR';
  const nric = hasSgStatus ? fakeSgNric(rand) : null;
  const passportNumber = fakeSgPassportNumber(rand);
  const passportExpiry = isoFutureDate(rand, 5, 10);
  const hasExpiringPass = !!passType && passType !== 'Singapore PR';
  const passExpiry = hasExpiringPass ? isoFutureDate(rand, 1, 3) : null;

  return {
    gender,
    birthDay: birthDayIso,
    nationality,
    religion,
    primaryLanguage,
    homeAddress: addr.street,
    postalCode: addr.postal,
    homePhone,
    livingWithWhom: livingWith,
    parentMaritalStatus: maritalStatus,
    previousSchool,
    additionalLearningNeeds,
    otherLearningNeeds,
    motherWhatsappTeamsConsent: rand() < 0.8,
    fatherWhatsappTeamsConsent: rand() < 0.8,
    guardianWhatsappTeamsConsent: rand() < 0.7,
    ...(nric ? { nric } : {}),
    passportNumber,
    passportExpiry,
    ...(passExpiry ? { passExpiry } : {}),
  };
}

// Builds all medical / health fields for an application row.
function buildMedicalData(rand: () => number): Record<string, unknown> {
  const hasAllergies = rand() < 0.12;
  const hasFoodAllergies = rand() < 0.09;
  const hasAsthma = rand() < 0.07;
  const hasEczema = rand() < 0.12;
  const hasDiabetes = rand() < 0.02;
  const hasEpilepsy = rand() < 0.005;
  const hasHeartConditions = rand() < 0.01;
  const hasOtherConditions = rand() < 0.05;
  const hasDietaryRestrictions = rand() < 0.1;

  const paracetamolRoll = rand();
  const paracetamolConsent =
    paracetamolRoll < 0.78 ? true : paracetamolRoll < 0.88 ? false : null;

  return {
    allergies: hasAllergies,
    allergyDetails: hasAllergies
      ? ALLERGY_DETAILS[Math.floor(rand() * ALLERGY_DETAILS.length)]
      : null,
    foodAllergies: hasFoodAllergies,
    foodAllergyDetails: hasFoodAllergies
      ? FOOD_ALLERGY_DETAILS[Math.floor(rand() * FOOD_ALLERGY_DETAILS.length)]
      : null,
    asthma: hasAsthma,
    eczema: hasEczema,
    diabetes: hasDiabetes,
    epilepsy: hasEpilepsy,
    heartConditions: hasHeartConditions,
    otherMedicalConditions: hasOtherConditions
      ? OTHER_CONDITIONS[Math.floor(rand() * OTHER_CONDITIONS.length)]
      : null,
    dietaryRestrictions: hasDietaryRestrictions
      ? DIETARY_RESTRICTIONS[Math.floor(rand() * DIETARY_RESTRICTIONS.length)]
      : null,
    paracetamolConsent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

// Realistic class-type values seen in production parent-portal submissions.
const CLASS_TYPES = [
  'Enrichment Class',
  'Global Class 3 (ENGLISH + FRENCH)',
  'Global Class 1 (ENGLISH + CHINESE)',
  'Cambridge Lower Secondary',
  'Standard',
] as const;
const PAYMENT_OPTIONS = ['Option 1', 'Option 2'] as const;
const CONTRACT_SIGNATORIES = ['Father', 'Mother', 'Guardian'] as const;
const PASS_TYPES = ['Singapore PR', 'S-PASS', 'Dependent Pass', null] as const;
// Real sample image URL — keeps every funnel + enrolled row's
// `applications.enroleePhoto` clickable / renderable in the SIS Records
// + admissions detail surfaces. Same asset the docs seeder uses for
// idPicture / icaPhoto slots.
const PLACEHOLDER_PHOTO =
  'https://vnhklhppftebbcuupfjw.supabase.co/storage/v1/object/public/parent-portal/ay2027/documents/1774407491653_favicon.png';

// Yes/No string flags — real production rows store these as strings, not bools.
const YES_NO = ['Yes', 'No'] as const;

// STP application type — set on the foreign-student personas (parent-portal
// gates 3 specific document slots when this is non-null per the STP workflow).
const STP_APPLICATION_TYPE = 'New Student Pass Application';

// Sample residenceHistory JSON for STP applicants. Stored as a JSON string in
// the column (matches production format).
const STP_RESIDENCE_HISTORY =
  '[{"toYear":"Present","country":"Singapore","fromYear":2020,"cityOrTown":"Singapore","purposeOfStay":"Schooling"}]';

// Parent / guardian name pools — small deterministic lists so seeded
// applicants ship with realistic mother / father / guardian rows. In
// production every application carries these from intake (parent portal
// writes them alongside enroleeNumber + studentNumber); the seeder
// mirrors that shape.
const MOTHER_FIRST_NAMES = [
  'Maria',
  'Anna',
  'Linda',
  'Susan',
  'Jennifer',
  'Mary',
  'Patricia',
  'Karen',
  'Nancy',
  'Elizabeth',
  'Margaret',
  'Lisa',
  'Helen',
  'Sandra',
  'Donna',
  'Carol',
  'Sharon',
  'Michelle',
  'Laura',
  'Sarah',
] as const;
const FATHER_FIRST_NAMES = [
  'John',
  'David',
  'Michael',
  'James',
  'Robert',
  'William',
  'Richard',
  'Joseph',
  'Thomas',
  'Charles',
  'Christopher',
  'Daniel',
  'Paul',
  'Mark',
  'Donald',
  'Steven',
  'Andrew',
  'Kenneth',
  'George',
  'Brian',
] as const;
const GUARDIAN_FIRST_NAMES = [
  'Antonio',
  'Carlos',
  'Eduardo',
  'Felipe',
  'Hector',
  'Isabel',
  'Sofia',
  'Carmen',
  'Lucia',
  'Beatriz',
] as const;
const GUARDIAN_LAST_NAMES = [
  'Tan',
  'Lim',
  'Cruz',
  'Garcia',
  'Reyes',
  'Santos',
  'Wong',
  'Lee',
] as const;
const NATIONALITY_BY_PASS: Record<string, string> = {
  'Singapore PR': 'Singaporean',
  'S-PASS': 'Filipino',
  'Dependent Pass': 'Indian',
};
const FALLBACK_NATIONALITY = 'Filipino';

function sgMobile(rand: () => number): number {
  // Singapore mobile, 8-digit local number starting with 9. Stored as
  // bigint per `ay{YYYY}_enrolment_applications.{mother,father,guardian}Mobile`
  // (migrations 012/025/026). Country code 65 is not part of the stored
  // value; render-side code prefixes it for display.
  return 90000000 + Math.floor(rand() * 10000000);
}

function fakeEmail(first: string, last: string): string {
  return `${first.toLowerCase()}.${last.toLowerCase()}@example.test`;
}

// Generates a fake Singapore-style passport number: letter prefix + 7 digits.
function fakeSgPassportNumber(rand: () => number): string {
  const prefixes = 'EFGHJKLMNPQRST';
  const letter = prefixes[Math.floor(rand() * prefixes.length)];
  return letter + String(1000000 + Math.floor(rand() * 9000000));
}

// Generates a fake Singapore NRIC / FIN: S/T + 7 digits + letter.
function fakeSgNric(rand: () => number): string {
  const prefix = rand() < 0.85 ? 'S' : 'T';
  const digits = String(1000000 + Math.floor(rand() * 9000000));
  const suffix = 'ABCDEFGHIJZ'[Math.floor(rand() * 11)];
  return `${prefix}${digits}${suffix}`;
}

// Generates an ISO date N years from today (inclusive of a 0–11 month jitter).
function isoFutureDate(
  rand: () => number,
  minYears: number,
  maxYears: number
): string {
  const years = minYears + Math.floor(rand() * (maxYears - minYears + 1));
  const months = Math.floor(rand() * 12);
  const d = new Date(Date.now());
  d.setFullYear(d.getFullYear() + years, d.getMonth() + months, 1);
  return d.toISOString().slice(0, 10);
}

// Pass types realistic for parents of foreign students at an international school.
// Displayed on the P-Files parent-document cards via meta.numberCol = 'motherPass' etc.
const PARENT_PASS_TYPES = [
  'Employment Pass',
  'S-PASS',
  'Dependent Pass',
] as const;

// Builds parent + guardian columns for an apps row. Mother is always
// present (KD #69 anchor parent). Father is present in ~85% of rows;
// of the remainder, ~80% get a guardian on record (the other ~20% are
// mother-only). All names + emails are deterministic per rand seed so
// the seeder stays idempotent.
//
// Document details added: each present parent gets a passport number +
// expiry (all parents travel); foreign parents (student passType ≠ null)
// additionally get a pass type + pass expiry so the P-Files parent-document
// slots have complete metadata (file, expiry, document details per KD #60).
function buildParentFields(
  rand: () => number,
  studentLastName: string | null,
  passType: string | null
): Record<string, unknown> {
  const lastName = studentLastName?.trim() ? studentLastName : 'Doe';
  const motherFirst =
    MOTHER_FIRST_NAMES[Math.floor(rand() * MOTHER_FIRST_NAMES.length)];
  const fatherFirst =
    FATHER_FIRST_NAMES[Math.floor(rand() * FATHER_FIRST_NAMES.length)];
  const nationality =
    (passType && NATIONALITY_BY_PASS[passType]) ?? FALLBACK_NATIONALITY;

  // Parent pass type mirrors student's foreign-residency context. Singaporean
  // families (passType null) typically don't hold work passes; PR families may.
  const parentNeedsPass = passType !== null && passType !== 'Singapore PR';

  const hasFather = rand() < 0.85;
  const hasGuardian = !hasFather && rand() < 0.8;

  // Generates document details for one parent (passport always; pass when foreign).
  const parentDocFields = (prefix: string): Record<string, unknown> => {
    const doc: Record<string, unknown> = {
      [`${prefix}Passport`]: fakeSgPassportNumber(rand),
      [`${prefix}PassportExpiry`]: isoFutureDate(rand, 5, 10),
    };
    if (parentNeedsPass) {
      doc[`${prefix}Pass`] =
        PARENT_PASS_TYPES[Math.floor(rand() * PARENT_PASS_TYPES.length)];
      doc[`${prefix}PassExpiry`] = isoFutureDate(rand, 1, 3);
    }
    return doc;
  };

  const fields: Record<string, unknown> = {
    motherFirstName: motherFirst,
    motherLastName: lastName,
    motherFullName: `${motherFirst} ${lastName}`,
    motherEmail: fakeEmail(motherFirst, lastName),
    motherMobile: sgMobile(rand),
    motherNationality: nationality,
    ...parentDocFields('mother'),
  };

  if (hasFather) {
    fields.fatherFirstName = fatherFirst;
    fields.fatherLastName = lastName;
    fields.fatherFullName = `${fatherFirst} ${lastName}`;
    fields.fatherEmail = fakeEmail(fatherFirst, lastName);
    fields.fatherMobile = sgMobile(rand);
    fields.fatherNationality = nationality;
    Object.assign(fields, parentDocFields('father'));
  }

  if (hasGuardian) {
    const gFirst =
      GUARDIAN_FIRST_NAMES[Math.floor(rand() * GUARDIAN_FIRST_NAMES.length)];
    const gLast =
      GUARDIAN_LAST_NAMES[Math.floor(rand() * GUARDIAN_LAST_NAMES.length)];
    fields.guardianFirstName = gFirst;
    fields.guardianLastName = gLast;
    fields.guardianFullName = `${gFirst} ${gLast}`;
    fields.guardianEmail = fakeEmail(gFirst, gLast);
    fields.guardianMobile = sgMobile(rand);
    fields.guardianNationality = nationality;
    Object.assign(fields, parentDocFields('guardian'));
  }

  return fields;
}

// Funnel-row level distribution. Heaviest in P1-S4 (the canonical mass
// market), with 1-2 Youngstarters + 1 Cambridge Secondary sprinkled in so
// the dashboard's level breakdowns show every band populated.
function pickFunnelLevelCode(rand: () => number): LevelCode {
  const r = rand();
  // Youngstarters: ~6% (2/33), one row each across L/J/S families.
  if (r < 0.06) {
    const ys: LevelCode[] = ['YS-L', 'YS-J', 'YS-S'];
    return ys[Math.floor(rand() * ys.length)];
  }
  // Cambridge Secondary: ~3% (1/33).
  if (r < 0.09) {
    const cs: LevelCode[] = ['CS1', 'CS2'];
    return cs[Math.floor(rand() * cs.length)];
  }
  // Primary + standard Secondary share the remaining ~91%. Pick uniformly
  // across all P1-S4 codes (10 of them).
  const main = LEVEL_CODES.filter(
    (c) => LEVEL_TYPE_BY_CODE[c] !== 'preschool' && c !== 'CS1' && c !== 'CS2'
  );
  return main[Math.floor(rand() * main.length)];
}

// Injects 33 pre-enrolment applications across the canonical applicationStatus
// values (Submitted/Ongoing Verification/Processing/Cancelled/Withdrawn) into
// ay{YY}_enrolment_applications + ay{YY}_enrolment_status. Each row gets a
// realistic 5-prereq stage progression so the dashboard's lifecycle widget
// shows non-zero buckets at each gate.
//
// Skips when any non-Enrolled rows already exist.
async function seedAdmissionsFunnel(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Idempotent: enroleeNumbers are deterministic for a given AY code (same
  // mulberry32 seed → same sequence). Build the full row set, then drop any
  // enroleeNumbers that already exist before inserting the remainder.

  const REFERRALS = [
    'Facebook',
    'Google',
    'Word of Mouth',
    'School Visit',
    'Alumni',
    'Parent Referral',
  ];

  const rand = mulberry32(hashString(`${testAy.ay_code}:funnel`));
  const totalCount = FUNNEL_PROFILES.reduce((n, p) => n + p.count, 0);
  const names = pickNames(`${testAy.ay_code}:funnel`, totalCount);

  const appRows: Array<Record<string, unknown>> = [];
  const statusRows: Array<Record<string, unknown>> = [];
  let nameIdx = 0;

  for (const profile of FUNNEL_PROFILES) {
    for (let i = 0; i < profile.count; i++) {
      const n = names[nameIdx++];
      // Enrolee number format: <prefix>-TEST-<4-digit>
      const seq = String(5000 + nameIdx).padStart(4, '0');
      const enroleeNumber = `${prefix.toUpperCase()}-TEST-${seq}`;
      const levelCode = pickFunnelLevelCode(rand);
      const levelLabel = LEVEL_LABELS[levelCode];
      const referral = REFERRALS[Math.floor(rand() * REFERRALS.length)];
      // Dates spread back ~60 days for outdated-applications demo.
      const daysBack = Math.floor(rand() * 60);
      const dateIso = new Date(
        Date.now() - daysBack * 24 * 60 * 60 * 1000
      ).toISOString();

      const stageFill = stageProgressionFor(profile.stageProfile, rand);
      const category = pickEnroleeCategory(rand);
      const classType = CLASS_TYPES[Math.floor(rand() * CLASS_TYPES.length)];
      const paymentOption =
        PAYMENT_OPTIONS[Math.floor(rand() * PAYMENT_OPTIONS.length)];
      const contractSignatory =
        CONTRACT_SIGNATORIES[Math.floor(rand() * CONTRACT_SIGNATORIES.length)];
      const passType = PASS_TYPES[Math.floor(rand() * PASS_TYPES.length)];
      // STP application: ~30% of foreign-student rows (those without Singapore
      // PR). stpApplicationStatus (Pending/Submitted/Approved/Rejected) tracks
      // ICA progress; parents file documents directly with ICA per migration 050.
      const isStpApplicant = passType !== 'Singapore PR' && rand() < 0.45;
      const stpApplicationType = isStpApplicant ? STP_APPLICATION_TYPE : null;

      const studentNumber = `TEST-${prefix.toUpperCase()}-SN-${seq}`;
      const parentFields = buildParentFields(rand, n.last_name, passType);
      const demographics = buildStudentDemographics(rand, levelLabel, passType);
      const medical = buildMedicalData(rand);
      appRows.push({
        enroleeNumber,
        studentNumber,
        category,
        firstName: n.first_name,
        lastName: n.last_name,
        enroleeFullName: `${n.first_name} ${n.last_name}`,
        levelApplied: levelLabel,
        classType,
        paymentOption,
        contractSignatory,
        pass: passType,
        enroleePhoto: PLACEHOLDER_PHOTO,
        availSchoolBus: YES_NO[Math.floor(rand() * YES_NO.length)],
        availUniform: YES_NO[Math.floor(rand() * YES_NO.length)],
        availStudentCare: YES_NO[Math.floor(rand() * YES_NO.length)],
        howDidYouKnowAboutHFSEIS: referral,
        applicationStatus: 'Registered',
        stpApplicationType,
        stpApplicationStatus: isStpApplicant
          ? (() => {
              const r = rand();
              if (r < 0.45) return 'Pending';
              if (r < 0.8) return 'Submitted';
              if (r < 0.95) return 'Approved';
              return 'Rejected';
            })()
          : null,
        residenceHistory: isStpApplicant ? STP_RESIDENCE_HISTORY : null,
        socialMediaConsent: rand() < 0.7,
        ...demographics,
        ...medical,
        ...parentFields,
      });

      const applicationStatus: ApplicationStatus = profile.applicationStatus;
      const statusRow: Record<string, unknown> = {
        enroleeNumber,
        applicationStatus,
        // Mirrors apps.category — same value, different column name.
        enroleeType: category,
        levelApplied: levelLabel,
        applicationUpdatedDate: dateIso,
        registrationStatus: stageFill.registrationStatus,
        documentStatus: stageFill.documentStatus,
        assessmentStatus: stageFill.assessmentStatus,
        contractStatus: stageFill.contractStatus,
        feeStatus: stageFill.feeStatus,
      };
      // Seed assessment grades for rows that have plausibly progressed past
      // the assessment stage. Without these the AssessmentOutcomes donut
      // shows 100% "unknown". Roughly 80% pass mix (both ≥60), 20% with at
      // least one fail < 60 → realistic pass-rate spread.
      if (
        applicationStatus === 'Processing' ||
        applicationStatus === 'Enrolled' ||
        applicationStatus === 'Enrolled (Conditional)'
      ) {
        const passingMath = rand() < 0.8;
        const passingEnglish = rand() < 0.8;
        const mathScore = passingMath
          ? 60 + Math.floor(rand() * 36) // 60–95
          : 50 + Math.floor(rand() * 10); // 50–59
        const engScore = passingEnglish
          ? 60 + Math.floor(rand() * 36)
          : 50 + Math.floor(rand() * 10);
        statusRow.assessmentGradeMath = String(mathScore);
        statusRow.assessmentGradeEnglish = String(engScore);
      }
      // For Processing rows that landed on the fee stage with feeStatus='Paid'
      // (i.e. the ungated-to-enroll branch), stamp a recent feePaymentDate so
      // the lifecycle widget's payment-recency slice has data.
      if (stageFill.feeStatus === 'Paid') {
        const payDaysBack = Math.floor(rand() * 14);
        statusRow.feePaymentDate = new Date(
          Date.now() - payDaysBack * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .slice(0, 10);
      }
      // Terminal reason for Cancelled / Withdrawn rows (migration 067 / KD #111).
      // Feeds the reason column + filter chips on /admissions/applications/closed.
      if (
        applicationStatus === 'Cancelled' ||
        applicationStatus === 'Withdrawn'
      ) {
        const TERMINAL_REASONS = [
          'chose_another_school',
          'visa_denied',
          'lost_interest',
          'financial',
        ] as const;
        const TERMINAL_NOTES: Record<string, string> = {
          chose_another_school: 'Family decided to enrol at another school.',
          visa_denied: 'Student Pass application was not approved by ICA.',
          lost_interest: 'Applicant stopped responding after initial inquiry.',
          financial: 'Family cited financial constraints.',
        };
        const reason =
          TERMINAL_REASONS[Math.floor(rand() * TERMINAL_REASONS.length)];
        statusRow.applicationTerminalReason = reason;
        statusRow.applicationTerminalNotes = TERMINAL_NOTES[reason] ?? null;
      }
      statusRows.push(statusRow);
    }
  }

  // Filter out enroleeNumbers that already exist on either table — the
  // AY-prefixed tables have no unique constraint on enroleeNumber so we
  // can't rely on upsert ignoreDuplicates. Existence on either side counts
  // as "this funnel row was already seeded".
  const existingApps = await fetchAllPages<{ enroleeNumber: string | null }>(
    (from, to) =>
      service.from(appsTable).select('enroleeNumber').range(from, to)
  );
  const existingStatus = await fetchAllPages<{ enroleeNumber: string | null }>(
    (from, to) =>
      service.from(statusTable).select('enroleeNumber').range(from, to)
  );
  const existingNums = new Set<string>([
    ...existingApps.map((r) => r.enroleeNumber).filter((n): n is string => !!n),
    ...existingStatus
      .map((r) => r.enroleeNumber)
      .filter((n): n is string => !!n),
  ]);
  const appRowsToInsert = appRows.filter(
    (r) => !existingNums.has(String(r.enroleeNumber))
  );
  const statusRowsToInsert = statusRows.filter(
    (r) => !existingNums.has(String(r.enroleeNumber))
  );
  if (appRowsToInsert.length === 0) return 0;

  const { error: appsErr } = await service
    .from(appsTable)
    .insert(appRowsToInsert);
  if (appsErr) {
    console.error(
      '[populated seeder] admissions apps insert failed:',
      appsErr.message
    );
    return 0;
  }
  const { error: statusErr } = await service
    .from(statusTable)
    .insert(statusRowsToInsert);
  if (statusErr) {
    console.error(
      '[populated seeder] admissions status insert failed:',
      statusErr.message
    );
  }
  return appRowsToInsert.length;
}

// Seeds 7 plausible discount codes in the test AY's discount-codes table.
// Real schema columns: discountCode, details, enroleeType, startDate, endDate.
// (No `percentageDiscount` column — discount semantics live in `details` text.)
// Code naming convention is AY-prefixed: AY99 = AY9999 test environment.
async function seedDiscountCodes(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const table = `${prefix}_discount_codes`;

  // Idempotent: filter by discountCode (the natural key) before insert.
  const { data: existingRows } = await service
    .from(table)
    .select('discountCode');
  const existingCodes = new Set(
    ((existingRows ?? []) as Array<{ discountCode: string | null }>)
      .map((r) => r.discountCode)
      .filter((c): c is string => !!c)
  );

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextQuarter = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  const rows = [
    {
      discountCode: 'AY99TEST01',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Test alumni family — 15% off registration',
      enroleeType: 'Both',
    },
    {
      discountCode: 'AY99TEST02',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Test sibling discount — 10% off term fees',
      enroleeType: 'Current',
    },
    {
      discountCode: 'AY99TEST03',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextMonth.toISOString().slice(0, 10),
      details: 'Test early-bird — 200 SGD off registration',
      enroleeType: 'New',
    },
    {
      discountCode: 'AY99TEST04',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Test staff family — 20% off all fees',
      enroleeType: 'Both',
    },
    {
      discountCode: 'AY99TEST05',
      startDate: tomorrow.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Future test promotion (not yet active) — 5% off',
      enroleeType: 'New',
    },
    // VizSchool variants
    {
      discountCode: 'AY99TESTVZ01',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Test VizSchool sibling — 10% off',
      enroleeType: 'VizSchool Current',
    },
    {
      discountCode: 'AY99TESTVZ02',
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
      details: 'Test VizSchool any — 5% off',
      enroleeType: 'VizSchool Both',
    },
  ];

  const rowsToInsert = rows.filter((r) => !existingCodes.has(r.discountCode));
  if (rowsToInsert.length === 0) return 0;

  const { error } = await service.from(table).insert(rowsToInsert);
  if (error) {
    console.error(
      '[populated seeder] discount codes insert failed:',
      error.message
    );
    return 0;
  }
  return rowsToInsert.length;
}

// Creates publish-windows for all seeded sections × all target terms so the
// parent portal + publish-checklist have realistic data to demo.
// allTermsFull=true → seeds T1–T4 for every section that has enrolled students.
// allTermsFull=false → seeds T1 only for the first section (minimal demo).
async function seedPublication(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  allTermsFull: boolean
): Promise<number> {
  const targetTermNumbers = allTermsFull ? [1, 2, 3, 4] : [1];

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, end_date')
    .eq('academic_year_id', testAy.id)
    .in('term_number', targetTermNumbers)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    end_date: string | null;
  }>;
  if (terms.length === 0) return 0;

  // Only seed publications for sections that actually have enrolled students —
  // keeps the publication list clean (no empty-section publication windows).
  const { data: enroledRows } = await service
    .from('section_students')
    .select('section_id')
    .in(
      'section_id',
      (
        await service
          .from('sections')
          .select('id')
          .eq('academic_year_id', testAy.id)
      ).data?.map((r) => (r as { id: string }).id) ?? []
    );
  const seededSectionIds = [
    ...new Set(
      (enroledRows ?? []).map((r) => (r as { section_id: string }).section_id)
    ),
  ];
  if (seededSectionIds.length === 0) return 0;

  const publications: Array<{
    section_id: string;
    term_id: string;
    publish_from: string;
    publish_until: string;
    published_by: string;
  }> = [];

  // Real registrars publish SELECTIVELY with VARIED windows — not every
  // (section × term) at a fixed 90-day window. Faithful seeding:
  //   · leave a few (section × term) windows unpublished so the parent
  //     "not currently published" path is exercised;
  //   · vary publish_until across a short (~7d), normal (~30d / ~90d) and
  //     open/long (~365d) window so window-edge cases are covered.
  // Deterministic + idempotent: the skip + window choices are POSITION-based
  // (not RNG-based), keyed on a stable iteration order, so a re-run makes the
  // identical choices and the upsert's ignoreDuplicates leaves rows intact.
  //
  // Position-based (rather than probabilistic) skip is deliberate: with as few
  // as 3 candidate windows (active-AY = 3 sections × T1), a probabilistic skip
  // could leave ALL or NONE unpublished and lose path coverage. The rule below
  // guarantees BOTH paths are exercised whenever there are ≥2 windows: skip
  // every Nth window, leaving the rest published.
  const WINDOW_DAYS = [7, 30, 90, 365] as const;
  // Sort section ids for stable iteration order regardless of query ordering,
  // so the skip pattern + window cycle are byte-for-byte reproducible.
  const orderedSectionIds = [...seededSectionIds].sort();
  // Flatten (section × term) candidates in stable order so the skip stride +
  // window cycle apply across the whole grid, not per-section.
  const candidates: Array<{
    sectionId: string;
    term: (typeof terms)[number];
  }> = [];
  for (const sectionId of orderedSectionIds) {
    for (const term of terms) candidates.push({ sectionId, term });
  }
  // Skip every 4th window (positions 3, 7, 11, …) — leaves ~75% published and
  // guarantees at least one unpublished once there are ≥4 windows; with 2–3
  // windows none is skipped (publishing all keeps the common path covered, and
  // the unsynced/withdrawn personas already exercise other empty states).
  const SKIP_STRIDE = 4;
  let windowCursor = 0;
  candidates.forEach((c, idx) => {
    const skip =
      candidates.length >= SKIP_STRIDE && (idx + 1) % SKIP_STRIDE === 0;
    if (skip) return;
    const windowDays = WINDOW_DAYS[windowCursor % WINDOW_DAYS.length];
    windowCursor += 1;
    const baseDate = c.term.end_date
      ? new Date(`${c.term.end_date}T08:00:00+08:00`)
      : new Date();
    const publishUntil = new Date(
      baseDate.getTime() + windowDays * 24 * 60 * 60 * 1000
    );
    publications.push({
      section_id: c.sectionId,
      term_id: c.term.id,
      publish_from: baseDate.toISOString(),
      publish_until: publishUntil.toISOString(),
      published_by: 'test-seeder@hfse.edu.sg',
    });
  });
  if (publications.length === 0) return 0;

  const { error } = await service
    .from('report_card_publications')
    .upsert(publications, {
      onConflict: 'section_id,term_id',
      ignoreDuplicates: true,
    });
  if (error) {
    console.error(
      '[populated seeder] publication insert failed:',
      error.message
    );
    return 0;
  }
  return publications.length;
}

// Round-robin assigns existing staff users as form_advisers + subject_teachers
// across the test AY's sections. Prefers `role='teacher'` users; falls back
// to registrar/school_admin/superadmin if no teachers exist. Skip guard
// is a single "any row already" count to keep the check cheap.
async function seedTeacherAssignments(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<{ form_adviser: number; subject_teacher: number }> {
  // AY-scoped sections.
  const { data: sections } = await service
    .from('sections')
    .select('id, level_id')
    .eq('academic_year_id', testAy.id);
  const sectionRows = (sections ?? []) as Array<{
    id: string;
    level_id: string;
  }>;
  if (sectionRows.length === 0) return { form_adviser: 0, subject_teacher: 0 };

  // Idempotent: pull every existing assignment for these sections so we
  // can filter out duplicates per-row. Migration 003's unique indexes are
  // partial (WHERE role='form_adviser' / 'subject_teacher'), which
  // PostgREST upsert can't target with a simple onConflict — manual diff
  // is the correct workaround.
  const { data: existingAssigns } = await service
    .from('teacher_assignments')
    .select('section_id, subject_id, role')
    .in(
      'section_id',
      sectionRows.map((s) => s.id)
    );
  type ExistingAssign = {
    section_id: string;
    subject_id: string | null;
    role: string;
  };
  const existingFAs = new Set(
    ((existingAssigns ?? []) as ExistingAssign[])
      .filter((r) => r.role === 'form_adviser')
      .map((r) => r.section_id)
  );
  const existingSTs = new Set(
    ((existingAssigns ?? []) as ExistingAssign[])
      .filter((r) => r.role === 'subject_teacher' && r.subject_id)
      .map((r) => `${r.section_id}|${r.subject_id}`)
  );

  // Pool of candidate users. Supabase JS `auth.admin.listUsers` returns
  // everyone including parents (role=null). Filter to staff roles.
  const { data: userList, error: usersErr } =
    await service.auth.admin.listUsers({
      perPage: 1000,
    });
  if (usersErr) {
    console.error('[populated seeder] listUsers failed:', usersErr.message);
    return { form_adviser: 0, subject_teacher: 0 };
  }
  const STAFF_ROLES = new Set([
    'teacher',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  const staff = (userList?.users ?? [])
    .map((u) => ({
      id: u.id,
      role:
        (u.app_metadata?.role as string | undefined) ??
        (u.user_metadata?.role as string | undefined) ??
        null,
    }))
    .filter((u) => u.role && STAFF_ROLES.has(u.role));

  const teacherPool = staff.filter((u) => u.role === 'teacher');
  const fallbackPool = staff.filter((u) => u.role !== 'teacher');
  const pool = teacherPool.length > 0 ? teacherPool : fallbackPool;

  if (pool.length === 0) {
    console.warn(
      '[populated seeder] no staff users to assign — teacher flows will be empty'
    );
    return { form_adviser: 0, subject_teacher: 0 };
  }

  // ---- Form advisers: one per section, round-robin ----
  const faRows = sectionRows
    .map((s, i) => ({
      teacher_user_id: pool[i % pool.length].id,
      section_id: s.id,
      subject_id: null as string | null,
      role: 'form_adviser' as const,
    }))
    .filter((r) => !existingFAs.has(r.section_id));
  let formAdviserCount = 0;
  if (faRows.length > 0) {
    const { error: faErr, data: faInserted } = await service
      .from('teacher_assignments')
      .insert(faRows)
      .select('id');
    if (faErr) {
      console.error(
        '[populated seeder] form_adviser insert failed:',
        faErr.message
      );
    }
    formAdviserCount = faInserted?.length ?? 0;
  }

  // ---- Subject teachers: one per (section × subject) from subject_configs ----
  // Pull the full matrix then round-robin. subject_configs scopes by
  // (academic_year_id, level_id); we need the level match per section.
  const { data: configs } = await service
    .from('subject_configs')
    .select('subject_id, level_id')
    .eq('academic_year_id', testAy.id);
  const cfgByLevel = new Map<string, string[]>();
  for (const c of (configs ?? []) as Array<{
    subject_id: string;
    level_id: string;
  }>) {
    if (!cfgByLevel.has(c.level_id)) cfgByLevel.set(c.level_id, []);
    cfgByLevel.get(c.level_id)!.push(c.subject_id);
  }

  const stRows: Array<{
    teacher_user_id: string;
    section_id: string;
    subject_id: string;
    role: 'subject_teacher';
  }> = [];
  let rotation = 0;
  for (const section of sectionRows) {
    const subjectIds = cfgByLevel.get(section.level_id) ?? [];
    for (const subjectId of subjectIds) {
      const key = `${section.id}|${subjectId}`;
      if (existingSTs.has(key)) {
        rotation += 1; // keep rotation stable so unrelated re-runs assign the same teacher
        continue;
      }
      stRows.push({
        teacher_user_id: pool[rotation % pool.length].id,
        section_id: section.id,
        subject_id: subjectId,
        role: 'subject_teacher',
      });
      rotation += 1;
    }
  }

  let subjectTeacherCount = 0;
  if (stRows.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < stRows.length; i += CHUNK) {
      const slice = stRows.slice(i, i + CHUNK);
      const { data, error } = await service
        .from('teacher_assignments')
        .insert(slice)
        .select('id');
      if (error) {
        console.error(
          `[populated seeder] subject_teacher insert failed (chunk ${i}..${i + slice.length}):`,
          error.message
        );
        continue;
      }
      subjectTeacherCount += data?.length ?? 0;
    }
  }

  return {
    form_adviser: formAdviserCount,
    subject_teacher: subjectTeacherCount,
  };
}

// Inserts ay{YY}_enrolment_applications + ay{YY}_enrolment_status rows for the
// pre-generated enrolled personas. Runs BEFORE public.students / section_students
// exist (admissions-first order), so it depends only on the persona list — not
// on any roster query. Fills the gap so /records/students (which filters the
// admissions tables to Enrolled) shows rows, and Admissions applicant-detail
// pages resolve. Idempotent: skips enroleeNumbers already present on either
// table. The enrolee_number back-write onto section_students happens later, in
// syncEnrolledPersonas, once those rows exist.
async function seedEnrolledAdmissionsRows(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  personas: EnrolledPersona[]
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Drive every downstream payload from the persona list. `rows` keeps the same
  // shape the original section_students-derived mapping produced (minus the
  // sectionStudentId, which no longer exists at this point).
  const rows = personas.map((p) => ({
    studentNumber: p.studentNumber,
    firstName: p.firstName,
    lastName: p.lastName,
    middleName: p.middleName,
    sectionName: p.sectionName,
    levelCode: p.levelCode,
    levelLabel: p.levelLabel,
  }));

  if (rows.length === 0) return 0;

  const todayIso = new Date().toISOString().slice(0, 10);
  const upperPrefix = prefix.toUpperCase();

  // Persona quirks layered on top of the default "everything Finished, status
  // Enrolled" baseline:
  //   - 3 are Enrolled (Conditional) — registrar carve-outs (waiver path).
  //   - 5 are Enrolled with documentStatus='Verified' (not Finished) —
  //     "documents almost done" tail; exercises the lifecycle widget's
  //     near-complete bucket and the dashboard's docs-pending count.
  //   - 2 are Withdrawn post-enrollment (~30 days back) so the
  //     <StudentLifecycleTimeline> branches into the withdrawal path.
  // The Conditional/Withdrawn split is decided in buildEnrolledPersonas (carried
  // on persona.applicationStatus); VERIFIED_DOCS stays an index range here
  // since it's a documentStatus quirk, not a pipeline-status one. Indices align
  // because both functions iterate the same student_number-sorted persona list.
  const VERIFIED_DOCS_RANGE = { start: 3, end: 8 };
  const WITHDRAWN_RANGE = { start: 8, end: 10 };

  const personaApplicationStatus = (i: number): ApplicationStatus =>
    personas[i].applicationStatus;

  // Document status fill: standard rows get all 5 prereqs Finished/Signed/Paid.
  // Verified-docs persona gets documentStatus='Verified' instead of 'Finished'.
  // Withdrawn persona keeps prereqs at their last-known state (Finished) since
  // they enrolled before withdrawing.
  const personaStageFill = (i: number) => {
    const isVerified =
      i >= VERIFIED_DOCS_RANGE.start && i < VERIFIED_DOCS_RANGE.end;
    return {
      registrationStatus: 'Finished',
      documentStatus: isVerified ? 'Verified' : 'Finished',
      assessmentStatus: 'Finished',
      contractStatus: 'Signed',
      feeStatus: 'Paid',
    };
  };

  // Withdrawn rows backdate `applicationUpdatedDate` ~30 days so the timeline
  // shows the withdrawal as a historical event rather than today.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Deterministic per-AY rand for category / classType / pass / STP picks. Same
  // pattern as funnel — keeps re-runs stable.
  const enrolledRand = mulberry32(
    hashString(`${testAy.ay_code}:enrolled-personas`)
  );

  // Spread `applicationUpdatedDate` across the current calendar month for
  // ~35% of enrolled rows so the Conversion Rate KPI's `thisMonth` range
  // window catches enough samples to show a non-zero average.
  const now = new Date();
  const monthStartDay = 1;
  const monthMaxDay = now.getDate();
  const personaUpdatedDate = (i: number): string => {
    if (i >= WITHDRAWN_RANGE.start && i < WITHDRAWN_RANGE.end)
      return thirtyDaysAgo;
    if (enrolledRand() < 0.35) {
      const day = monthStartDay + Math.floor(enrolledRand() * monthMaxDay);
      return new Date(now.getFullYear(), now.getMonth(), day)
        .toISOString()
        .slice(0, 10);
    }
    return todayIso;
  };

  // Backdate `applications.created_at` to N days before each row's
  // updatedDate so `daysToEnroll = updatedAt - createdAt` has realistic
  // positive variance (14–90 days). Without this every row's daysToEnroll
  // would be 0 (created_at defaults to seed-time, updatedDate is also
  // ~today). Withdrawn rows backdate further so they don't pollute
  // averages of healthy enrol times.
  const personaCreatedAtIso = (i: number): string => {
    const daysAgo =
      i >= WITHDRAWN_RANGE.start && i < WITHDRAWN_RANGE.end
        ? 60 + Math.floor(enrolledRand() * 60) // 60–120d for withdrawn
        : 14 + Math.floor(enrolledRand() * 76); // 14–90d for active
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  };

  // Per-row metadata computed once, then shared between appInserts and
  // statusInserts so apps.category + status.enroleeType always agree (they
  // mirror each other in production).
  const personaMeta = rows.map(() => {
    const category = pickEnroleeCategory(enrolledRand);
    const classType =
      CLASS_TYPES[Math.floor(enrolledRand() * CLASS_TYPES.length)];
    const paymentOption =
      PAYMENT_OPTIONS[Math.floor(enrolledRand() * PAYMENT_OPTIONS.length)];
    const contractSignatory =
      CONTRACT_SIGNATORIES[
        Math.floor(enrolledRand() * CONTRACT_SIGNATORIES.length)
      ];
    const passType = PASS_TYPES[Math.floor(enrolledRand() * PASS_TYPES.length)];
    const isStpApplicant = passType !== 'Singapore PR' && enrolledRand() < 0.2;
    const availSchoolBus = YES_NO[Math.floor(enrolledRand() * YES_NO.length)];
    const availUniform = YES_NO[Math.floor(enrolledRand() * YES_NO.length)];
    const availStudentCare = YES_NO[Math.floor(enrolledRand() * YES_NO.length)];
    const socialMediaConsent = enrolledRand() < 0.7;
    return {
      category,
      classType,
      paymentOption,
      contractSignatory,
      passType,
      isStpApplicant,
      availSchoolBus,
      availUniform,
      availStudentCare,
      socialMediaConsent,
    };
  });

  const appInserts = rows.map((r, i) => {
    const m = personaMeta[i];
    const parentFields = buildParentFields(
      enrolledRand,
      r.lastName,
      m.passType
    );
    const demographics = buildStudentDemographics(
      enrolledRand,
      r.levelLabel,
      m.passType
    );
    const medical = buildMedicalData(enrolledRand);
    return {
      enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
      studentNumber: r.studentNumber,
      category: m.category,
      firstName: r.firstName,
      lastName: r.lastName,
      middleName: r.middleName,
      enroleeFullName: [r.firstName, r.middleName, r.lastName]
        .filter(Boolean)
        .join(' '),
      levelApplied: r.levelLabel,
      classType: m.classType,
      paymentOption: m.paymentOption,
      contractSignatory: m.contractSignatory,
      pass: m.passType,
      enroleePhoto: PLACEHOLDER_PHOTO,
      availSchoolBus: m.availSchoolBus,
      availUniform: m.availUniform,
      availStudentCare: m.availStudentCare,
      applicationStatus: 'Registered',
      stpApplicationType: m.isStpApplicant ? STP_APPLICATION_TYPE : null,
      stpApplicationStatus: m.isStpApplicant
        ? i % 7 === 0
          ? 'Submitted'
          : i % 11 === 0
            ? 'Pending'
            : 'Approved'
        : null,
      residenceHistory: m.isStpApplicant ? STP_RESIDENCE_HISTORY : null,
      socialMediaConsent: m.socialMediaConsent,
      created_at: personaCreatedAtIso(i),
      ...demographics,
      ...medical,
      ...parentFields,
    };
  });
  const statusInserts = rows.map((r, i) => {
    const fill = personaStageFill(i);
    const m = personaMeta[i];
    return {
      enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
      // SIS-side pipeline status — Enrolled / Enrolled (Conditional) / Withdrawn
      // per the persona ranges.
      applicationStatus: personaApplicationStatus(i),
      // Mirrors apps.category — same value, same row index.
      enroleeType: m.category,
      levelApplied: r.levelLabel,
      classLevel: r.levelLabel,
      classSection: r.sectionName,
      classStatus: 'Finished',
      applicationUpdatedDate: personaUpdatedDate(i),
      registrationStatus: fill.registrationStatus,
      documentStatus: fill.documentStatus,
      assessmentStatus: fill.assessmentStatus,
      contractStatus: fill.contractStatus,
      feeStatus: fill.feeStatus,
    };
  });

  // Filter out enroleeNumbers that already exist on either table.
  const existingApps = await fetchAllPages<{ enroleeNumber: string | null }>(
    (from, to) =>
      service.from(appsTable).select('enroleeNumber').range(from, to)
  );
  const existingStatus = await fetchAllPages<{ enroleeNumber: string | null }>(
    (from, to) =>
      service.from(statusTable).select('enroleeNumber').range(from, to)
  );
  const existingNums = new Set<string>([
    ...existingApps.map((r) => r.enroleeNumber).filter((n): n is string => !!n),
    ...existingStatus
      .map((r) => r.enroleeNumber)
      .filter((n): n is string => !!n),
  ]);
  const filteredApps = appInserts.filter(
    (r) => !existingNums.has(r.enroleeNumber)
  );
  const filteredStatus = statusInserts.filter(
    (r) => !existingNums.has(r.enroleeNumber)
  );

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < filteredApps.length; i += CHUNK) {
    const appSlice = filteredApps.slice(i, i + CHUNK);
    const statusSlice = filteredStatus.slice(i, i + CHUNK);
    const { error: appsErr } = await service.from(appsTable).insert(appSlice);
    if (appsErr) {
      console.error(
        `[populated seeder] ${appsTable} insert failed (chunk ${i}..${i + appSlice.length}):`,
        appsErr.message
      );
      continue;
    }
    const { error: statusErr } = await service
      .from(statusTable)
      .insert(statusSlice);
    if (statusErr) {
      console.error(
        `[populated seeder] ${statusTable} insert failed (chunk ${i}..${i + statusSlice.length}):`,
        statusErr.message
      );
      continue;
    }
    inserted += appSlice.length;
  }

  // NOTE: the enrolee_number back-write onto section_students used to live here,
  // but section_students doesn't exist yet under the admissions-first order. It
  // now happens in syncEnrolledPersonas after the sync materialises those rows.

  return inserted;
}

// Runs the production-style sync for the enrolled personas: build AdmissionsRow[]
// (excluding Withdrawn/Cancelled so they never create an active enrollment),
// snapshot the current grading DB, plan via the pure buildSyncPlan, then commit
// students + section_students. Deliberately does NOT use syncOneStudent — that
// helper stamps enrollment_date=today (breaking KD #113 attendance proration,
// which filters date >= enrollment_date) and never sets enrolee_number. Here we
// stamp enrollment_date = the AY's T1 start_date and back-write enrolee_number.
async function syncEnrolledPersonas(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  personas: EnrolledPersona[]
): Promise<{ students_inserted: number; enrolments_inserted: number }> {
  // Only personas that should become active enrolments. Withdrawn/Cancelled
  // personas keep their admissions rows but must not enrol (matches the live
  // roster filter in fetchAdmissionsRoster).
  const syncable = personas.filter(
    (p) =>
      p.applicationStatus !== 'Withdrawn' && p.applicationStatus !== 'Cancelled'
  );
  if (syncable.length === 0) {
    return { students_inserted: 0, enrolments_inserted: 0 };
  }

  // Build the admissions roster rows the planner consumes. levelLabel +
  // sectionName come straight from the section the persona belongs to, so they
  // round-trip cleanly through normalizeLevelLabel / normalizeSectionName.
  const rows: AdmissionsRow[] = syncable.map((p) => ({
    student_number: p.studentNumber,
    last_name: p.lastName,
    first_name: p.firstName,
    middle_name: p.middleName,
    class_level: p.levelLabel,
    class_section: p.sectionName,
    class_ay: testAy.ay_code,
  }));

  // ---- Snapshot the grading DB for this AY ----
  const [levelsRes, sectionsRes] = await Promise.all([
    service.from('levels').select('id, label'),
    service
      .from('sections')
      .select('id, level_id, name')
      .eq('academic_year_id', testAy.id),
  ]);
  const levels = (levelsRes.data ?? []) as LevelRow[];
  const sections = (sectionsRes.data ?? []) as SectionRow[];
  const sectionIds = sections.map((s) => s.id);

  // Existing students whose numbers appear in the roster (so re-runs treat
  // already-seeded students as updates / no-ops rather than duplicate inserts).
  const studentNumbers = rows
    .map((r) => r.student_number)
    .filter((n): n is string => !!n);
  let students: StudentRow[] = [];
  if (studentNumbers.length > 0) {
    students = await fetchAllPages<StudentRow>((from, to) =>
      service
        .from('students')
        .select('id, student_number, last_name, first_name, middle_name')
        .in('student_number', studentNumbers)
        .range(from, to)
    );
  }

  // Existing enrolments for this AY's sections (so re-runs don't re-insert).
  let enrollments: EnrollmentRow[] = [];
  if (sectionIds.length > 0) {
    enrollments = await fetchAllPages<EnrollmentRow>((from, to) =>
      service
        .from('section_students')
        .select('id, section_id, student_id, index_number, enrollment_status')
        .in('section_id', sectionIds)
        .range(from, to)
    );
  }

  const plan = buildSyncPlan(rows, { levels, sections, students, enrollments });
  if (plan.errors.length > 0) {
    console.error(
      `[populated seeder] sync planner produced ${plan.errors.length} error(s); first:`,
      plan.errors[0]
    );
  }

  // ---- Commit students (inserts + safety-net updates) ----
  const inserts = plan.student_upserts.filter((u) => u.kind === 'insert');
  const updates = plan.student_upserts.filter((u) => u.kind === 'update');
  let studentsInserted = 0;
  if (inserts.length > 0) {
    const { data, error } = await service
      .from('students')
      .insert(
        inserts.map((u) => ({
          student_number: u.student_number,
          last_name: u.last_name,
          first_name: u.first_name,
          middle_name: u.middle_name,
        }))
      )
      .select('id');
    if (error) {
      console.error('[populated seeder] student insert failed:', error.message);
    } else {
      studentsInserted = data?.length ?? 0;
    }
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
    if (error) {
      console.error(
        `[populated seeder] student update failed for ${u.student_number}:`,
        error.message
      );
    }
  }

  // ---- Resolve student_number → id for every roster student (existing +
  //      freshly inserted) so we can build section_students rows. ----
  const idByNumber = new Map<string, string>();
  if (studentNumbers.length > 0) {
    const resolved = await fetchAllPages<{
      id: string;
      student_number: string;
    }>((from, to) =>
      service
        .from('students')
        .select('id, student_number')
        .in('student_number', studentNumbers)
        .range(from, to)
    );
    for (const r of resolved) idByNumber.set(r.student_number, r.id);
  }

  // ---- enrollment_date = the AY's T1 start_date (NOT today — today would
  //      break KD #113 attendance proration). ----
  const { data: t1Row } = await service
    .from('terms')
    .select('start_date')
    .eq('academic_year_id', testAy.id)
    .eq('term_number', 1)
    .maybeSingle();
  const enrollDate =
    (t1Row as { start_date: string } | null)?.start_date ??
    new Date().toISOString().slice(0, 10);

  // ---- Commit section_students from the plan's enrollment_inserts. ----
  let enrolmentsInserted = 0;
  const enrolRows: Array<{
    section_id: string;
    student_id: string;
    index_number: number;
    enrollment_status: 'active';
    enrollment_date: string;
  }> = [];
  for (const e of plan.enrollment_inserts) {
    const studentId = idByNumber.get(e.student_number);
    if (!studentId) {
      console.error(
        `[populated seeder] could not resolve student_id for ${e.student_number} — enrolment skipped`
      );
      continue;
    }
    enrolRows.push({
      section_id: e.section_id,
      student_id: studentId,
      index_number: e.index_number,
      enrollment_status: 'active',
      enrollment_date: enrollDate,
    });
  }
  if (enrolRows.length > 0) {
    const { data, error } = await service
      .from('section_students')
      .insert(enrolRows)
      .select('id');
    if (error) {
      console.error(
        '[populated seeder] section_students insert failed:',
        error.message
      );
    } else {
      enrolmentsInserted = data?.length ?? 0;
    }
  }

  // ---- Back-write enrolee_number onto section_students. Map each synced
  //      student_number → its persona enroleeNumber, then UPDATE the row
  //      (guarded on enrolee_number IS NULL for idempotency). ----
  const enroleeByNumber = new Map(
    syncable.map((p) => [p.studentNumber, p.enroleeNumber])
  );
  let backwritten = 0;
  for (const [studentNumber, enroleeNumber] of enroleeByNumber) {
    const studentId = idByNumber.get(studentNumber);
    if (!studentId) continue;
    const { error } = await service
      .from('section_students')
      .update({ enrolee_number: enroleeNumber })
      .eq('student_id', studentId)
      .in('section_id', sectionIds)
      .is('enrolee_number', null);
    if (!error) backwritten += 1;
  }
  if (backwritten > 0) {
    console.info(
      `[populated seeder] section_students.enrolee_number back-written for ${backwritten} student(s).`
    );
  }

  return {
    students_inserted: studentsInserted,
    enrolments_inserted: enrolmentsInserted,
  };
}

// Reconciliation pass: count enrolled admissions rows (Enrolled / Enrolled
// (Conditional) with a classSection) and how many resolved to a public.students
// record by studentNumber. orphans = enrolled-but-unsynced — MUST be 0.
async function reconcileEnrolled(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<{ enrolled: number; synced: number; orphans: number }> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Enrolled status rows with a class section assigned (the live "enrolled"
  // signal). Join to apps to read studentNumber.
  const statusRows = await fetchAllPages<{
    enroleeNumber: string | null;
    applicationStatus: string | null;
    classSection: string | null;
  }>((from, to) =>
    service
      .from(statusTable)
      .select('enroleeNumber, applicationStatus, classSection')
      .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)'])
      .not('classSection', 'is', null)
      .range(from, to)
  );
  const enrolledEnrolees = statusRows
    .map((r) => r.enroleeNumber)
    .filter((n): n is string => !!n);

  if (enrolledEnrolees.length === 0) {
    return { enrolled: 0, synced: 0, orphans: 0 };
  }

  // Resolve enroleeNumber → studentNumber from apps.
  const appRows = await fetchAllPages<{
    enroleeNumber: string | null;
    studentNumber: string | null;
  }>((from, to) =>
    service
      .from(appsTable)
      .select('enroleeNumber, studentNumber')
      .in('enroleeNumber', enrolledEnrolees)
      .range(from, to)
  );
  const studentNumbers = appRows
    .map((r) => r.studentNumber)
    .filter((n): n is string => !!n);

  // Which of those studentNumbers exist in public.students?
  let syncedNumbers = new Set<string>();
  if (studentNumbers.length > 0) {
    const existing = await fetchAllPages<{ student_number: string }>(
      (from, to) =>
        service
          .from('students')
          .select('student_number')
          .in('student_number', studentNumbers)
          .range(from, to)
    );
    syncedNumbers = new Set(existing.map((r) => r.student_number));
  }

  const enrolled = enrolledEnrolees.length;
  const synced = studentNumbers.filter((n) => syncedNumbers.has(n)).length;
  const orphans = enrolled - synced;

  if (orphans > 0) {
    console.error(
      `[populated seeder] RECONCILIATION FAILED — ${orphans} enrolled admissions row(s) have no matching public.students record (enrolled=${enrolled}, synced=${synced}).`
    );
  }

  return { enrolled, synced, orphans };
}

// Seeds ay{YY}_enrolment_documents for every row in ay{YY}_enrolment_applications
// (both funnel + enrolled). Document status mix per applicationStatus profile:
//
//   Submitted              — all 12 slots NULL (parent hasn't uploaded yet).
//   Ongoing Verification   — ~5 Valid / ~3 Pending / ~2 Rejected / ~2 NULL.
//   Processing             — ~9 Valid / 1-2 Rejected / 1-2 'To follow' / rest NULL.
//   Cancelled              — partial: ~4 Valid / rest NULL.
//   Withdrawn (pre-enrol)  — Valid through assessment-prereq slots, rest NULL.
//   Enrolled               — most have all 12 Valid; ~5 have 1-2 Rejected.
//   Enrolled (Conditional) — same as Enrolled (registrar bypassed the gate).
//
// Also stamps expiry dates on a subset to populate the P-Files dashboard's
// "expiring documents" buckets:
//   - 10 enrolled students: passportExpiry within next 30 days.
//   - 3 enrolled students:  passportExpiry already in the past.
//   - 5 enrolled students:  passExpiry mixed (3 expiring soon, 2 expired).
//
// Idempotent — fills in document rows only for enroleeNumbers that
// don't have one yet, so re-runs after a partial seed complete the set.
// Seed a handful of p_file_revisions rows so the P-Files revision-history
// dialog shows sample prior versions in test. Real revisions are written by
// the upload route + the parent-portal re-upload trigger (KD #36/#63); this
// mirrors that row shape (migrations 011 + 033). Enrolled students only
// (KD #71). Deterministic (seeded RNG) + idempotent (skips if this AY already
// has rows).
async function seedPFileRevisions(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const statusTable = `${prefix}_enrolment_status`;

  const { count: existing } = await service
    .from('p_file_revisions')
    .select('id', { count: 'exact', head: true })
    .eq('ay_code', testAy.ay_code);
  if ((existing ?? 0) > 0) return 0;

  const { data: statusData, error } = await service
    .from(statusTable)
    .select('enroleeNumber, applicationStatus')
    .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
  if (error || !statusData) return 0;
  const enrolees = (statusData as Array<{ enroleeNumber: string | null }>)
    .map((r) => r.enroleeNumber)
    .filter((n): n is string => !!n)
    .sort();
  if (enrolees.length === 0) return 0;

  const rand = mulberry32(hashString(`${testAy.ay_code}:pfile-revisions`));
  const ARCHIVE_URL =
    'https://vnhklhppftebbcuupfjw.supabase.co/storage/v1/object/public/parent-portal/ay2025/documents/1766798602565_Sample%20document.pdf';
  const SLOTS = ['passport', 'medical', 'birthCert', 'idPicture', 'pass'];
  const SOURCES = ['pfile-upload', 'parent-portal', 'sis-direct'] as const;

  const rows: Array<Record<string, unknown>> = [];
  for (const enroleeNumber of enrolees.slice(0, 6)) {
    const revCount = rand() < 0.4 ? 2 : 1;
    for (let r = 0; r < revCount; r += 1) {
      const slot = SLOTS[Math.floor(rand() * SLOTS.length)];
      const source = SOURCES[Math.floor(rand() * SOURCES.length)];
      const daysAgo = 10 + Math.floor(rand() * 110);
      const replacedAt = new Date(
        Date.now() - daysAgo * 86_400_000
      ).toISOString();
      rows.push({
        ay_code: testAy.ay_code,
        enrolee_number: enroleeNumber,
        slot_key: slot,
        // previous_url is the dedupe key (partial unique index, migration 033);
        // keep it unique per row so multiple revisions never collide.
        previous_url: `${ARCHIVE_URL}?prev=${enroleeNumber}-${slot}-${r}`,
        archived_url: ARCHIVE_URL,
        archived_path: `${prefix}/${enroleeNumber}/${slot}/revisions/seed-${r}.pdf`,
        status_snapshot: 'Valid',
        source,
        note: r === 0 ? 'Replaced with an updated copy.' : null,
        replaced_by_email: 'p-file.seed@hfse.test',
        replaced_at: replacedAt,
      });
    }
  }
  if (rows.length === 0) return 0;
  const { error: insErr } = await service.from('p_file_revisions').insert(rows);
  if (insErr) {
    console.error(
      '[populated seeder] p_file_revisions insert failed:',
      insErr.message
    );
    return 0;
  }
  return rows.length;
}

async function seedAdmissionsDocuments(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;
  const docsTable = `${prefix}_enrolment_documents`;

  // Existing enroleeNumbers in the docs table — these already have a row
  // and we leave them alone.
  const existingDocs = await fetchAllPages<{ enroleeNumber: string | null }>(
    (from, to) =>
      service.from(docsTable).select('enroleeNumber').range(from, to)
  );
  const existingDocNums = new Set(
    existingDocs.map((r) => r.enroleeNumber).filter((n): n is string => !!n)
  );

  // Pull every application row + matching status (need applicationStatus to
  // pick the per-row fill profile). Status rows are joined in JS to keep the
  // PostgREST query simple. fatherEmail + guardianEmail gate the
  // father*/guardian* slots per KD #69 — when no email exists for that
  // parent the slots stay NULL (parent portal would not have collected docs
  // for an absent parent).
  const { data: appsData, error: appsErr } = await service
    .from(appsTable)
    .select('enroleeNumber, studentNumber, fatherEmail, guardianEmail');
  if (appsErr || !appsData) {
    console.error(
      `[populated seeder] ${appsTable} read failed for documents seeder:`,
      appsErr?.message
    );
    return 0;
  }
  const apps = appsData as Array<{
    enroleeNumber: string;
    studentNumber: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
  }>;
  if (apps.length === 0) return 0;

  const { data: statusData, error: statusErr } = await service
    .from(statusTable)
    .select('enroleeNumber, applicationStatus');
  if (statusErr) {
    console.error(
      `[populated seeder] ${statusTable} read failed for documents seeder:`,
      statusErr.message
    );
    return 0;
  }
  const statusByEnrolee = new Map<string, string | null>();
  for (const r of (statusData ?? []) as Array<{
    enroleeNumber: string;
    applicationStatus: string | null;
  }>) {
    statusByEnrolee.set(r.enroleeNumber, r.applicationStatus);
  }

  const rand = mulberry32(hashString(`${testAy.ay_code}:documents`));
  // Real sample assets so the P-Files dashboard shows clickable thumbnails
  // / downloads instead of dead `test://` links. Photo-shaped slots get
  // the image; everything else gets the PDF.
  const IMAGE_URL =
    'https://vnhklhppftebbcuupfjw.supabase.co/storage/v1/object/public/parent-portal/ay2027/documents/1774407491653_favicon.png';
  const PDF_URL =
    'https://vnhklhppftebbcuupfjw.supabase.co/storage/v1/object/public/parent-portal/ay2025/documents/1766798602565_Sample%20document.pdf';
  const PHOTO_SLOT_KEYS = new Set(['idPicture']);
  const urlForSlot = (slotKey: string): string =>
    PHOTO_SLOT_KEYS.has(slotKey) ? IMAGE_URL : PDF_URL;
  const REJECTION_REASONS = [
    'Image too blurry — please re-scan with better lighting.',
    'Document expired — upload the latest version.',
    'Wrong file uploaded — this looks like a different document.',
    'Signature missing — re-upload the signed copy.',
    'Page cut off — please ensure the full page is captured.',
  ];
  const pickRejection = () =>
    REJECTION_REASONS[Math.floor(rand() * REJECTION_REASONS.length)];

  // Builds a slot-by-slot fill plan from a status profile. Returns a Map of
  // slot.key -> { status, url } so the caller can stitch into the insert row.
  type SlotFill = {
    status: string | null;
    url: string | null;
    rejection: string | null;
  };
  // Slots gated by parent-email presence (KD #69). When the corresponding
  // email is missing on the apps row, these slots stay NULL because the
  // parent portal never collected anything for an absent parent.
  const FATHER_SLOT_KEYS = new Set(['fatherPassport', 'fatherPass']);
  const GUARDIAN_SLOT_KEYS = new Set(['guardianPassport', 'guardianPass']);
  type Gates = { father: boolean; guardian: boolean };
  const buildSlotFill = (
    profile: string,
    gates: Gates
  ): Record<string, SlotFill> => {
    // Slot order from DOCUMENT_SLOTS (12 slots). Each profile picks a count
    // distribution and walks slots in order assigning statuses.
    const slots = DOCUMENT_SLOTS;
    const fill: Record<string, SlotFill> = {};
    // Default every slot to null first.
    for (const s of slots) {
      fill[s.key] = { status: null, url: null, rejection: null };
    }
    // Build the gated pool — slots eligible for assignment given the gates.
    // Father/guardian slots vanish from the pool when the matching parent
    // email is empty so no profile can write to them.
    const isGated = (key: string): boolean =>
      (FATHER_SLOT_KEYS.has(key) && !gates.father) ||
      (GUARDIAN_SLOT_KEYS.has(key) && !gates.guardian);

    // Helper: assign statuses to indices [start, start+count) (clamped).
    const assign = (
      indices: number[],
      status: string,
      hasUrl: boolean,
      withRejection: boolean
    ) => {
      for (const idx of indices) {
        if (idx < 0 || idx >= slots.length) continue;
        const k = slots[idx].key;
        fill[k] = {
          status,
          url: hasUrl ? urlForSlot(k) : null,
          rejection: withRejection ? pickRejection() : null,
        };
      }
    };

    // Pick `n` distinct indices from [0, slots.length) without replacement,
    // skipping gated father/guardian slots when the parent email is absent.
    // Pass nonExpiringOnly=true to restrict to non-expiring slots — used
    // when assigning 'Uploaded' which is only valid for non-expiring docs
    // per KD #60 (expiring slots start as 'Valid', never 'Uploaded').
    const pickIndices = (
      n: number,
      exclude: Set<number> = new Set(),
      nonExpiringOnly = false
    ): number[] => {
      const pool: number[] = [];
      for (let i = 0; i < slots.length; i++) {
        if (exclude.has(i)) continue;
        if (isGated(slots[i].key)) continue;
        if (nonExpiringOnly && slots[i].expiryCol) continue;
        pool.push(i);
      }
      // Fisher-Yates shuffle (in-place via swap).
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, Math.min(n, pool.length));
    };

    switch (profile) {
      case 'submitted': {
        // Parents can submit with required docs either uploaded or marked
        // 'To follow' (acknowledged-pending). Optional slots (medical /
        // educCert / form12) may stay null. Initial states per KD #60:
        //   - Non-expiring: 'Uploaded' (registrar hasn't validated yet).
        //   - Expiring:     'Valid' (the expiry date IS the validation).
        // Required slots: ~80% uploaded/valid, ~20% 'To follow'.
        const OPTIONAL = new Set(
          OPTIONAL_DOCUMENT_SLOT_KEYS as readonly string[]
        );
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (isGated(slot.key)) continue;
          if (OPTIONAL.has(slot.key) && rand() < 0.4) continue;
          if (!OPTIONAL.has(slot.key) && rand() < 0.2) {
            fill[slot.key] = {
              status: 'To follow',
              url: null,
              rejection: null,
            };
            continue;
          }
          const status = slot.expiryCol ? 'Valid' : 'Uploaded';
          fill[slot.key] = {
            status,
            url: urlForSlot(slot.key),
            rejection: null,
          };
        }
        return fill;
      }
      case 'ongoing-verification': {
        const validIdx = pickIndices(5);
        assign(validIdx, 'Valid', true, false);
        const used = new Set(validIdx);
        // Per KD #60 'Uploaded' is only valid for non-expiring slots (initial
        // state before registrar approval). Expiring slots go null → 'Valid'
        // directly — the expiry date IS the validation evidence. Pass
        // nonExpiringOnly=true so expiring slots are never assigned 'Uploaded'.
        const pendingIdx = pickIndices(3, used, true);
        assign(pendingIdx, 'Uploaded', true, false);
        for (const idx of pendingIdx) used.add(idx);
        const rejectIdx = pickIndices(2, used);
        assign(rejectIdx, 'Rejected', true, true);
        // Sweep: required non-optional non-gated slots that are still null
        // become 'To follow' — required docs are never silently missing.
        const OPTIONAL_OV = new Set(
          OPTIONAL_DOCUMENT_SLOT_KEYS as readonly string[]
        );
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (isGated(slot.key)) continue;
          if (OPTIONAL_OV.has(slot.key)) continue;
          if (!fill[slot.key].status) {
            fill[slot.key] = {
              status: 'To follow',
              url: null,
              rejection: null,
            };
          }
        }
        return fill;
      }
      case 'processing': {
        const validIdx = pickIndices(9);
        assign(validIdx, 'Valid', true, false);
        const used = new Set(validIdx);
        const rejectCount = rand() < 0.5 ? 1 : 2;
        const rejectIdx = pickIndices(rejectCount, used);
        assign(rejectIdx, 'Rejected', true, true);
        for (const idx of rejectIdx) used.add(idx);
        const toFollowCount = rand() < 0.5 ? 1 : 2;
        const toFollowIdx = pickIndices(toFollowCount, used);
        // 'To follow' = parent acknowledged pending; URL stays NULL.
        assign(toFollowIdx, 'To follow', false, false);
        // Sweep: required non-optional non-gated slots that are still null
        // become 'To follow' — required docs are never silently missing.
        const OPTIONAL_PR = new Set(
          OPTIONAL_DOCUMENT_SLOT_KEYS as readonly string[]
        );
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (isGated(slot.key)) continue;
          if (OPTIONAL_PR.has(slot.key)) continue;
          if (!fill[slot.key].status) {
            fill[slot.key] = {
              status: 'To follow',
              url: null,
              rejection: null,
            };
          }
        }
        return fill;
      }
      case 'cancelled': {
        // Partial fill — ~4 slots Valid, rest NULL.
        const validIdx = pickIndices(4);
        assign(validIdx, 'Valid', true, false);
        return fill;
      }
      case 'withdrawn-pre-enrolment': {
        // Got most of the way through pre-enrolment docs.
        const validIdx = pickIndices(8);
        assign(validIdx, 'Valid', true, false);
        return fill;
      }
      case 'enrolled-clean': {
        // All 12 slots Valid.
        const allIdx = Array.from({ length: slots.length }, (_, i) => i);
        assign(allIdx, 'Valid', true, false);
        return fill;
      }
      case 'enrolled-needs-revalidation': {
        // All Valid except 1-2 Rejected (awaiting parent re-upload).
        const allIdx = Array.from({ length: slots.length }, (_, i) => i);
        assign(allIdx, 'Valid', true, false);
        const rejectCount = rand() < 0.5 ? 1 : 2;
        const rejectIdx = pickIndices(rejectCount);
        assign(rejectIdx, 'Rejected', true, true);
        return fill;
      }
      case 'enrolled-realistic': {
        // Per-slot independent rolls. Status pool depends on whether the
        // slot is expiring (KD #60). URL is written when status is one of
        // the document-present states; 'To follow' and null leave URL null.
        // Father/guardian slots are gated per KD #69 — skip when no email.
        // Distribution: 55% Valid / 20% (Uploaded|Expired) / 15% To follow /
        // 10% Rejected. Optional slots (medical/educCert/form12) get a 30%
        // skip skew per KD #60 (admissions-side optional).
        const OPTIONAL = new Set(
          OPTIONAL_DOCUMENT_SLOT_KEYS as readonly string[]
        );
        for (const s of slots) {
          if (isGated(s.key)) continue;
          const isExpiring = !!s.expiryCol;
          if (OPTIONAL.has(s.key) && rand() < 0.3) {
            continue;
          }
          const r = rand();
          let status: string;
          if (r < 0.55) status = 'Valid';
          else if (r < 0.75) status = isExpiring ? 'Expired' : 'Uploaded';
          else if (r < 0.9) status = 'To follow';
          else status = 'Rejected';
          const hasUrl =
            status === 'Valid' ||
            status === 'Uploaded' ||
            status === 'Expired' ||
            status === 'Rejected';
          fill[s.key] = {
            status,
            url: hasUrl ? urlForSlot(s.key) : null,
            rejection: status === 'Rejected' ? pickRejection() : null,
          };
        }
        return fill;
      }
      default:
        return fill;
    }
  };

  // Map applicationStatus → slot-fill profile.
  const profileForStatus = (status: string | null, idx: number): string => {
    switch (status) {
      case 'Submitted':
        return 'submitted';
      case 'Ongoing Verification':
        return 'ongoing-verification';
      case 'Processing':
        return 'processing';
      case 'Cancelled':
        return 'cancelled';
      case 'Withdrawn':
        return 'withdrawn-pre-enrolment';
      case 'Enrolled':
      case 'Enrolled (Conditional)':
        // Realistic per-slot rolls so the P-Files dashboard (KD #71 enrolled-
        // only scope) shows the full mix of Valid / Uploaded / To follow /
        // Rejected / Expired / null. ~3% of enrolled rows get the legacy
        // needs-revalidation skew (mostly-Valid + 1-2 Rejected) for the
        // pastoral-care chase-strip demo.
        return idx % 30 === 0
          ? 'enrolled-needs-revalidation'
          : 'enrolled-realistic';
      default:
        return 'submitted';
    }
  };

  // Expiry rosters — built from enrolled rows only. Each kind gets three
  // buckets spread across the P-Files sidebar's 30/60/90-day quicklinks so
  // every filter renders rows. Indices are disjoint per persona type.
  // Passport: 5 × ≤30d + 5 × 31-60d + 5 × 61-90d + 3 expired = 18 rows.
  // Pass:     3 × ≤30d + 3 × 31-60d + 3 × 61-90d + 2 expired = 11 rows.
  const enrolledEnroleeNumbers = apps
    .map((a) => a.enroleeNumber)
    .filter((e) => {
      const s = statusByEnrolee.get(e);
      return s === 'Enrolled' || s === 'Enrolled (Conditional)';
    });
  const PASSPORT_EXPIRING_30 = new Set(enrolledEnroleeNumbers.slice(0, 5));
  const PASSPORT_EXPIRING_60 = new Set(enrolledEnroleeNumbers.slice(5, 10));
  const PASSPORT_EXPIRING_90 = new Set(enrolledEnroleeNumbers.slice(10, 15));
  const PASSPORT_ALREADY_EXPIRED = new Set(
    enrolledEnroleeNumbers.slice(15, 18)
  );
  const PASS_EXPIRING_30 = new Set(enrolledEnroleeNumbers.slice(18, 21));
  const PASS_EXPIRING_60 = new Set(enrolledEnroleeNumbers.slice(21, 24));
  const PASS_EXPIRING_90 = new Set(enrolledEnroleeNumbers.slice(24, 27));
  const PASS_ALREADY_EXPIRED = new Set(enrolledEnroleeNumbers.slice(27, 29));

  // Generate ISO yyyy-MM-dd offsets relative to today.
  const isoDateOffset = (days: number): string =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  const inserts: Array<Record<string, unknown>> = [];
  let enrolledIdx = 0;
  for (const app of apps) {
    const status = statusByEnrolee.get(app.enroleeNumber) ?? null;
    const isEnrolled =
      status === 'Enrolled' || status === 'Enrolled (Conditional)';
    const profile = profileForStatus(status, isEnrolled ? enrolledIdx++ : 0);
    const gates = {
      father: !!app.fatherEmail?.trim(),
      guardian: !!app.guardianEmail?.trim(),
    };
    const slotFill = buildSlotFill(profile, gates);

    const row: Record<string, unknown> = {
      enroleeNumber: app.enroleeNumber,
      studentNumber: app.studentNumber,
    };

    for (const slot of DOCUMENT_SLOTS) {
      const f = slotFill[slot.key];
      // Workflow semantics:
      //   - Non-expiring slots (no expiryCol): null → 'Uploaded' → 'Valid' / 'Rejected'.
      //   - Expiring slots (has expiryCol):    null → 'Valid' → 'Expired' / 'Rejected'.
      // 'Pending' is a legacy-ish state we collapse to 'Uploaded' on
      // non-expiring slots since that's what real production rows use.
      let status = f.status;
      const isExpiring = !!slot.expiryCol;
      if (status === 'Pending' && !isExpiring) {
        status = 'Uploaded';
      }
      row[slot.statusCol] = status;
      row[slot.urlCol] = f.url;
      // Stamp realistic expiry dates per KD #60 — every Valid expiring slot
      // gets a future date; every Expired slot gets a past date. Without
      // this the Records pass-expiry cohort + P-Files expiring buckets
      // would show every enrolled row as "expiry: —".
      if (isExpiring && slot.expiryCol) {
        if (status === 'Valid') {
          row[slot.expiryCol] = isoDateOffset(30 + Math.floor(rand() * 336));
        } else if (status === 'Expired') {
          row[slot.expiryCol] = isoDateOffset(-(1 + Math.floor(rand() * 180)));
        }
      }
      // Note: `${slot.key}RejectionReason` columns are NOT in the AY docs
      // schema (per migration 026 — `ay{YYYY}_enrolment_documents` has only
      // `<slot>` URL + `<slot>Status` + optional `<slot>Expiry`). The
      // `f.rejection` text is computed for status colour/badge purposes
      // elsewhere but deliberately not written to the row — PostgREST
      // returns 400 on unknown column keys and would fail the whole
      // chunked insert. Treat `f.rejection` as compute-time decoration only.
    }

    // Expiry stamps — only on enrolled rows that landed in the rosters.
    // Spread across 30/60/90-day buckets so every sidebar quicklink lights
    // up. When the date is in the past, the matching status flips to
    // 'Expired' (the auto-flipped state production produces).
    const passportEn = app.enroleeNumber;
    if (PASSPORT_EXPIRING_30.has(passportEn)) {
      row.passportExpiry = isoDateOffset(1 + Math.floor(rand() * 30));
      row.passportStatus = 'Valid';
    } else if (PASSPORT_EXPIRING_60.has(passportEn)) {
      row.passportExpiry = isoDateOffset(31 + Math.floor(rand() * 30));
      row.passportStatus = 'Valid';
    } else if (PASSPORT_EXPIRING_90.has(passportEn)) {
      row.passportExpiry = isoDateOffset(61 + Math.floor(rand() * 30));
      row.passportStatus = 'Valid';
    } else if (PASSPORT_ALREADY_EXPIRED.has(passportEn)) {
      row.passportExpiry = isoDateOffset(-(30 + Math.floor(rand() * 60)));
      row.passportStatus = 'Expired';
    }
    if (PASS_EXPIRING_30.has(passportEn)) {
      row.passExpiry = isoDateOffset(1 + Math.floor(rand() * 30));
      row.passStatus = 'Valid';
    } else if (PASS_EXPIRING_60.has(passportEn)) {
      row.passExpiry = isoDateOffset(31 + Math.floor(rand() * 30));
      row.passStatus = 'Valid';
    } else if (PASS_EXPIRING_90.has(passportEn)) {
      row.passExpiry = isoDateOffset(61 + Math.floor(rand() * 30));
      row.passStatus = 'Valid';
    } else if (PASS_ALREADY_EXPIRED.has(passportEn)) {
      row.passExpiry = isoDateOffset(-(30 + Math.floor(rand() * 60)));
      row.passStatus = 'Expired';
    }

    inserts.push(row);
  }

  // Filter out enroleeNumbers that already have a docs row.
  const filteredInserts = inserts.filter(
    (r) => !existingDocNums.has(String(r.enroleeNumber))
  );

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < filteredInserts.length; i += CHUNK) {
    const slice = filteredInserts.slice(i, i + CHUNK);
    const { error } = await service.from(docsTable).insert(slice);
    if (error) {
      console.error(
        `[populated seeder] ${docsTable} insert failed (chunk ${i}..${i + slice.length}):`,
        error.message
      );
      continue;
    }
    inserted += slice.length;
  }

  return inserted;
}

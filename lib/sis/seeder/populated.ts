import type { SupabaseClient } from '@supabase/supabase-js';

import { computeQuarterly } from '@/lib/compute/quarterly';

import { pickNames } from './names';

// Populated seeder — layers on top of `ensureTestStructure`. Once structure
// + students are in place, this fills grade entries, attendance, evaluation
// writeups, admissions-funnel rows, discount codes, and a demo publication
// window so every module renders populated screens instead of empty states.
//
// Each step is idempotent: checks for existing data keyed on AY9999-scoped
// identifiers and bails early when content is already present. Re-running
// `switchEnvironment('test')` doesn't duplicate anything.

export type PopulatedSeedResult = {
  grade_entries_inserted: number;
  attendance_daily_inserted: number;
  attendance_rollups_built: number;
  evaluation_writeups_inserted: number;
  admissions_apps_inserted: number;
  enrolled_applications_inserted: number;
  teacher_form_adviser_assignments: number;
  teacher_subject_assignments: number;
  discount_codes_inserted: number;
  publications_inserted: number;
};

// Deterministic PRNG — seeded per-call so the same AY always produces the
// same "random" scores on a cold seed. Matches the pattern in names.ts.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

export async function seedPopulated(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<PopulatedSeedResult> {
  const result: PopulatedSeedResult = {
    grade_entries_inserted: 0,
    attendance_daily_inserted: 0,
    attendance_rollups_built: 0,
    evaluation_writeups_inserted: 0,
    admissions_apps_inserted: 0,
    enrolled_applications_inserted: 0,
    teacher_form_adviser_assignments: 0,
    teacher_subject_assignments: 0,
    discount_codes_inserted: 0,
    publications_inserted: 0,
  };

  // ---- 1. Grade entries ----
  result.grade_entries_inserted = await seedGradeEntries(service, testAy);

  // ---- 2. Attendance daily + rollups ----
  const att = await seedAttendanceSummary(service, testAy);
  result.attendance_daily_inserted = att.daily;
  result.attendance_rollups_built = att.rollups;

  // ---- 3. Teacher assignments (form advisers + subject teachers) ----
  const ta = await seedTeacherAssignments(service, testAy);
  result.teacher_form_adviser_assignments = ta.form_adviser;
  result.teacher_subject_assignments = ta.subject_teacher;

  // ---- 4. Evaluation writeups ----
  result.evaluation_writeups_inserted = await seedEvaluationWriteups(service, testAy);

  // ---- 5. Enrolled-stage admissions rows (Records/Admissions detail pages
  //        need these to resolve for the seeded TEST-% students) ----
  result.enrolled_applications_inserted = await seedEnrolledAdmissionsRows(
    service,
    testAy,
  );

  // ---- 6. Admissions pre-enrolment funnel (non-enrolled stages) ----
  result.admissions_apps_inserted = await seedAdmissionsFunnel(service, testAy);

  // ---- 7. Discount codes ----
  result.discount_codes_inserted = await seedDiscountCodes(service, testAy);

  // ---- 8. One demo publication window ----
  result.publications_inserted = await seedPublication(service, testAy);

  return result;
}

// For every (grading_sheet × section_student) pair in T1 + first subject
// of T2, insert a grade_entry with plausible scores and the computed
// quarterly via `computeQuarterly`. Skips entirely if the AY already has
// grade_entries (measured via a count query).
async function seedGradeEntries(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  // Skip if any grade_entries already exist for this AY's sheets.
  const { data: sheetIds } = await service
    .from('grading_sheets')
    .select('id, term_id, section_id, subject_config_id, ww_totals, pt_totals, qa_total')
    .in(
      'term_id',
      (
        await service.from('terms').select('id').eq('academic_year_id', testAy.id)
      ).data?.map((r) => (r as { id: string }).id) ?? [],
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

  const { count: existing } = await service
    .from('grade_entries')
    .select('id', { count: 'exact', head: true })
    .in('grading_sheet_id', sheets.map((s) => s.id));
  if ((existing ?? 0) > 0) return 0;

  // Narrow to T1 only — we want T1 publishable-ready, T2+ mostly empty so
  // the registrar can exercise the entry flow. Fetch terms to identify T1.
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', testAy.id)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{ id: string; term_number: number }>;
  const t1 = terms.find((t) => t.term_number === 1);
  const t2 = terms.find((t) => t.term_number === 2);
  if (!t1) return 0;

  const targetTermIds = t2 ? [t1.id, t2.id] : [t1.id];
  const targetSheets = sheets.filter((s) => targetTermIds.includes(s.term_id));

  // Pull every section_student per section we're about to seed.
  const sectionIds = [...new Set(targetSheets.map((s) => s.section_id))];
  const { data: enrolments } = await service
    .from('section_students')
    .select('id, section_id, student_id')
    .in('section_id', sectionIds);
  const enrolmentsBySection = new Map<string, Array<{ id: string; student_id: string }>>();
  for (const e of (enrolments ?? []) as Array<{
    id: string;
    section_id: string;
    student_id: string;
  }>) {
    if (!enrolmentsBySection.has(e.section_id)) enrolmentsBySection.set(e.section_id, []);
    enrolmentsBySection.get(e.section_id)!.push({ id: e.id, student_id: e.student_id });
  }

  // Pull weights per subject_config_id (needed for computeQuarterly).
  const configIds = [...new Set(targetSheets.map((s) => s.subject_config_id))];
  const { data: cfgs } = await service
    .from('subject_configs')
    .select('id, ww_weight, pt_weight, qa_weight')
    .in('id', configIds);
  const configById = new Map(
    ((cfgs ?? []) as Array<{
      id: string;
      ww_weight: number;
      pt_weight: number;
      qa_weight: number;
    }>).map((c) => [c.id, c]),
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
  };
  const inserts: InsertRow[] = [];

  const rand = mulberry32(hashString(`${testAy.ay_code}:grades`));
  // Plausible score generator — centered around ~85 with variance.
  const scoreFor = (max: number) => {
    const pct = 0.70 + rand() * 0.25; // 70–95%
    return Math.round(pct * max);
  };

  for (const sheet of targetSheets) {
    const enrolments = enrolmentsBySection.get(sheet.section_id) ?? [];
    const cfg = configById.get(sheet.subject_config_id);
    if (!cfg) continue;

    const ww_totals = (sheet.ww_totals ?? [10, 10]).length > 0 ? sheet.ww_totals! : [10, 10];
    const pt_totals =
      (sheet.pt_totals ?? [10, 10, 10]).length > 0 ? sheet.pt_totals! : [10, 10, 10];
    const qa_total = sheet.qa_total ?? 30;

    // For T1: fill 100% (publishable). For T2: fill 30% (mid-entry demo).
    const fillProb = sheet.term_id === t1.id ? 1.0 : 0.3;

    for (const e of enrolments) {
      if (rand() > fillProb) continue;
      const ww_scores = ww_totals.map((max) => scoreFor(max));
      const pt_scores = pt_totals.map((max) => scoreFor(max));
      const qa_score = scoreFor(qa_total);

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
      });
    }
  }

  // Chunked insert — 500 rows per round-trip keeps us well under request limits.
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error } = await service.from('grade_entries').insert(slice);
    if (!error) inserted += slice.length;
  }
  return inserted;
}

// Daily attendance for T1. Inserts one `attendance_daily` row per
// (section_student × encodable school day) with a P-heavy random status
// distribution, then calls the `recompute_attendance_rollup` RPC per
// section_student so `attendance_records` mirrors what the wide-grid shows.
// Production uses the same rollup path — seeding via the same pipeline
// keeps the two views consistent.
async function seedAttendanceSummary(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<{ daily: number; rollups: number }> {
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', testAy.id)
    .eq('term_number', 1)
    .maybeSingle();
  const t1 = termRows as { id: string; term_number: number } | null;
  if (!t1) return { daily: 0, rollups: 0 };

  // Skip if daily rows already exist for T1. Note: this intentionally
  // ignores `attendance_records`. A previous seed may have inserted summary
  // rows but zero daily rows — the wide-grid would then show empty even
  // though Markbook's rollup showed data. Re-running lets the daily layer
  // repopulate and the RPC upsert the rollup consistently.
  const { count: existingDaily } = await service
    .from('attendance_daily')
    .select('id', { count: 'exact', head: true })
    .eq('term_id', t1.id);
  if ((existingDaily ?? 0) > 0) return { daily: 0, rollups: 0 };

  // Encodable school days in T1 (school_day + hbl).
  const { data: calendarRows } = await service
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', t1.id)
    .in('day_type', ['school_day', 'hbl'])
    .order('date');
  const schoolDays = ((calendarRows ?? []) as Array<{ date: string; day_type: string }>).map(
    (r) => r.date,
  );
  if (schoolDays.length === 0) {
    console.warn('[populated seeder] attendance: no encodable school days in T1 — skipping');
    return { daily: 0, rollups: 0 };
  }

  // All enrolments in the AY.
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
  const enrolList = ((enrolments ?? []) as Array<{ id: string }>).map((e) => e.id);
  if (enrolList.length === 0) {
    console.warn('[populated seeder] attendance: no enrolments in test AY — skipping');
    return { daily: 0, rollups: 0 };
  }

  // Weighted random status picker (P heavy, small mix of L/A/EX).
  const rand = mulberry32(hashString(`${testAy.ay_code}:attendance-daily`));
  function pickStatus(): 'P' | 'L' | 'A' | 'EX' {
    const r = rand();
    if (r < 0.9) return 'P';
    if (r < 0.94) return 'L';
    if (r < 0.97) return 'A';
    return 'EX';
  }

  // Build the ~9,400-row insert set.
  const rows: Array<{
    section_student_id: string;
    term_id: string;
    date: string;
    status: 'P' | 'L' | 'A' | 'EX';
  }> = [];
  for (const enrolmentId of enrolList) {
    for (const date of schoolDays) {
      rows.push({
        section_student_id: enrolmentId,
        term_id: t1.id,
        date,
        status: pickStatus(),
      });
    }
  }

  const CHUNK = 500;
  let insertedDaily = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await service.from('attendance_daily').insert(slice);
    if (error) {
      console.error('[populated seeder] attendance_daily insert failed:', error.message);
      continue;
    }
    insertedDaily += slice.length;
  }

  // If every insert failed, don't bother with rollups — they'd upsert zeros
  // and make the Markbook summary look broken. Surface the mismatch via a
  // clear console warning; caller returns 0/0 so the toast shows it.
  if (insertedDaily === 0) {
    console.error(
      '[populated seeder] attendance: all attendance_daily inserts failed — see earlier error',
    );
    return { daily: 0, rollups: 0 };
  }

  // Fire the rollup RPC once per section_student × T1 so
  // `attendance_records` reflects the daily ledger. Same path production
  // uses after each daily write. ~200 RPCs; each is a single aggregate +
  // upsert, cheap.
  let rollupCount = 0;
  for (const enrolmentId of enrolList) {
    const { error } = await service.rpc('recompute_attendance_rollup', {
      p_term_id: t1.id,
      p_section_student_id: enrolmentId,
    });
    if (error) {
      console.error(
        `[populated seeder] rollup RPC failed for ${enrolmentId}:`,
        error.message,
      );
      continue;
    }
    rollupCount += 1;
  }

  return { daily: insertedDaily, rollups: rollupCount };
}

// Seeds ~5 submitted evaluation writeups per section for T1 so the
// pre-publish checklist on the publish-window panel shows green on the
// "adviser comments" line for the demo section.
async function seedEvaluationWriteups(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const { data: t1 } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', testAy.id)
    .eq('term_number', 1)
    .maybeSingle();
  if (!t1) return 0;
  const termId = (t1 as { id: string }).id;

  const { count: existing } = await service
    .from('evaluation_writeups')
    .select('id', { count: 'exact', head: true })
    .eq('term_id', termId);
  if ((existing ?? 0) > 0) return 0;

  const { data: sections } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', testAy.id);
  const sectionIds = (sections ?? []).map((r) => (r as { id: string }).id);
  if (sectionIds.length === 0) return 0;

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
    submitted_at: string;
  }> = [];

  for (const sectionId of sectionIds) {
    const { data: enrolments } = await service
      .from('section_students')
      .select('student_id')
      .eq('section_id', sectionId)
      .limit(5);
    const students = (enrolments ?? []) as Array<{ student_id: string }>;
    for (const s of students) {
      const tmpl = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
      writeupRows.push({
        term_id: termId,
        student_id: s.student_id,
        section_id: sectionId,
        writeup: tmpl,
        submitted: true,
        submitted_at: new Date().toISOString(),
      });
    }
  }

  if (writeupRows.length === 0) return 0;
  const { error } = await service
    .from('evaluation_writeups')
    .insert(writeupRows);
  return error ? 0 : writeupRows.length;
}

// Injects ~30 pre-enrolment applications (Inquiry/Applied/Interviewed/
// Offered/Accepted) into ay9999_enrolment_applications + ay9999_enrolment_status
// so the Admissions dashboard has a non-empty funnel + outdated list.
// Skips when any non-Enrolled rows already exist.
async function seedAdmissionsFunnel(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Skip if non-enrolled rows already exist.
  const { count: nonEnrolled } = await service
    .from(statusTable)
    .select('id', { count: 'exact', head: true })
    .not('applicationStatus', 'in', '("Enrolled","Enrolled (Conditional)")');
  if ((nonEnrolled ?? 0) > 0) return 0;

  const STAGES = [
    { status: 'Inquiry', count: 8 },
    { status: 'Applied', count: 10 },
    { status: 'Interviewed', count: 6 },
    { status: 'Offered', count: 4 },
    { status: 'Accepted', count: 4 },
  ] as const;

  const LEVELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'S1', 'S2', 'S3'];
  const REFERRALS = ['Facebook', 'Google', 'Word of Mouth', 'School Visit', 'Alumni', 'Parent Referral'];

  const rand = mulberry32(hashString(`${testAy.ay_code}:funnel`));
  const names = pickNames(`${testAy.ay_code}:funnel`, STAGES.reduce((n, s) => n + s.count, 0));

  const appRows: Array<Record<string, unknown>> = [];
  const statusRows: Array<Record<string, unknown>> = [];
  let nameIdx = 0;

  for (const stage of STAGES) {
    for (let i = 0; i < stage.count; i++) {
      const n = names[nameIdx++];
      // Enrolee number format: <prefix>-TEST-<4-digit>
      const seq = String(5000 + nameIdx).padStart(4, '0');
      const enroleeNumber = `${prefix.toUpperCase()}-TEST-${seq}`;
      const levelApplied = LEVELS[Math.floor(rand() * LEVELS.length)];
      const referral = REFERRALS[Math.floor(rand() * REFERRALS.length)];
      // Dates spread back ~60 days for outdated-applications demo.
      const daysBack = Math.floor(rand() * 60);
      const dateIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      appRows.push({
        enroleeNumber,
        firstName: n.first_name,
        lastName: n.last_name,
        enroleeFullName: `${n.first_name} ${n.last_name}`,
        levelApplied,
        hearAboutUs: referral,
      });
      statusRows.push({
        enroleeNumber,
        applicationStatus: stage.status,
        levelApplied,
        applicationUpdatedDate: dateIso,
      });
    }
  }

  const { error: appsErr } = await service.from(appsTable).insert(appRows);
  if (appsErr) {
    console.error('[populated seeder] admissions apps insert failed:', appsErr.message);
    return 0;
  }
  const { error: statusErr } = await service.from(statusTable).insert(statusRows);
  if (statusErr) {
    console.error('[populated seeder] admissions status insert failed:', statusErr.message);
  }
  return appRows.length;
}

// Seeds ~5 plausible discount codes in the test AY's discount-codes table.
async function seedDiscountCodes(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const table = `${prefix}_discount_codes`;

  const { count: existing } = await service
    .from(table)
    .select('code', { count: 'exact', head: true });
  if ((existing ?? 0) > 0) return 0;

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextQuarter = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  const rows = [
    {
      code: 'ALUMNI-15',
      description: 'Alumni family — 15% off first term',
      percentageDiscount: 15,
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
    },
    {
      code: 'SIBLING-10',
      description: 'Sibling discount — 10%',
      percentageDiscount: 10,
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
    },
    {
      code: 'EARLY-BIRD',
      description: 'Early enrolment — 7% off',
      percentageDiscount: 7,
      startDate: today.toISOString().slice(0, 10),
      endDate: nextMonth.toISOString().slice(0, 10),
    },
    {
      code: 'STAFF-20',
      description: 'HFSE staff family — 20%',
      percentageDiscount: 20,
      startDate: today.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
    },
    {
      code: 'SCHEDULED-05',
      description: 'Future promotion (not yet active)',
      percentageDiscount: 5,
      startDate: tomorrow.toISOString().slice(0, 10),
      endDate: nextQuarter.toISOString().slice(0, 10),
    },
  ];

  const { error } = await service.from(table).insert(rows);
  if (error) {
    console.error('[populated seeder] discount codes insert failed:', error.message);
    return 0;
  }
  return rows.length;
}

// Creates one publish-window for the first section × T1 so the parent
// portal + publish-checklist have something to demo.
async function seedPublication(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const { data: t1 } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', testAy.id)
    .eq('term_number', 1)
    .maybeSingle();
  if (!t1) return 0;
  const termId = (t1 as { id: string }).id;

  const { data: firstSection } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', testAy.id)
    .order('name')
    .limit(1)
    .maybeSingle();
  if (!firstSection) return 0;
  const sectionId = (firstSection as { id: string }).id;

  const { count: existing } = await service
    .from('report_card_publications')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .eq('term_id', termId);
  if ((existing ?? 0) > 0) return 0;

  const from = new Date();
  const until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { error } = await service.from('report_card_publications').insert({
    section_id: sectionId,
    term_id: termId,
    publish_from: from.toISOString(),
    publish_until: until.toISOString(),
    published_by: 'test-seeder@hfse.edu.sg',
  });
  if (error) {
    console.error('[populated seeder] publication insert failed:', error.message);
    return 0;
  }
  return 1;
}

// Round-robin assigns existing staff users as form_advisers + subject_teachers
// across the test AY's sections. Prefers `role='teacher'` users; falls back
// to registrar/school_admin/admin/superadmin if no teachers exist. Skip guard
// is a single "any row already" count to keep the check cheap.
async function seedTeacherAssignments(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<{ form_adviser: number; subject_teacher: number }> {
  // AY-scoped sections.
  const { data: sections } = await service
    .from('sections')
    .select('id, level_id')
    .eq('academic_year_id', testAy.id);
  const sectionRows = ((sections ?? []) as Array<{ id: string; level_id: string }>);
  if (sectionRows.length === 0) return { form_adviser: 0, subject_teacher: 0 };

  // Skip if any teacher_assignments row already exists for these sections.
  const { count: existing } = await service
    .from('teacher_assignments')
    .select('id', { count: 'exact', head: true })
    .in('section_id', sectionRows.map((s) => s.id));
  if ((existing ?? 0) > 0) return { form_adviser: 0, subject_teacher: 0 };

  // Pool of candidate users. Supabase JS `auth.admin.listUsers` returns
  // everyone including parents (role=null). Filter to staff roles.
  const { data: userList, error: usersErr } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  if (usersErr) {
    console.error('[populated seeder] listUsers failed:', usersErr.message);
    return { form_adviser: 0, subject_teacher: 0 };
  }
  const STAFF_ROLES = new Set(['teacher', 'registrar', 'school_admin', 'admin', 'superadmin']);
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
      '[populated seeder] no staff users to assign — teacher flows will be empty',
    );
    return { form_adviser: 0, subject_teacher: 0 };
  }

  // ---- Form advisers: one per section, round-robin ----
  const faRows = sectionRows.map((s, i) => ({
    teacher_user_id: pool[i % pool.length].id,
    section_id: s.id,
    subject_id: null as string | null,
    role: 'form_adviser' as const,
  }));
  const { error: faErr, data: faInserted } = await service
    .from('teacher_assignments')
    .insert(faRows)
    .select('id');
  if (faErr) {
    console.error('[populated seeder] form_adviser insert failed:', faErr.message);
  }
  const formAdviserCount = faInserted?.length ?? 0;

  // ---- Subject teachers: one per (section × subject) from subject_configs ----
  // Pull the full matrix then round-robin. subject_configs scopes by
  // (academic_year_id, level_id); we need the level match per section.
  const { data: configs } = await service
    .from('subject_configs')
    .select('subject_id, level_id')
    .eq('academic_year_id', testAy.id);
  const cfgByLevel = new Map<string, string[]>();
  for (const c of (configs ?? []) as Array<{ subject_id: string; level_id: string }>) {
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
          error.message,
        );
        continue;
      }
      subjectTeacherCount += data?.length ?? 0;
    }
  }

  return { form_adviser: formAdviserCount, subject_teacher: subjectTeacherCount };
}

// For every TEST-% student in public.students, upserts a matching row in
// ay{YY}_enrolment_applications + ay{YY}_enrolment_status with stage marked
// Enrolled. Fills the gap so /records/students (which filters the admissions
// tables to Enrolled) shows rows, and Admissions applicant-detail pages for
// those students resolve.
async function seedEnrolledAdmissionsRows(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Skip if any Enrolled row already exists.
  const { count: existing } = await service
    .from(statusTable)
    .select('id', { count: 'exact', head: true })
    .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']);
  if ((existing ?? 0) > 0) return 0;

  // Pull every TEST-% student + their section placement + level code.
  const { data: enrolmentRows } = await service
    .from('section_students')
    .select(
      `
        id,
        student:students!inner(id, student_number, first_name, last_name, middle_name),
        section:sections!inner(
          name,
          academic_year_id,
          level:levels(code, label)
        )
      `,
    )
    .like('student.student_number', 'TEST-%');

  type EnrolRow = {
    id: string;
    student:
      | {
          id: string;
          student_number: string;
          first_name: string | null;
          last_name: string | null;
          middle_name: string | null;
        }
      | {
          id: string;
          student_number: string;
          first_name: string | null;
          last_name: string | null;
          middle_name: string | null;
        }[]
      | null;
    section:
      | {
          name: string;
          academic_year_id: string;
          level: { code: string; label: string } | { code: string; label: string }[] | null;
        }
      | {
          name: string;
          academic_year_id: string;
          level: { code: string; label: string } | { code: string; label: string }[] | null;
        }[]
      | null;
  };

  const rows = ((enrolmentRows ?? []) as unknown as EnrolRow[])
    .map((r) => {
      const student = Array.isArray(r.student) ? r.student[0] : r.student;
      const section = Array.isArray(r.section) ? r.section[0] : r.section;
      if (!student || !section) return null;
      if (section.academic_year_id !== testAy.id) return null;
      const level = Array.isArray(section.level) ? section.level[0] : section.level;
      if (!level) return null;
      return {
        studentNumber: student.student_number,
        firstName: student.first_name,
        lastName: student.last_name,
        middleName: student.middle_name,
        sectionName: section.name,
        levelCode: level.code,
        levelLabel: level.label,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;

  const todayIso = new Date().toISOString().slice(0, 10);
  const upperPrefix = prefix.toUpperCase();

  const appInserts = rows.map((r, i) => ({
    enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
    studentNumber: r.studentNumber,
    firstName: r.firstName,
    lastName: r.lastName,
    middleName: r.middleName,
    enroleeFullName: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' '),
    levelApplied: r.levelCode,
    applicationStatus: 'Enrolled',
  }));
  const statusInserts = rows.map((r, i) => ({
    enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
    applicationStatus: 'Enrolled',
    levelApplied: r.levelCode,
    classLevel: r.levelCode,
    classSection: r.sectionName,
    classStatus: 'Assigned',
    applicationUpdatedDate: todayIso,
  }));

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < appInserts.length; i += CHUNK) {
    const appSlice = appInserts.slice(i, i + CHUNK);
    const statusSlice = statusInserts.slice(i, i + CHUNK);
    const { error: appsErr } = await service.from(appsTable).insert(appSlice);
    if (appsErr) {
      console.error(
        `[populated seeder] ${appsTable} insert failed (chunk ${i}..${i + appSlice.length}):`,
        appsErr.message,
      );
      continue;
    }
    const { error: statusErr } = await service.from(statusTable).insert(statusSlice);
    if (statusErr) {
      console.error(
        `[populated seeder] ${statusTable} insert failed (chunk ${i}..${i + statusSlice.length}):`,
        statusErr.message,
      );
      continue;
    }
    inserted += appSlice.length;
  }

  return inserted;
}

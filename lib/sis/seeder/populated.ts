import type { SupabaseClient } from '@supabase/supabase-js';

import { computeQuarterly } from '@/lib/compute/quarterly';
import {
  LEVEL_LABELS,
  LEVEL_CODES,
  LEVEL_TYPE_BY_CODE,
  type LevelCode,
} from '@/lib/sis/levels';
import { DOCUMENT_SLOTS, STP_CONDITIONAL_SLOT_KEYS } from '@/lib/sis/queries';

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
  documents_inserted: number;
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
    documents_inserted: 0,
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

  // ---- 9. Admissions documents (P-Files dashboards + lifecycle widget) ----
  result.documents_inserted = await seedAdmissionsDocuments(service, testAy);

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
  rand: () => number,
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
  { applicationStatus: 'Ongoing Verification', count: 8, stageProfile: 'ongoing-verification' },
  { applicationStatus: 'Processing', count: 12, stageProfile: 'processing' },
  { applicationStatus: 'Cancelled', count: 3, stageProfile: 'cancelled' },
  { applicationStatus: 'Withdrawn', count: 2, stageProfile: 'withdrawn-pre-enrolment' },
];

// 4-value enum mirrored across the apps row's `category` and the status row's
// `enroleeType`. They always agree. Distribution: ~70% Current (returning),
// ~25% New (first-time), ~3% VizSchool Current, ~2% VizSchool New.
type EnroleeCategoryValue = 'New' | 'Current' | 'VizSchool New' | 'VizSchool Current';
function pickEnroleeCategory(rand: () => number): EnroleeCategoryValue {
  const r = rand();
  if (r < 0.70) return 'Current';
  if (r < 0.95) return 'New';
  if (r < 0.98) return 'VizSchool Current';
  return 'VizSchool New';
}

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
const PLACEHOLDER_PHOTO = 'https://placeholder.test/student-photo.png';

// Yes/No string flags — real production rows store these as strings, not bools.
const YES_NO = ['Yes', 'No'] as const;

// STP application type — set on the foreign-student personas (parent-portal
// gates 3 specific document slots when this is non-null per the STP workflow).
const STP_APPLICATION_TYPE = 'New Student Pass Application';

// Sample residenceHistory JSON for STP applicants. Stored as a JSON string in
// the column (matches production format).
const STP_RESIDENCE_HISTORY =
  '[{"toYear":"Present","country":"Singapore","fromYear":2020,"cityOrTown":"Singapore","purposeOfStay":"Schooling"}]';

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
    (c) => LEVEL_TYPE_BY_CODE[c] !== 'preschool' && c !== 'CS1' && c !== 'CS2',
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
        Date.now() - daysBack * 24 * 60 * 60 * 1000,
      ).toISOString();

      const stageFill = stageProgressionFor(profile.stageProfile, rand);
      const category = pickEnroleeCategory(rand);
      const classType = CLASS_TYPES[Math.floor(rand() * CLASS_TYPES.length)];
      const paymentOption = PAYMENT_OPTIONS[Math.floor(rand() * PAYMENT_OPTIONS.length)];
      const contractSignatory =
        CONTRACT_SIGNATORIES[Math.floor(rand() * CONTRACT_SIGNATORIES.length)];
      const passType = PASS_TYPES[Math.floor(rand() * PASS_TYPES.length)];
      // STP application: ~30% of foreign-student rows (those without Singapore
      // PR). The 4 STP-conditional doc slots only get populated when this is set.
      const isStpApplicant = passType !== 'Singapore PR' && rand() < 0.45;
      const stpApplicationType = isStpApplicant ? STP_APPLICATION_TYPE : null;
      // 10% of funnel rows have allergy data (realistic distribution).
      const hasAllergies = rand() < 0.10;

      appRows.push({
        enroleeNumber,
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
        // Real DB stores avail* as Yes/No strings, not bools.
        availSchoolBus: YES_NO[Math.floor(rand() * YES_NO.length)],
        availUniform: YES_NO[Math.floor(rand() * YES_NO.length)],
        availStudentCare: YES_NO[Math.floor(rand() * YES_NO.length)],
        howDidYouKnowAboutHFSEIS: referral,
        // Parent-portal-side status — always 'Registered' once the parent
        // completes the registration form. SIS-side workflow status lives on
        // the status row below as `applicationStatus`.
        applicationStatus: 'Registered',
        // STP application tracker (HFSE Edutrust Certified, sponsors Student
        // Pass via ICA when applicable).
        stpApplicationType,
        residenceHistory: isStpApplicant ? STP_RESIDENCE_HISTORY : null,
        // Medical flags — minimal realistic surface for now.
        allergies: hasAllergies,
        allergyDetails: hasAllergies ? 'Test allergy details' : null,
        paracetamolConsent: true,
        socialMediaConsent: rand() < 0.7,
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
      // For Processing rows that landed on the fee stage with feeStatus='Paid'
      // (i.e. the ungated-to-enroll branch), stamp a recent feePaymentDate so
      // the lifecycle widget's payment-recency slice has data.
      if (stageFill.feeStatus === 'Paid') {
        const payDaysBack = Math.floor(rand() * 14);
        statusRow.feePaymentDate = new Date(
          Date.now() - payDaysBack * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);
      }
      statusRows.push(statusRow);
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

// Seeds 7 plausible discount codes in the test AY's discount-codes table.
// Real schema columns: discountCode, details, enroleeType, startDate, endDate.
// (No `percentageDiscount` column — discount semantics live in `details` text.)
// Code naming convention is AY-prefixed: AY99 = AY9999 test environment.
async function seedDiscountCodes(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const table = `${prefix}_discount_codes`;

  const { count: existing } = await service
    .from(table)
    .select('discountCode', { count: 'exact', head: true });
  if ((existing ?? 0) > 0) return 0;

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
// to registrar/school_admin/superadmin if no teachers exist. Skip guard
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
  const STAFF_ROLES = new Set(['teacher', 'registrar', 'school_admin', 'superadmin']);
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

  // Persona quirks layered on top of the default "everything Finished, status
  // Enrolled" baseline. Of ~200 rows:
  //   - 3 are Enrolled (Conditional) — registrar carve-outs (waiver path).
  //   - 5 are Enrolled with documentStatus='Verified' (not Finished) —
  //     "documents almost done" tail; exercises the lifecycle widget's
  //     near-complete bucket and the dashboard's docs-pending count.
  //   - 2 are Withdrawn post-enrollment (~30 days back) so the
  //     <StudentLifecycleTimeline> branches into the withdrawal path.
  // Counted from the start of the rows array so they're deterministic across
  // re-seeds.
  const CONDITIONAL_RANGE = { start: 0, end: 3 };
  const VERIFIED_DOCS_RANGE = { start: 3, end: 8 };
  const WITHDRAWN_RANGE = { start: 8, end: 10 };

  const personaApplicationStatus = (i: number): ApplicationStatus => {
    if (i >= CONDITIONAL_RANGE.start && i < CONDITIONAL_RANGE.end) {
      return 'Enrolled (Conditional)';
    }
    if (i >= WITHDRAWN_RANGE.start && i < WITHDRAWN_RANGE.end) {
      return 'Withdrawn';
    }
    return 'Enrolled';
  };

  // Document status fill: standard rows get all 5 prereqs Finished/Signed/Paid.
  // Verified-docs persona gets documentStatus='Verified' instead of 'Finished'.
  // Withdrawn persona keeps prereqs at their last-known state (Finished) since
  // they enrolled before withdrawing.
  const personaStageFill = (i: number) => {
    const isVerified = i >= VERIFIED_DOCS_RANGE.start && i < VERIFIED_DOCS_RANGE.end;
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
  const personaUpdatedDate = (i: number): string => {
    if (i >= WITHDRAWN_RANGE.start && i < WITHDRAWN_RANGE.end) return thirtyDaysAgo;
    return todayIso;
  };

  // Deterministic per-AY rand for category / classType / pass / STP picks. Same
  // pattern as funnel — keeps re-runs stable.
  const enrolledRand = mulberry32(hashString(`${testAy.ay_code}:enrolled-personas`));

  // Per-row metadata computed once, then shared between appInserts and
  // statusInserts so apps.category + status.enroleeType always agree (they
  // mirror each other in production).
  const personaMeta = rows.map(() => {
    const category = pickEnroleeCategory(enrolledRand);
    const classType = CLASS_TYPES[Math.floor(enrolledRand() * CLASS_TYPES.length)];
    const paymentOption =
      PAYMENT_OPTIONS[Math.floor(enrolledRand() * PAYMENT_OPTIONS.length)];
    const contractSignatory =
      CONTRACT_SIGNATORIES[Math.floor(enrolledRand() * CONTRACT_SIGNATORIES.length)];
    const passType = PASS_TYPES[Math.floor(enrolledRand() * PASS_TYPES.length)];
    const isStpApplicant = passType !== 'Singapore PR' && enrolledRand() < 0.20;
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
    return {
      enroleeNumber: `${upperPrefix}-ENR-${String(i + 1).padStart(4, '0')}`,
      studentNumber: r.studentNumber,
      category: m.category,
      firstName: r.firstName,
      lastName: r.lastName,
      middleName: r.middleName,
      enroleeFullName: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' '),
      levelApplied: r.levelLabel,
      classType: m.classType,
      paymentOption: m.paymentOption,
      contractSignatory: m.contractSignatory,
      pass: m.passType,
      enroleePhoto: PLACEHOLDER_PHOTO,
      availSchoolBus: m.availSchoolBus,
      availUniform: m.availUniform,
      availStudentCare: m.availStudentCare,
      // applications.applicationStatus = parent-portal-side. Always 'Registered'
      // for an enrolled student (parent finished registration form). The SIS
      // pipeline status lives on the status row.
      applicationStatus: 'Registered',
      stpApplicationType: m.isStpApplicant ? STP_APPLICATION_TYPE : null,
      residenceHistory: m.isStpApplicant ? STP_RESIDENCE_HISTORY : null,
      paracetamolConsent: true,
      socialMediaConsent: m.socialMediaConsent,
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
// Idempotent — bails entirely if any rows already exist for the AY.
async function seedAdmissionsDocuments(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<number> {
  const prefix = prefixFor(testAy.ay_code);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;
  const docsTable = `${prefix}_enrolment_documents`;

  // Skip-guard: any rows already → bail.
  const { count: existing } = await service
    .from(docsTable)
    .select('enroleeNumber', { count: 'exact', head: true });
  if ((existing ?? 0) > 0) return 0;

  // Pull every application row + matching status (need applicationStatus to
  // pick the per-row fill profile). Status rows are joined in JS to keep the
  // PostgREST query simple. stpApplicationType gates the 3 STP-conditional
  // slots (icaPhoto / financialSupportDocs / vaccinationInformation) so they
  // only get populated for foreign-student personas.
  const { data: appsData, error: appsErr } = await service
    .from(appsTable)
    .select('enroleeNumber, studentNumber, stpApplicationType');
  if (appsErr || !appsData) {
    console.error(
      `[populated seeder] ${appsTable} read failed for documents seeder:`,
      appsErr?.message,
    );
    return 0;
  }
  const apps = appsData as Array<{
    enroleeNumber: string;
    studentNumber: string | null;
    stpApplicationType: string | null;
  }>;
  if (apps.length === 0) return 0;

  const { data: statusData, error: statusErr } = await service
    .from(statusTable)
    .select('enroleeNumber, applicationStatus');
  if (statusErr) {
    console.error(
      `[populated seeder] ${statusTable} read failed for documents seeder:`,
      statusErr.message,
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
  const PLACEHOLDER_URL = 'test://document.pdf';
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
  const buildSlotFill = (profile: string): Record<string, SlotFill> => {
    // Slot order from DOCUMENT_SLOTS (12 slots). Each profile picks a count
    // distribution and walks slots in order assigning statuses.
    const slots = DOCUMENT_SLOTS;
    const fill: Record<string, SlotFill> = {};
    // Default every slot to null first.
    for (const s of slots) {
      fill[s.key] = { status: null, url: null, rejection: null };
    }

    // Helper: assign statuses to indices [start, start+count) (clamped).
    const assign = (
      indices: number[],
      status: string,
      hasUrl: boolean,
      withRejection: boolean,
    ) => {
      for (const idx of indices) {
        if (idx < 0 || idx >= slots.length) continue;
        const k = slots[idx].key;
        fill[k] = {
          status,
          url: hasUrl ? PLACEHOLDER_URL : null,
          rejection: withRejection ? pickRejection() : null,
        };
      }
    };

    // Pick `n` distinct indices from [0, slots.length) without replacement.
    const pickIndices = (n: number, exclude: Set<number> = new Set()): number[] => {
      const pool: number[] = [];
      for (let i = 0; i < slots.length; i++) {
        if (!exclude.has(i)) pool.push(i);
      }
      // Fisher-Yates shuffle (in-place via swap).
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, Math.min(n, pool.length));
    };

    switch (profile) {
      case 'submitted':
        // All NULL — no work yet.
        return fill;
      case 'ongoing-verification': {
        const validIdx = pickIndices(5);
        assign(validIdx, 'Valid', true, false);
        const used = new Set(validIdx);
        const pendingIdx = pickIndices(3, used);
        // Per KD #60 the canonical per-slot status for "parent uploaded,
        // awaiting registrar review" is 'Uploaded' (not 'Pending', which
        // is a stage-level status used on enrolment_status). Writing
        // 'Pending' here used to leak into the P-Files quick filters as
        // 'valid' instead of 'uploaded' because resolveStatus only
        // recognises the canonical word.
        assign(pendingIdx, 'Uploaded', true, false);
        for (const idx of pendingIdx) used.add(idx);
        const rejectIdx = pickIndices(2, used);
        assign(rejectIdx, 'Rejected', true, true);
        // Remaining 2 stay NULL.
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
        // ~5 of every ~200 enrolled get the needs-revalidation flavor.
        return idx % 40 === 0 ? 'enrolled-needs-revalidation' : 'enrolled-clean';
      default:
        return 'submitted';
    }
  };

  // Expiry rosters — built from enrolled rows only. Index ranges chosen so
  // the personas don't collide (10 + 3 + 5 = 18 distinct rows; 200 enrolled
  // total leaves plenty of room).
  const enrolledEnroleeNumbers = apps
    .map((a) => a.enroleeNumber)
    .filter((e) => {
      const s = statusByEnrolee.get(e);
      return s === 'Enrolled' || s === 'Enrolled (Conditional)';
    });
  const PASSPORT_EXPIRING_SOON = new Set(enrolledEnroleeNumbers.slice(0, 10));
  const PASSPORT_ALREADY_EXPIRED = new Set(enrolledEnroleeNumbers.slice(10, 13));
  const PASS_EXPIRING_SOON = new Set(enrolledEnroleeNumbers.slice(13, 16));
  const PASS_ALREADY_EXPIRED = new Set(enrolledEnroleeNumbers.slice(16, 18));

  // Generate ISO yyyy-MM-dd offsets relative to today.
  const isoDateOffset = (days: number): string =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const inserts: Array<Record<string, unknown>> = [];
  let enrolledIdx = 0;
  for (const app of apps) {
    const status = statusByEnrolee.get(app.enroleeNumber) ?? null;
    const isEnrolled = status === 'Enrolled' || status === 'Enrolled (Conditional)';
    const profile = profileForStatus(status, isEnrolled ? enrolledIdx++ : 0);
    const slotFill = buildSlotFill(profile);

    const row: Record<string, unknown> = {
      enroleeNumber: app.enroleeNumber,
      studentNumber: app.studentNumber,
    };

    const isStpApplicant = !!app.stpApplicationType;

    for (const slot of DOCUMENT_SLOTS) {
      // STP-conditional slots only populated for foreign-student personas.
      // Non-STP applicants leave these slot+status columns NULL.
      const isStpSlot = (STP_CONDITIONAL_SLOT_KEYS as readonly string[]).includes(slot.key);
      if (isStpSlot && !isStpApplicant) {
        row[slot.statusCol] = null;
        row[slot.urlCol] = null;
        continue;
      }

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
      // Rejection reason column convention: `${slotKey}RejectionReason`.
      // Some historical AYs may not have this column; PostgREST will silently
      // drop the field on insert if absent, which is fine for the seeder.
      if (f.rejection) {
        row[`${slot.key}RejectionReason`] = f.rejection;
      }
    }

    // Expiry stamps — only on enrolled rows that landed in the rosters.
    // When the date is in the past, the matching status is 'Expired' (the
    // auto-flipped state production produces when the expiry passes).
    if (PASSPORT_EXPIRING_SOON.has(app.enroleeNumber)) {
      row.passportExpiry = isoDateOffset(1 + Math.floor(rand() * 30));
      // Status stays 'Valid' (set by buildSlotFill for enrolled-clean profile).
    } else if (PASSPORT_ALREADY_EXPIRED.has(app.enroleeNumber)) {
      row.passportExpiry = isoDateOffset(-(30 + Math.floor(rand() * 60)));
      row.passportStatus = 'Expired';
    }
    if (PASS_EXPIRING_SOON.has(app.enroleeNumber)) {
      row.passExpiry = isoDateOffset(1 + Math.floor(rand() * 30));
    } else if (PASS_ALREADY_EXPIRED.has(app.enroleeNumber)) {
      row.passExpiry = isoDateOffset(-(30 + Math.floor(rand() * 60)));
      row.passStatus = 'Expired';
    }

    inserts.push(row);
  }

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error } = await service.from(docsTable).insert(slice);
    if (error) {
      console.error(
        `[populated seeder] ${docsTable} insert failed (chunk ${i}..${i + slice.length}):`,
        error.message,
      );
      continue;
    }
    inserted += slice.length;
  }

  return inserted;
}

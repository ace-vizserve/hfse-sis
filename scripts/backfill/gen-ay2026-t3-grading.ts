// scripts/backfill/gen-ay2026-t3-grading.ts
// DRY RUN of the AY2026 Term 3 grading import. Reads the 19 T3 subject
// workbooks and a READ-ONLY snapshot of production, then writes:
//
//   scripts/backfill/ay2026-t3-primary-grading-{preview,apply}.sql
//   scripts/backfill/ay2026-t3-secondary-grading-{preview,apply}.sql
//   scripts/backfill/ay2026-t3-grading-report.txt
//
// It never writes to the database — the apply files are for a person to run
// in the Supabase SQL editor after reading the report.
//
// Why one generator instead of T2's primary + secondary pair: T3's folders are
// "Cambridge/" (the 8 Global-class files — T2's "Lower Secondary Global
// Grading Sheets/") and "Grades/" (11 per-subject files holding Primary AND
// Regular-track Secondary tabs — T2's "GRADES/"). The Grades/ files feed both
// tracks, so every tab is read once, placed on its class, and the SQL is split
// by the level of the class it lands on. The per-track SQL files keep T2's
// names and shape. What changed from T2, and which earlier correction each
// change bakes in, is written at the top of
// lib/sis/backfill/grading/build-t3-grading-import.ts.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT3 } from '../../lib/sis/backfill/grading/grading-workbook-t3';
import type { ParsedT3Sheet } from '../../lib/sis/backfill/grading/grading-workbook-t3';
import { buildT3GradingImport } from '../../lib/sis/backfill/grading/build-t3-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const ROOT = 'AY2026/T3/Term 3 Grades';
const OUT_DIR = 'scripts/backfill';

// Explicit file list — never a directory glob (T1/T2 had corrupted "Copy of"
// duplicates sitting beside the real files).
const FILES: { dir: string; file: string; subjectCode: string }[] = [
  // Cambridge/ — Global class (S1 Discipline 1, S2 Integrity 1)
  {
    dir: 'Cambridge',
    file: 'Art and Design Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'ARTD',
  },
  {
    dir: 'Cambridge',
    file: 'Computing Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'COMP',
  },
  {
    dir: 'Cambridge',
    file: 'English Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'ENG',
  },
  {
    dir: 'Cambridge',
    file: 'Global Perspectives Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'GP',
  },
  {
    dir: 'Cambridge',
    file: 'Humanities Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'HUM',
  },
  {
    dir: 'Cambridge',
    file: 'Mathematics Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'MATH',
  },
  // Global-track "PE & Health" is PEH; Regular-track "Physical Education" is
  // PESTD (b634603c — HFSE's Consolidated Form carries them as two columns).
  {
    dir: 'Cambridge',
    file: 'P.E. and Health Grading AY2026 T3.xlsx',
    subjectCode: 'PEH',
  },
  {
    dir: 'Cambridge',
    file: 'Science Grading Sheet Global Class AY2026 T3.xlsx',
    subjectCode: 'SCI',
  },
  // Grades/ — Primary + Regular-track Secondary
  {
    dir: 'Grades',
    file: 'Contemporary Arts Grading AY2026 T3.xlsx',
    subjectCode: 'CA',
  },
  { dir: 'Grades', file: 'English Grading AY2026 T3.xlsx', subjectCode: 'ENG' },
  // Filipino's Secondary tabs ARE imported (T2 wrongly excluded them and
  // needed ay2026-t2-filipino-secondary-backfill).
  {
    dir: 'Grades',
    file: 'Filipino Grading AY2026 T3.xlsx',
    subjectCode: 'FIL',
  },
  {
    dir: 'Grades',
    file: 'History Grading AY2026 T3.xlsx',
    subjectCode: 'HIST',
  },
  {
    dir: 'Grades',
    file: 'Literature Grading AY2026 T3.xlsx',
    subjectCode: 'LIT',
  },
  {
    dir: 'Grades',
    file: 'Mandarin Grading AY2026 T3.xlsx',
    subjectCode: 'MANDARIN',
  },
  { dir: 'Grades', file: 'Math Grading AY2026 T3.xlsx', subjectCode: 'MATH' },
  { dir: 'Grades', file: 'P.E. Grading AY2026 T3.xlsx', subjectCode: 'PESTD' },
  { dir: 'Grades', file: 'SS & Geo Grading AY2026 T3.xlsx', subjectCode: 'SS' },
  // STAR replaced MAPEH in AY2026 (move-ay2026-mapeh-to-star.ts); the SIS T3
  // sheets are STAR sheets.
  { dir: 'Grades', file: 'STAR  Grading AY2026 T3.xlsx', subjectCode: 'STAR' },
  { dir: 'Grades', file: 'Science Grading AY2026 T3.xlsx', subjectCode: 'SCI' },
];

async function readAll<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const n = (v: unknown) => (v == null ? null : Number(v));
const nums = (a: unknown) =>
  ((a as unknown[] | null) ?? []).map((v) => (v == null ? null : Number(v)));

async function main() {
  // 1. Workbooks
  const sheets: ParsedT3Sheet[] = [];
  const skippedTabs: { file: string; sheetName: string; reason: string }[] = [];
  for (const f of FILES) {
    const r = parseGradingWorkbookT3(
      join(ROOT, f.dir, f.file).replace(/\\/g, '/'),
      f.subjectCode
    );
    sheets.push(...r.sheets);
    for (const s of r.skipped)
      skippedTabs.push({ file: `${f.dir}/${f.file}`, ...s });
    console.log(
      `${f.dir}/${f.file}: ${r.sheets.length} tab(s), ${r.skipped.length} skipped`
    );
  }

  // 2. Production snapshot — SELECTs only.
  const svc = createServiceClient();
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;
  const ayId = (ay as any).id as string;
  const { data: term, error: tErr } = await svc
    .from('terms')
    .select('id, start_date, end_date')
    .eq('academic_year_id', ayId)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (tErr) throw tErr;
  const termId = (term as any).id as string;

  const sections = await readAll<any>((a, b) =>
    svc
      .from('sections')
      .select('id, name, levels!inner(code)')
      .eq('academic_year_id', ayId)
      .order('id')
      .range(a, b)
  );
  const roster = await readAll<any>((a, b) =>
    svc
      .from('section_students')
      .select(
        'id, section_id, index_number, enrollment_status, enrollment_date, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(academic_year_id)'
      )
      .eq('sections.academic_year_id', ayId)
      .order('id')
      .range(a, b)
  );
  const configs = await readAll<any>((a, b) =>
    svc
      .from('subject_configs')
      .select(
        'ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, subjects!inner(code)'
      )
      .eq('academic_year_id', ayId)
      .order('id')
      .range(a, b)
  );
  const sisSheets = await readAll<any>((a, b) =>
    svc
      .from('grading_sheets')
      .select(
        'id, section_id, teacher_name, slot_labels, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight, is_locked, subjects!inner(code, is_examinable)'
      )
      .eq('term_id', termId)
      .order('id')
      .range(a, b)
  );
  const entries = await readAll<any>((a, b) =>
    svc
      .from('grade_entries')
      .select(
        'id, grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, is_na, letter_grade, ww_excused, pt_excused, quarterly_grade, grading_sheets!inner(term_id)'
      )
      .eq('grading_sheets.term_id', termId)
      .order('id')
      .range(a, b)
  );
  console.log(
    `production: ${sections.length} sections, ${roster.length} roster rows, ${configs.length} configs, ${sisSheets.length} T3 sheets, ${entries.length} T3 grade rows`
  );

  // 3. Compose
  const result = buildT3GradingImport({
    sheets,
    skippedTabs,
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      levelCode: s.levels.code,
    })),
    roster: roster.map((r) => ({
      sectionStudentId: r.id,
      sectionId: r.section_id,
      indexNumber: r.index_number,
      enrollmentStatus: r.enrollment_status,
      enrollmentDate: r.enrollment_date,
      withdrawalDate: r.withdrawal_date,
      studentNumber: r.students.student_number,
      lastName: r.students.last_name,
      firstName: r.students.first_name,
    })),
    configs: configs.map((c) => ({
      subjectCode: c.subjects.code,
      wwWeight: Number(c.ww_weight),
      ptWeight: Number(c.pt_weight),
      qaWeight: Number(c.qa_weight),
      wwMaxSlots: c.ww_max_slots,
      ptMaxSlots: c.pt_max_slots,
      qaMax: n(c.qa_max),
    })),
    sisSheets: sisSheets.map((s) => ({
      id: s.id,
      sectionId: s.section_id,
      subjectCode: s.subjects.code,
      isExaminable: s.subjects.is_examinable,
      wwTotals: nums(s.ww_totals) as number[],
      ptTotals: nums(s.pt_totals) as number[],
      qaTotal: n(s.qa_total),
      wwWeight: n(s.ww_weight),
      ptWeight: n(s.pt_weight),
      qaWeight: n(s.qa_weight),
      isLocked: s.is_locked,
      teacherName: s.teacher_name,
      slotLabelsSet:
        s.slot_labels != null && JSON.stringify(s.slot_labels) !== '{}',
    })),
    entries: entries.map((e) => ({
      id: e.id,
      sheetId: e.grading_sheet_id,
      sectionStudentId: e.section_student_id,
      wwScores: nums(e.ww_scores),
      ptScores: nums(e.pt_scores),
      qaScore: n(e.qa_score),
      isNa: e.is_na,
      letterGrade: e.letter_grade,
      wwExcused: e.ww_excused ?? [],
      ptExcused: e.pt_excused ?? [],
      quarterlyGrade: n(e.quarterly_grade),
    })),
    termStart: (term as any).start_date,
    termEnd: (term as any).end_date,
    generatedAt: new Date().toISOString().slice(0, 10),
  });

  // 4. Read-only parity probe: the database's own formula (the IMMUTABLE
  //    public.compute_quarterly the derive trigger calls, migration 179) run on
  //    every row the apply would write, with the totals and weights the apply
  //    would set. Nothing is written — an immutable function call only.
  const disagreements: string[] = [];
  const rowsToCheck = result.writtenRows;
  for (let i = 0; i < rowsToCheck.length; i += 25) {
    const batch = rowsToCheck.slice(i, i + 25);
    const outs = await Promise.all(
      batch.map((r) =>
        svc.rpc('compute_quarterly', {
          p_ww_scores: r.ww_scores,
          p_ww_totals: r.ww_totals,
          p_pt_scores: r.pt_scores,
          p_pt_totals: r.pt_totals,
          p_qa_score: r.qa_score,
          p_qa_total: r.qa_total,
          p_ww_weight: r.ww_weight,
          p_pt_weight: r.pt_weight,
          p_qa_weight: r.qa_weight,
          p_ww_excused: r.ww_excused,
          p_pt_excused: r.pt_excused,
        })
      )
    );
    outs.forEach((o, j) => {
      if (o.error) throw o.error;
      const row = Array.isArray(o.data) ? o.data[0] : o.data;
      const dbQ =
        row?.quarterly_grade == null ? null : Number(row.quarterly_grade);
      if (dbQ !== batch[j].expectedQuarterly)
        disagreements.push(
          `${batch[j].label}: dry run ${batch[j].expectedQuarterly}, database formula ${dbQ}`
        );
    });
  }
  const canon = await svc.rpc('compute_quarterly', {
    p_ww_scores: [10, 10],
    p_ww_totals: [10, 10],
    p_pt_scores: [6, 10, 10],
    p_pt_totals: [10, 10, 10],
    p_qa_score: 22,
    p_qa_total: 30,
    p_ww_weight: 0.4,
    p_pt_weight: 0.4,
    p_qa_weight: 0.2,
  });
  if (canon.error) throw canon.error;
  const canonQ = Number(
    (Array.isArray(canon.data) ? canon.data[0] : canon.data)?.quarterly_grade
  );
  const parity = [
    'DATABASE PARITY PROBE (read-only)',
    '---------------------------------',
    `  Production's public.compute_quarterly (the function the derive trigger runs) on the canonical`,
    `  case → ${canonQ} ${canonQ === 93 ? '(93 — Hard Rule #1 holds in the database too)' : '*** NOT 93 ***'}.`,
    `  Run on all ${rowsToCheck.length} rows the apply would write, with the totals and weights it would set:`,
    `  ${rowsToCheck.length - disagreements.length} agree with the dry run, ${disagreements.length} disagree.`,
    ...disagreements.map((d) => `    ${d}`),
    '',
  ].join('\n');
  const report = result.report.replace(
    'PER SUBJECT × SECTION\n',
    `${parity}\nPER SUBJECT × SECTION\n`
  );
  console.log(
    `parity: ${rowsToCheck.length - disagreements.length}/${rowsToCheck.length} agree; canonical ${canonQ}`
  );

  for (const f of result.files) writeFileSync(join(OUT_DIR, f.name), f.sql);
  writeFileSync(join(OUT_DIR, 'ay2026-t3-grading-report.txt'), report);
  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  for (const f of result.files) console.log(`Wrote ${OUT_DIR}/${f.name}`);
  console.log(`Wrote ${OUT_DIR}/ay2026-t3-grading-report.txt`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

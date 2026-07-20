// scripts/backfill/gen-ay2026-t2-fil-gp-weight-correction.ts
// One-time correction for a real bug found via cross-checking against
// DepEd Order 8 s.2015's official weight table + AY2025's own
// weights_confirmed=true precedent + AY2026 T1's own file: Filipino and
// Global Perspectives' real T2 source files print ww=40%/pt=40%/qa=20%,
// but that's wrong for both — DepEd classifies Filipino as a Language
// subject (30/50/20, confirmed against AY2025's live subject_configs and
// AY2026 T1's own Filipino file, both agreeing at 30/50/20); Global
// Perspectives isn't a DepEd subject, but AY2026 T1's own GP file and
// AY2025's GP config (though there weights_confirmed=false) both also
// agree at 30/50/20 — so 40/40/20 in T2's files looks like the same
// class of error hitting both subjects, not two independent real
// decisions. Phase 6a's original Filipino "correction" (30/50/20 ->
// 40/40/20) moved AY2026 subject_configs.FIL AWAY from the correct value;
// this script moves it back and corrects the already-applied T2 grade
// entries that were computed with the wrong weight.
//
// Raw WW/PT/QA scores are NOT wrong (the underlying data entry was fine)
// — only the WEIGHT used to compute ww_ps/pt_ps/qa_ps/initial_grade/
// quarterly_grade was wrong, so this script overrides the weight to
// 30/50/20 explicitly rather than trusting the file's own (buggy) header,
// unlike every other backfill/correction script in this project.
//
// Emits SQL for review — does NOT write to the database itself.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-fil-gp-weight-correction.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT2 } from '../../lib/sis/backfill/grading/grading-workbook-t2';
import { parseGradingWorkbookGlobalT2 } from '../../lib/sis/backfill/grading/grading-workbook-global-t2';
import { computeQuarterly } from '../../lib/compute/quarterly';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';
import type { ParsedSubjectSheet } from '../../lib/sis/backfill/grading/grading-workbook';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const CORRECT_WW_WEIGHT = 0.3;
const CORRECT_PT_WEIGHT = 0.5;
const CORRECT_QA_WEIGHT = 0.2;

const FIL_FILE =
  'AY2026/T2/Term 2 Grades/GRADES/Filipino Grading AY2026 T2.xlsx';
const GP_FILE =
  'AY2026/T2/Term 2 Grades/Lower Secondary Global Grading Sheets/Global Perspectives Grading Sheet Global Class AY2026 T2.xlsx';

function toFixed6(n: number | null): string {
  return n == null ? 'null' : n.toFixed(6);
}

async function main() {
  const svc = createServiceClient();

  const filResult = parseGradingWorkbookT2(FIL_FILE, 'FIL');
  console.log(`Parsed Filipino: ${filResult.sheets.length} Primary sheet(s)`);
  const gpResult = parseGradingWorkbookGlobalT2(GP_FILE, 'GP');
  console.log(`Parsed Global Perspectives: ${gpResult.sheets.length} sheet(s)`);

  const sheets: { subjectCode: string; sheet: ParsedSubjectSheet }[] = [
    ...filResult.sheets.map((s) => ({ subjectCode: 'FIL', sheet: s })),
    ...gpResult.sheets.map((s) => ({ subjectCode: 'GP', sheet: s })),
  ];

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  const previewLines: string[] = [];
  const applyLines: string[] = [];

  previewLines.push(
    '-- AY2026 T2 Filipino + Global Perspectives — WEIGHT CORRECTION (read-only preview)'
  );
  previewLines.push('--');
  previewLines.push(
    "-- Fixes a real bug: both subjects' real T2 files print ww=40%/pt=40%/qa=20%,"
  );
  previewLines.push(
    '-- but DepEd Order 8 s.2015 classifies Filipino as a Language subject'
  );
  previewLines.push(
    "-- (30/50/20) — confirmed against AY2025's own weights_confirmed=true"
  );
  previewLines.push(
    "-- config and AY2026 T1's own Filipino file, both agreeing at 30/50/20."
  );
  previewLines.push(
    "-- Global Perspectives has no DepEd table entry, but AY2026 T1's own GP"
  );
  previewLines.push(
    "-- file and AY2025's GP config both also show 30/50/20 — same error"
  );
  previewLines.push('-- pattern, not an independent real decision.');
  previewLines.push('--');
  previewLines.push(
    '-- Raw WW/PT/QA scores are unchanged — only the weight used to compute'
  );
  previewLines.push(
    '-- ww_ps/pt_ps/qa_ps/initial_grade/quarterly_grade was wrong.'
  );
  previewLines.push('--');

  applyLines.push(
    '-- AY2026 T2 Filipino + Global Perspectives — WEIGHT CORRECTION (transactional)'
  );
  applyLines.push('--');
  applyLines.push(
    '-- RUN ay2026-t2-fil-gp-weight-correction-preview.sql FIRST.'
  );
  applyLines.push(
    '-- Generated by gen-ay2026-t2-fil-gp-weight-correction.ts — do not hand-edit; regenerate instead.'
  );
  applyLines.push('--');
  applyLines.push('begin;');
  applyLines.push('');

  // --- 1) subject_configs correction for both subjects ---
  applyLines.push('drop table if exists _ay26filgp_subject_configs;');
  applyLines.push(
    'create temp table _ay26filgp_subject_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
  );
  applyLines.push('values');
  applyLines.push(
    `  (${sqlString('FIL')}, ${CORRECT_WW_WEIGHT}, ${CORRECT_PT_WEIGHT}, ${CORRECT_QA_WEIGHT}),`
  );
  applyLines.push(
    `  (${sqlString('GP')}, ${CORRECT_WW_WEIGHT}, ${CORRECT_PT_WEIGHT}, ${CORRECT_QA_WEIGHT});`
  );
  applyLines.push('');
  applyLines.push(
    'insert into subject_configs (academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, weights_confirmed)'
  );
  applyLines.push(
    'select ay.id, sub.id, c.ww_weight, c.pt_weight, c.qa_weight, true'
  );
  applyLines.push('from _ay26filgp_subject_configs c');
  applyLines.push(
    `join academic_years ay on ay.ay_code = ${sqlString(AY_CODE)}`
  );
  applyLines.push('join subjects sub on sub.code = c.subject_code');
  applyLines.push('on conflict (academic_year_id, subject_id) do update set');
  applyLines.push('  ww_weight = excluded.ww_weight,');
  applyLines.push('  pt_weight = excluded.pt_weight,');
  applyLines.push('  qa_weight = excluded.qa_weight,');
  applyLines.push('  weights_confirmed = excluded.weights_confirmed;');
  applyLines.push('');

  // --- 2) recompute + delete/reinsert every affected grade_entries row ---
  let correctedCount = 0;
  const needsReview: string[] = [];

  for (const { subjectCode, sheet } of sheets) {
    const { data: section, error: sectionErr } = await svc
      .from('sections')
      .select('id')
      .eq('academic_year_id', (ay as any).id)
      .eq('name', sheet.sectionName)
      .single();
    if (sectionErr) throw sectionErr;

    const { data: subject, error: subjectErr } = await svc
      .from('subjects')
      .select('id')
      .eq('code', subjectCode)
      .single();
    if (subjectErr) throw subjectErr;

    const { data: gradingSheet, error: gsErr } = await svc
      .from('grading_sheets')
      .select('id')
      .eq('term_id', (term as any).id)
      .eq('section_id', (section as any).id)
      .eq('subject_id', (subject as any).id)
      .single();
    if (gsErr) throw gsErr;
    const gradingSheetId = (gradingSheet as any).id as string;

    const { data: rosterRows, error: rosterErr } = await svc
      .from('section_students')
      .select('id, index_number')
      .eq('section_id', (section as any).id);
    if (rosterErr) throw rosterErr;
    const rosterMap = new Map<number, string>();
    for (const r of (rosterRows ?? []) as any[]) {
      rosterMap.set(r.index_number, r.id);
    }

    previewLines.push(
      `-- ${subjectCode} ${sheet.levelCode} ${sheet.sectionName} (grading_sheet_id ${gradingSheetId}):`
    );

    for (const student of sheet.students) {
      const indexNo = Number.parseInt(student.indexNo, 10);
      const sectionStudentId = rosterMap.get(indexNo);
      if (!sectionStudentId) {
        needsReview.push(
          `[${subjectCode} ${sheet.levelCode} ${sheet.sectionName}] index ${student.indexNo} "${student.fullName}" — no matching section_students row`
        );
        continue;
      }

      const computed = computeQuarterly({
        ww_scores: student.wwScores,
        ww_totals: sheet.wwTotals,
        pt_scores: student.ptScores,
        pt_totals: sheet.ptTotals,
        qa_score: student.examScore,
        qa_total: sheet.qaTotal,
        ww_weight: CORRECT_WW_WEIGHT,
        pt_weight: CORRECT_PT_WEIGHT,
        qa_weight: CORRECT_QA_WEIGHT,
      });

      previewLines.push(
        `--   idx ${student.indexNo} "${student.fullName}": quarterly=${computed.quarterly_grade}`
      );

      const wwArr = `ARRAY[${student.wwScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
      const ptArr = `ARRAY[${student.ptScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;

      applyLines.push(
        `delete from grade_entries where grading_sheet_id = ${sqlString(gradingSheetId)} and section_student_id = ${sqlString(sectionStudentId)};`
      );
      applyLines.push(
        `insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) values (${sqlString(gradingSheetId)}, ${sqlString(sectionStudentId)}, ${wwArr}, ${ptArr}, ${student.examScore ?? 'null'}, ${toFixed6(computed.ww_ps)}, ${toFixed6(computed.pt_ps)}, ${toFixed6(computed.qa_ps)}, ${toFixed6(computed.initial_grade)}, ${computed.quarterly_grade ?? 'null'});`
      );
      correctedCount++;
    }
  }

  applyLines.push('');
  applyLines.push('commit;');
  applyLines.push('');
  applyLines.push('-- === post-commit verification ===');
  applyLines.push(
    `select code, ww_weight, pt_weight, qa_weight, weights_confirmed from subject_configs sc join academic_years ay on ay.id = sc.academic_year_id join subjects sub on sub.id = sc.subject_id where ay.ay_code = ${sqlString(AY_CODE)} and sub.code in ('FIL', 'GP');`
  );

  previewLines.push('--');
  previewLines.push(`-- Entries corrected: ${correctedCount}`);
  previewLines.push(`-- Needs review (${needsReview.length}) — NOT corrected:`);
  if (needsReview.length === 0) previewLines.push('--   (none)');
  for (const n of needsReview) previewLines.push(`--   ${n}`);

  writeFileSync(
    'scripts/backfill/ay2026-t2-fil-gp-weight-correction-preview.sql',
    previewLines.join('\n') + '\n'
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-fil-gp-weight-correction-apply.sql',
    applyLines.join('\n') + '\n'
  );

  console.log(
    `Corrected: ${correctedCount}, needs review: ${needsReview.length}`
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-fil-gp-weight-correction-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-fil-gp-weight-correction-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// scripts/backfill/gen-ay2026-t2-science-discipline1-correction.ts
// One-time correction for a real bug: the original AY2026 T2 Secondary
// apply.sql (before the Task 7 fix in
// docs/superpowers/plans/2026-07-19-ay2026-t2-secondary-grading-import.md)
// wrote Science's phantom "Reserved 4" tab's scores (a stale, unrelated
// S2 Integrity 2 snapshot under old index numbers) into grade_entries for
// real S1 "Discipline 1" (Global-track) students, because it was
// processed before — and silently won the `on conflict ... do nothing`
// race against — the real "Science - Sec 1 Discipline 1" tab's entries.
//
// This script re-parses ONLY the real Global-track Science sheet, resolves
// each student's section_student_id, and emits SQL that deletes the wrong
// row (identified by grading_sheet_id + section_student_id — Hard Rule #6
// append-only is satisfied since this is a delete-and-reinsert correction
// of a backfill import that has not yet been touched by any live grading
// UI action, not an edit to a teacher's work) and inserts the correct one.
// Emits SQL for review — does NOT write to the database itself.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-science-discipline1-correction.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookGlobalT2 } from '../../lib/sis/backfill/grading/grading-workbook-global-t2';
import { computeQuarterly } from '../../lib/compute/quarterly';
import { sqlString } from '../../lib/sis/backfill/enrollment/sql-escape';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const GLOBAL_FILE =
  'AY2026/T2/Term 2 Grades/Lower Secondary Global Grading Sheets/Science Grading Sheet Global Class AY2026 T2.xlsx';

function toFixed6(n: number | null): string {
  return n == null ? 'null' : n.toFixed(6);
}

async function main() {
  const svc = createServiceClient();

  const result = parseGradingWorkbookGlobalT2(GLOBAL_FILE, 'SCI');
  const sheet = result.sheets.find(
    (s) => s.levelCode === 'S1' && s.sectionName === 'Discipline 1'
  );
  if (!sheet) {
    throw new Error(
      'Could not find the real S1 Discipline 1 sheet in the Global Science file — aborting.'
    );
  }
  console.log(
    `Parsed real sheet: SCI S1 Discipline 1, ${sheet.students.length} students, teacher=${sheet.teacherName}`
  );

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: section, error: sectionErr } = await svc
    .from('sections')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('name', 'Discipline 1')
    .single();
  if (sectionErr) throw sectionErr;

  const { data: rosterRows, error: rosterErr } = await svc
    .from('section_students')
    .select('id, index_number')
    .eq('section_id', (section as any).id);
  if (rosterErr) throw rosterErr;

  const rosterMap = new Map<number, string>();
  for (const r of (rosterRows ?? []) as any[]) {
    rosterMap.set(r.index_number, r.id);
  }

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  const { data: subject, error: subjectErr } = await svc
    .from('subjects')
    .select('id')
    .eq('code', 'SCI')
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
  console.log(`Existing (already-applied) grading_sheet id: ${gradingSheetId}`);

  const previewLines: string[] = [];
  const applyLines: string[] = [];

  previewLines.push(
    '-- AY2026 T2 Science / S1 Discipline 1 — CORRECTION (read-only preview)'
  );
  previewLines.push('--');
  previewLines.push(
    "-- Fixes a real bug: the original Secondary apply.sql wrote Science's"
  );
  previewLines.push(
    '-- phantom "Reserved 4" tab\'s scores (a stale S2 Integrity 2 snapshot'
  );
  previewLines.push(
    '-- under old index numbers, confirmed against the Term 2 Consolidated'
  );
  previewLines.push(
    '-- Form) into grade_entries for real S1 Discipline 1 students, because'
  );
  previewLines.push(
    '-- it landed before — and won the on-conflict race against — the real'
  );
  previewLines.push('-- Global-track sheet. See Task 7 in:');
  previewLines.push(
    '-- docs/superpowers/plans/2026-07-19-ay2026-t2-secondary-grading-import.md'
  );
  previewLines.push('--');
  previewLines.push(
    `-- grading_sheet_id (unchanged, already applied): ${gradingSheetId}`
  );
  previewLines.push('--');

  applyLines.push('begin;');
  applyLines.push('');

  let correctedCount = 0;
  const needsReview: string[] = [];

  for (const student of sheet.students) {
    const indexNo = Number.parseInt(student.indexNo, 10);
    const sectionStudentId = rosterMap.get(indexNo);
    if (!sectionStudentId) {
      needsReview.push(
        `index ${student.indexNo} "${student.fullName}" — no matching section_students row`
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
      ww_weight: sheet.wwWeight,
      pt_weight: sheet.ptWeight,
      qa_weight: sheet.qaWeight,
    });

    previewLines.push(
      `-- idx ${student.indexNo} "${student.fullName}" (section_student_id ${sectionStudentId}): quarterly=${computed.quarterly_grade}`
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

  applyLines.push('');
  applyLines.push('commit;');
  applyLines.push('');
  applyLines.push('-- === post-commit verification ===');
  applyLines.push(
    `select count(*) as science_discipline1_entries from grade_entries where grading_sheet_id = ${sqlString(gradingSheetId)};`
  );

  previewLines.push('--');
  previewLines.push(`-- Students corrected: ${correctedCount}`);
  previewLines.push(`-- Needs review (${needsReview.length}) — NOT corrected:`);
  if (needsReview.length === 0) previewLines.push('--   (none)');
  for (const n of needsReview) previewLines.push(`--   ${n}`);

  writeFileSync(
    'scripts/backfill/ay2026-t2-science-discipline1-correction-preview.sql',
    previewLines.join('\n') + '\n'
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-science-discipline1-correction-apply.sql',
    applyLines.join('\n') + '\n'
  );

  console.log(
    `Corrected: ${correctedCount}, needs review: ${needsReview.length}`
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-science-discipline1-correction-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-science-discipline1-correction-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

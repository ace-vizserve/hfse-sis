// lib/sis/backfill/grading/build-grading-import.ts
// Composes parsed grading-sheet data (grading-workbook.ts) into the two SQL
// files described by the design doc: a read-only preview report and a
// transactional, idempotent apply script. No I/O — takes already-parsed
// sheets and an already-fetched roster lookup.
import { computeQuarterly } from '@/lib/compute/quarterly';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface RosterLookupEntry {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  sectionStudentId: string;
}

export interface BuildGradingImportInput {
  sheets: ParsedSubjectSheet[];
  rosterLookup: RosterLookupEntry[];
  ayCode: string;
  termNumber: number;
}

interface ResolvedEntry {
  sectionStudentId: string;
  subjectCode: string;
  levelCode: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  computed: ReturnType<typeof computeQuarterly>;
}

interface NeedsReviewRow {
  subjectCode: string;
  levelCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

interface MismatchRow {
  subjectCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  kind: 'quarterly' | 'initial';
  printed: number;
  computed: number;
}

export interface BuildGradingImportResult {
  preview: string;
  apply: string;
  stats: {
    subjectConfigsWritten: number;
    gradingSheetsWritten: number;
    gradeEntriesWritten: number;
    needsReview: number;
    quarterlyMismatches: number;
  };
}

function toFixed6(n: number | null): string {
  return n == null ? 'null' : n.toFixed(6);
}

export function buildGradingImport(
  input: BuildGradingImportInput
): BuildGradingImportResult {
  const { sheets, rosterLookup, ayCode, termNumber } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.sectionName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const resolved: ResolvedEntry[] = [];
  const needsReview: NeedsReviewRow[] = [];
  const mismatches: MismatchRow[] = [];

  for (const sheet of sheets) {
    for (const student of sheet.students) {
      const key = `${sheet.levelCode}::${sheet.sectionName}::${Number.parseInt(student.indexNo, 10)}`;
      const sectionStudentId = rosterMap.get(key);
      if (!sectionStudentId) {
        needsReview.push({
          subjectCode: sheet.subjectCode,
          levelCode: sheet.levelCode,
          sectionName: sheet.sectionName,
          indexNo: student.indexNo,
          fullName: student.fullName,
          reason: `no matching section_students row for index ${student.indexNo}`,
        });
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

      checkMismatch(sheet, student, computed, mismatches);

      resolved.push({
        sectionStudentId,
        subjectCode: sheet.subjectCode,
        levelCode: sheet.levelCode,
        wwScores: student.wwScores,
        ptScores: student.ptScores,
        examScore: student.examScore,
        computed,
      });
    }
  }

  const configKey = (subjectCode: string, levelCode: string) =>
    `${subjectCode}::${levelCode}`;
  const configsByKey = new Map<string, ParsedSubjectSheet>();
  for (const sheet of sheets) {
    configsByKey.set(configKey(sheet.subjectCode, sheet.levelCode), sheet);
  }

  const stats: BuildGradingImportResult['stats'] = {
    subjectConfigsWritten: configsByKey.size,
    gradingSheetsWritten: sheets.length,
    gradeEntriesWritten: resolved.length,
    needsReview: needsReview.length,
    quarterlyMismatches: mismatches.length,
  };

  return {
    preview: buildPreviewSql(sheets, needsReview, mismatches, stats),
    apply: buildApplySql(ayCode, termNumber, sheets, resolved, configsByKey),
    stats,
  };
}

function checkMismatch(
  sheet: ParsedSubjectSheet,
  student: GradingStudentRow,
  computed: ReturnType<typeof computeQuarterly>,
  mismatches: MismatchRow[]
) {
  if (student.printedQuarterlyGrade != null) {
    if (computed.quarterly_grade !== student.printedQuarterlyGrade) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'quarterly',
        printed: student.printedQuarterlyGrade,
        computed: computed.quarterly_grade ?? NaN,
      });
    }
    return;
  }
  // No printed Quarterly column on this subject (e.g. Art & Design / PE &
  // Health) — fall back to cross-checking the Initial grade instead, so
  // these subjects still get real validation coverage.
  if (student.printedInitialGrade != null && computed.initial_grade != null) {
    if (Math.abs(computed.initial_grade - student.printedInitialGrade) > 0.01) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'initial',
        printed: student.printedInitialGrade,
        computed: computed.initial_grade,
      });
    }
  }
}

function buildPreviewSql(
  sheets: ParsedSubjectSheet[],
  needsReview: NeedsReviewRow[],
  mismatches: MismatchRow[],
  stats: BuildGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T1 grading sheets import — PREVIEW (read-only)');
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-grading.ts from the 8 "Global Class" T1 workbooks.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(
    "-- Per-subject weights & slots (read from each sheet's own header):"
  );
  for (const s of sheets) {
    lines.push(
      `--   ${s.subjectCode} ${s.levelCode} ${s.sectionName}: ww=${s.wwWeight} pt=${s.ptWeight} qa=${s.qaWeight} | wwTotals=[${s.wwTotals}] ptTotals=[${s.ptTotals}] qaTotal=${s.qaTotal}`
    );
  }
  lines.push('--');
  lines.push(
    `-- subjectConfigs=${stats.subjectConfigsWritten} gradingSheets=${stats.gradingSheetsWritten} gradeEntries=${stats.gradeEntriesWritten}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.subjectCode} ${r.levelCode} ${r.sectionName}] index ${r.indexNo} "${r.fullName}" — ${r.reason}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Quarterly/Initial grade mismatches (${mismatches.length}) — raw scores ARE still written, this is informational:`
  );
  if (mismatches.length === 0) lines.push('--   (none)');
  for (const m of mismatches) {
    lines.push(
      `--   [${m.subjectCode} ${m.sectionName}] index ${m.indexNo} "${m.fullName}" — ${m.kind}: printed=${m.printed} computed=${m.computed}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  ayCode: string,
  termNumber: number,
  sheets: ParsedSubjectSheet[],
  resolved: ResolvedEntry[],
  configsByKey: Map<string, ParsedSubjectSheet>
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T1 grading sheets import — APPLY (transactional)');
  lines.push('--');
  lines.push('-- RUN ay2026-t1-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t1-grading.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  // --- 1) subject_configs ---
  lines.push('drop table if exists _ay26grd_subject_configs;');
  lines.push(
    'create temp table _ay26grd_subject_configs (subject_code, level_code, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max) as'
  );
  lines.push('values');
  const configRows = [...configsByKey.values()].map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${s.wwWeight}, ${s.ptWeight}, ${s.qaWeight}, ${s.wwTotals.length}, ${s.ptTotals.length}, ${sqlStringOrNull(s.qaTotal == null ? null : String(s.qaTotal))})`
  );
  lines.push(configRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into subject_configs (academic_year_id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max)'
  );
  lines.push(
    'select ay.id, sub.id, lvl.id, c.ww_weight, c.pt_weight, c.qa_weight, c.ww_max_slots, c.pt_max_slots, c.qa_max'
  );
  lines.push('from _ay26grd_subject_configs c');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push('join subjects sub on sub.code = c.subject_code');
  lines.push('join levels lvl on lvl.code = c.level_code');
  lines.push(
    'on conflict (academic_year_id, subject_id, level_id) do update set'
  );
  lines.push('  ww_weight = excluded.ww_weight,');
  lines.push('  pt_weight = excluded.pt_weight,');
  lines.push('  qa_weight = excluded.qa_weight,');
  lines.push('  ww_max_slots = excluded.ww_max_slots,');
  lines.push('  pt_max_slots = excluded.pt_max_slots,');
  lines.push('  qa_max = excluded.qa_max;');
  lines.push('');

  // --- 2) grading_sheets ---
  lines.push('drop table if exists _ay26grd_sheets;');
  lines.push(
    'create temp table _ay26grd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
  );
  lines.push('values');
  const sheetRows = sheets.map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${sqlString(s.sectionName)}, ${sqlStringOrNull(s.teacherName)}, ARRAY[${s.wwTotals.join(',')}]::numeric[], ARRAY[${s.ptTotals.join(',')}]::numeric[], ${s.qaTotal ?? 'null'})`
  );
  lines.push(sheetRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, teacher_name, ww_totals, pt_totals, qa_total, is_locked, locked_at, locked_by)'
  );
  lines.push(
    "select t.id, sec.id, sub.id, sc.id, s.teacher_name, s.ww_totals, s.pt_totals, s.qa_total, true, now(), 'backfill-import'"
  );
  lines.push('from _ay26grd_sheets s');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = s.subject_code');
  lines.push('join levels lvl on lvl.code = s.level_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.name = s.section_name'
  );
  lines.push(
    'join subject_configs sc on sc.academic_year_id = ay.id and sc.subject_id = sub.id and sc.level_id = lvl.id'
  );
  lines.push('on conflict (term_id, section_id, subject_id) do nothing;');
  lines.push('');

  // --- 3) grade_entries ---
  lines.push('drop table if exists _ay26grd_entries;');
  lines.push(
    'create temp table _ay26grd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
  );
  lines.push('values');
  const entryRows = resolved.map((e) => {
    const wwArr = `ARRAY[${e.wwScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    const ptArr = `ARRAY[${e.ptScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    return `  (${sqlString(e.sectionStudentId)}, ${sqlString(e.subjectCode)}, ${wwArr}, ${ptArr}, ${e.examScore ?? 'null'}, ${toFixed6(e.computed.ww_ps)}, ${toFixed6(e.computed.pt_ps)}, ${toFixed6(e.computed.qa_ps)}, ${toFixed6(e.computed.initial_grade)}, ${e.computed.quarterly_grade ?? 'null'})`;
  });
  lines.push(
    (entryRows.length
      ? entryRows.join(',\n')
      : "  ('00000000-0000-0000-0000-000000000000', '__NONE__', ARRAY[]::numeric[], ARRAY[]::numeric[], null, null, null, null, null, null)") +
      ';'
  );
  lines.push('');
  lines.push(
    'insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade)'
  );
  lines.push(
    'select gs.id, e.section_student_id::uuid, e.ww_scores, e.pt_scores, e.qa_score, e.ww_ps, e.pt_ps, e.qa_ps, e.initial_grade, e.quarterly_grade'
  );
  lines.push('from _ay26grd_entries e');
  lines.push('join section_students ss on ss.id = e.section_student_id::uuid');
  lines.push('join sections sec on sec.id = ss.section_id');
  lines.push(
    `join academic_years ay on ay.id = sec.academic_year_id and ay.ay_code = ${sqlString(ayCode)}`
  );
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = e.subject_code');
  lines.push(
    'join grading_sheets gs on gs.term_id = t.id and gs.section_id = sec.id and gs.subject_id = sub.id'
  );
  lines.push("where e.subject_code <> '__NONE__'");
  lines.push('on conflict (grading_sheet_id, section_student_id) do nothing;');
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select count(*) as subject_configs_rows from subject_configs sc join academic_years ay on ay.id=sc.academic_year_id where ay.ay_code=${sqlString(ayCode)};`
  );
  lines.push(
    `select count(*) as grading_sheets_rows from grading_sheets gs join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select count(*) as grade_entries_rows from grade_entries ge join grading_sheets gs on gs.id=ge.grading_sheet_id join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  return lines.join('\n') + '\n';
}

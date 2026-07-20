// lib/sis/backfill/grading/grading-workbook-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks (Primary + a
// Secondary Regular-track tab riding along in the same file) into one
// ParsedSubjectSheet per real PRIMARY section tab. Secondary tabs are
// recognized and skipped — grading-workbook-secondary-t2.ts (Phase 6b)
// processes them.
//
// Masthead-parsing internals (column layout, the fixed printed-grade
// finder, tab-name-first identity resolution) live in the shared
// ./t2-masthead module — extracted from this file per Phase 6a's own
// final review recommendation, once a third T2 parser needed the same
// logic. This refactor changes no behavior: this file's own test suite
// (__tests__/sis/backfill/grading/grading-workbook-t2.test.ts) passes
// completely unchanged.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';
import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  numOrNull,
  findColumnLayout,
  weightAt,
  findPrintedGradeColsT2,
  resolveIdentity,
  parseTeacherName,
  dedupeByIdentityPreferringScored,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookT2Result {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  skippedExcludedSection: string[];
  identityCorrections: string[];
  truncationNotes: string[];
  duplicateIdentityNotes: string[];
}

// These three Primary sections are hidden tabs in HFSE's own Term 2
// Consolidated Form — confirmed directly against the live file, not
// inferred — meaning HFSE itself doesn't currently treat them as active,
// current-year sections. Real teacher-entered grades were nonetheless
// found under their names via "Reserved N" tab row-2 labels in these
// per-subject GRADES workbooks — most likely leftover data from a
// discontinued/renamed section, but the school's own choice to hide them
// from the consolidated summary is treated as authoritative here: their
// data is excluded from the import entirely, matching the same scope the
// Consolidated Form itself uses. User decision, 2026-07-20.
const EXCLUDED_PRIMARY_SECTIONS = new Set([
  'Respect',
  'Gentleness',
  'Compassion',
]);

function parseOneSheetT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const { identity, correctionNote, truncationNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'primary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  // numOrNull (not a bare !== '' check) — a real T2 Primary sheet uses "-"
  // for an unused slot's max score (e.g. Science/P4 Compassion's 5th PT
  // slot). Number("-") is NaN, and an un-filtered NaN serializes into the
  // generated SQL as the literal unquoted text NaN, which Postgres rejects
  // as an unrecognized identifier ("column nan does not exist"), aborting
  // the whole apply.sql transaction.
  const realWwCols = layout.wwCols.filter(
    (c) => numOrNull(cell(maxRow, c)) !== null
  );
  const realPtCols = layout.ptCols.filter(
    (c) => numOrNull(cell(maxRow, c)) !== null
  );
  const wwTotals = realWwCols.map((c) => Number(cell(maxRow, c)));
  const ptTotals = realPtCols.map((c) => Number(cell(maxRow, c)));
  const qaTotalRaw = cell(maxRow, layout.examCol);
  const qaTotal = qaTotalRaw === '' ? null : Number(qaTotalRaw);

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

    students.push({
      indexNo,
      fullName,
      wwScores: realWwCols.map((c) => numOrNull(cell(row, c))),
      ptScores: realPtCols.map((c) => numOrNull(cell(row, c))),
      examScore: numOrNull(cell(row, layout.examCol)),
      printedInitialGrade:
        initialCol == null ? null : numOrNull(cell(row, initialCol)),
      printedQuarterlyGrade:
        quarterlyCol == null ? null : numOrNull(cell(row, quarterlyCol)),
    });
  }

  return {
    sheet: {
      subjectCode,
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      teacherName,
      wwWeight,
      ptWeight,
      qaWeight,
      wwTotals,
      ptTotals,
      qaTotal,
      students,
    },
    identity,
    correctionNote,
    truncationNote,
  };
}

export function parseGradingWorkbookT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT2Result {
  const wb = XLSX.readFile(filePath);
  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const skippedExcludedSection: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } = parseOneSheetT2(
      rows,
      subjectCode,
      sheetName
    );
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (
      identity.kind === 'primary' &&
      sheet &&
      EXCLUDED_PRIMARY_SECTIONS.has(identity.sectionName)
    ) {
      skippedExcludedSection.push(sheetName);
    } else if (identity.kind === 'primary' && sheet) {
      candidates.push({ sheetName, sheet });
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  const { kept, duplicateNotes } = dedupeByIdentityPreferringScored(candidates);

  return {
    sheets: kept,
    skippedSecondary,
    skippedUnrecognized,
    skippedExcludedSection,
    identityCorrections,
    truncationNotes,
    duplicateIdentityNotes: duplicateNotes,
  };
}

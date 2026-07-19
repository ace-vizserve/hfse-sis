// lib/sis/backfill/grading/grading-workbook-secondary-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks into one
// ParsedSubjectSheet per real SECONDARY (Regular-track) section tab —
// the mirror image of grading-workbook-t2.ts (Phase 6a), which processes
// the Primary tabs in these same files. Both consume the shared
// ./t2-masthead module.
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
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookSecondaryT2Result {
  sheets: ParsedSubjectSheet[];
  skippedPrimary: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetSecondaryT2(
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
  if (identity.kind !== 'secondary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  const realWwCols = layout.wwCols.filter((c) => cell(maxRow, c) !== '');
  const realPtCols = layout.ptCols.filter((c) => cell(maxRow, c) !== '');
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

export function parseGradingWorkbookSecondaryT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookSecondaryT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedPrimary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetSecondaryT2(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'primary') {
      skippedPrimary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets,
    skippedPrimary,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}

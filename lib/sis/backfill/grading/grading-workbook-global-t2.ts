// lib/sis/backfill/grading/grading-workbook-global-t2.ts
// Parses HFSE's real T2 "Lower Secondary Global Grading Sheets" workbooks
// (Global-track Secondary — Discipline 1, Integrity 1 only; every tab in
// these files is already Secondary, no Primary tabs mixed in) into one
// ParsedSubjectSheet per real section tab. Reuses Phase 3's exact
// "DO NOT USE" tab exclusion and the shared ./t2-masthead module (the same
// printed-grade-column fix and tab-name-first identity resolution every
// other T2 parser uses — these T2 Global-track files carry the identical
// spurious second Quarterly/Term-1 column pair Phase 6a found elsewhere).
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

export interface ParseGradingWorkbookGlobalT2Result {
  sheets: ParsedSubjectSheet[];
  sheetNames: string[];
  skippedDoNotUse: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetGlobalT2(
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

export function parseGradingWorkbookGlobalT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookGlobalT2Result {
  const wb = XLSX.readFile(filePath);
  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  const skippedDoNotUse: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith('DO NOT USE')) {
      skippedDoNotUse.push(sheetName);
      continue;
    }
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetGlobalT2(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      candidates.push({ sheetName, sheet });
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets: candidates.map((c) => c.sheet),
    sheetNames: candidates.map((c) => c.sheetName),
    skippedDoNotUse,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}

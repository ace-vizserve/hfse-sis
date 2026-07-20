// lib/sis/backfill/grading/grading-workbook-t1-secondary.ts
// Parses HFSE's real T1 "GRADES" folder (AY2026/T1/Term 1 Grades/Grades/)
// subject workbooks into one ParsedSubjectSheet per real SECONDARY
// (Regular-track) section tab — the counterpart to
// grading-workbook-t1-primary.ts, which processes the Primary tabs in
// these same files.
//
// Near-verbatim mirror of grading-workbook-secondary-t2.ts, PLUS one
// addition: T1's Secondary tabs carry "DO NOT USE" duplicate tabs that
// T2's never had (confirmed via design-time inspection of all 9 relevant
// files — every file with an S4 Excellence tab has exactly one DO-NOT-USE
// duplicate resolving to the identical identity). Reusing
// grading-workbook-secondary-t2.ts unmodified would let both the
// DO-NOT-USE tab and the real tab reach the composer as separate rows
// sharing one (term_id, section_id, subject_id) key — an order-dependent
// silent-corruption risk. The fix mirrors grading-workbook-global-t2.ts's
// exact DO-NOT-USE filter: skip immediately, before identity resolution
// ever runs.
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

export interface ParseGradingWorkbookT1SecondaryResult {
  sheets: ParsedSubjectSheet[];
  sheetNames: string[];
  skippedPrimary: string[];
  skippedDoNotUse: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetT1Secondary(
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

  // numOrNull (not a bare !== '' check) — a real sheet can use "-" for an
  // unused slot's max score. See grading-workbook-t2.ts's identical fix.
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

export function parseGradingWorkbookT1Secondary(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT1SecondaryResult {
  const wb = XLSX.readFile(filePath);
  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  const skippedPrimary: string[] = [];
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
      parseOneSheetT1Secondary(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      candidates.push({ sheetName, sheet });
    } else if (identity.kind === 'primary') {
      skippedPrimary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets: candidates.map((c) => c.sheet),
    sheetNames: candidates.map((c) => c.sheetName),
    skippedPrimary,
    skippedDoNotUse,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}

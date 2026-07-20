// lib/sis/backfill/grading/grading-workbook-t1-primary.ts
// Parses HFSE's real T1 "GRADES" folder (AY2026/T1/Term 1 Grades/Grades/)
// subject workbooks into one ParsedSubjectSheet per real PRIMARY section
// tab. Secondary tabs riding along in the same files are recognized and
// skipped — a later, separate sub-phase covers T1 Secondary Regular-track.
//
// Near-verbatim mirror of grading-workbook-t2.ts (Phase 6a) — the masthead
// layout, EXCLUDED_PRIMARY_SECTIONS set, and identity-resolution logic
// were verified byte-identical to T2's Primary GRADES folder during
// design (docs/superpowers/specs/2026-07-20-ay2026-t1-primary-grading-import-design.md).
// Reuses ./t2-masthead unchanged — the row layout matched exactly, no new
// identity logic needed.
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

export interface ParseGradingWorkbookT1PrimaryResult {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  skippedExcludedSection: string[];
  identityCorrections: string[];
  truncationNotes: string[];
  duplicateIdentityNotes: string[];
}

// Same 3 sections excluded from T2's Primary import, for the same reason —
// hidden in HFSE's own Consolidated Form, confirmed present in T1's files
// as the same never-renamed "Reserved N" tabs (2026-07-20 decision,
// reused verbatim from grading-workbook-t2.ts).
const EXCLUDED_PRIMARY_SECTIONS = new Set([
  'Respect',
  'Gentleness',
  'Compassion',
]);

function parseOneSheetT1Primary(
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

  // numOrNull (not a bare !== '' check) — see grading-workbook-t2.ts's
  // identical fix for the real "-" max-score cell bug.
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

export function parseGradingWorkbookT1Primary(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT1PrimaryResult {
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
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetT1Primary(rows, subjectCode, sheetName);
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

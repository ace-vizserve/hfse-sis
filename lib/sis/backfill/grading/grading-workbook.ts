// lib/sis/backfill/grading/grading-workbook.ts
// Parses one HFSE T1 "Global Class" grading-sheet workbook into one
// ParsedSubjectSheet per real section tab. Column positions (which columns
// hold W1/W2/.../PT1/PT2/.../Exam/Initial/Quarterly) are resolved
// dynamically from each sheet's own header rows — no per-subject
// hardcoding, since real subjects vary in WW/PT slot count. Weights are
// read from row 8's own WS% cells (not the row 5 label text), which
// sidesteps a real corrupted label cell in the Humanities workbook.
import * as XLSX from 'xlsx';

export interface GradingStudentRow {
  indexNo: string;
  fullName: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  printedInitialGrade: number | null;
  printedQuarterlyGrade: number | null;
}

export interface ParsedSubjectSheet {
  subjectCode: string;
  levelCode: string;
  sectionName: string;
  teacherName: string | null;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  students: GradingStudentRow[];
}

const ROW_LEVEL_SECTION = 2;
const ROW_TEACHER = 3;
const ROW_LABELS = 5; // where "Initial"/"Quarterly" printed-grade labels live
const ROW_SUBCOLS = 7; // "W1","W2",...,"PT1",...,"Exam",...
const ROW_MAXSCORES = 8;
const ROW_STUDENTS_START = 9;

function cell(row: unknown[] | undefined, i: number): string {
  if (!row) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

function numOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

interface ColumnLayout {
  wwCols: number[];
  ptCols: number[];
  wwTotalCol: number;
  ptTotalCol: number;
  examCol: number;
}

function findColumnLayout(subcolRow: unknown[]): ColumnLayout {
  const wwCols: number[] = [];
  const ptCols: number[] = [];
  const totalCols: number[] = [];
  let examCol = -1;
  for (let i = 2; i < subcolRow.length; i++) {
    const label = cell(subcolRow as unknown[], i);
    if (/^W\d+$/i.test(label)) wwCols.push(i);
    else if (/^PT\d+$/i.test(label)) ptCols.push(i);
    else if (/^Total$/i.test(label)) totalCols.push(i);
    else if (/^Exam$/i.test(label)) examCol = i;
  }
  const [wwTotalCol, ptTotalCol] = totalCols;
  if (wwTotalCol == null || ptTotalCol == null || examCol === -1) {
    throw new Error(
      'grading-workbook: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

function weightAt(maxRow: unknown[], totalCol: number): number {
  // Layout is always <Total>, <PS>, <WS> — the weight is 2 columns after
  // the block's own Total column.
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `grading-workbook: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

function findPrintedGradeCols(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    const label = cell(labelRow, i);
    if (/Initial/i.test(label)) initialCol = i;
    else if (/Quarterly/i.test(label)) quarterlyCol = i;
  }
  return { initialCol, quarterlyCol };
}

function parseLevelSection(
  raw: string
): { levelCode: string; sectionName: string } | null {
  const m = /Secondary\s+(\d+)\s+([A-Za-z]+)\s+(\d+)/i.exec(raw);
  if (!m) return null;
  const [, levelNum, word, sectionNum] = m;
  const capitalized =
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return {
    levelCode: `S${levelNum}`,
    sectionName: `${capitalized} ${sectionNum}`,
  };
}

function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

function parseOneSheet(
  rows: unknown[][],
  subjectCode: string
): ParsedSubjectSheet {
  const identity = parseLevelSection(cell(rows[ROW_LEVEL_SECTION], 0));
  if (!identity) {
    throw new Error(
      `grading-workbook: could not parse level/section from row ${ROW_LEVEL_SECTION}: "${cell(rows[ROW_LEVEL_SECTION], 0)}"`
    );
  }
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

  const { initialCol, quarterlyCol } = findPrintedGradeCols(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue; // trailing template rows

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
  };
}

export function parseGradingWorkbook(
  filePath: string,
  subjectCode: string
): ParsedSubjectSheet[] {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith('DO NOT USE')) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    sheets.push(parseOneSheet(rows, subjectCode));
  }
  return sheets;
}

// lib/sis/backfill/grading/grading-workbook-t3.ts
// Parses one HFSE AY2026 Term 3 subject grading workbook into one
// ParsedT3Sheet per section tab. Used by
// scripts/backfill/gen-ay2026-t3-grading.ts (dry run + apply SQL).
//
// T3 layout. The T3 folder is split "Cambridge/" (the Global-track
// S1 Discipline 1 / S2 Integrity 1 files — T2's "Lower Secondary Global
// Grading Sheets/") and "Grades/" (the per-subject files holding BOTH the
// Primary tabs and the Regular-track Secondary tabs — T2's "GRADES/"). One
// parser serves both: the tab layout (rows 2/3 masthead, row 7 sub-labels,
// row 8 max scores, students from row 9) is the same T2 layout, so the
// masthead helpers in ./t2-masthead are reused unchanged.
//
// What is DIFFERENT from the T2 parsers, on purpose — each one a T2 lesson:
//
//   * Identity is NOT decided here. T2 let the tab name win and fell back to
//     row 2; that silently dropped CA "Integrity 2" (a truncated tab name AND
//     a mistyped row 2, KD notes in gen-ay2026-t2-ca-integrity2-correction.ts)
//     because nothing checked the resolved name against a real section. The
//     parser now returns BOTH candidate identities and the composer picks the
//     one whose roster the sheet's student names actually match.
//   * Printed values are read RAW (numbers, not formatted strings), so a
//     printed initial grade of 85.3333 is compared as 85.3333, not "85.33".
//   * Each row's printed WW/PT/QA percentages are kept, so a grade that
//     disagrees with the SIS can be traced to the component that disagrees.
//   * Whether the printed Quarterly cell is a FORMULA or a typed number is
//     recorded — a typed grade is a hand override the SIS cannot reproduce.
//   * The max-score row's printed Total is kept, so a hand-typed total that
//     is not the sum of the slot maxes is visible.
//   * Hidden and "DO NOT USE" tabs are skipped and named back.
import * as XLSX from 'xlsx';

import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  findColumnLayout,
  findPrintedGradeColsT2,
  parseTeacherName,
  titleCase,
} from './t2-masthead';

export interface T3Identity {
  levelCode: string;
  sectionName: string;
}

export interface ParsedT3Student {
  rowNumber: number; // 1-based Excel row
  indexNo: number;
  fullName: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  /** Non-numeric text found in a score cell (e.g. "ABS", "-"), by slot label. */
  nonNumericCells: string[];
  printedWwTotal: number | null;
  printedPtTotal: number | null;
  printedWwPs: number | null;
  printedPtPs: number | null;
  printedQaPs: number | null;
  printedInitial: number | null;
  printedQuarterly: number | null;
  quarterlyIsFormula: boolean | null;
}

export interface ParsedT3Sheet {
  file: string;
  sheetName: string;
  subjectCode: string;
  tabIdentity: T3Identity | null;
  row2Identity: T3Identity | null;
  row2Raw: string;
  teacherName: string | null;
  headerWeights: { ww: number | null; pt: number | null; qa: number | null };
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  printedWwTotalMax: number | null;
  printedPtTotalMax: number | null;
  students: ParsedT3Student[];
}

export interface ParseT3Result {
  sheets: ParsedT3Sheet[];
  skipped: { sheetName: string; reason: string }[];
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/%$/, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Header weights print as "40%" (formatted) — raw they are 0.4.
function pctToFraction(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = String(v).trim();
  const n = Number(s.replace('%', ''));
  if (!Number.isFinite(n)) return null;
  return s.includes('%') || n > 1 ? n / 100 : n;
}

// Row 2: "Primary N NAME - SUBJECT" / "Secondary N NAME - SUBJECT". Some T3
// row-2 labels have no " - SUBJECT" tail ("Secondary 1 Discipline 1"), so the
// tail is optional here (T2's regex required it).
const ROW2_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)(?:\s*-\s*.+)?$/i;
export function parseRow2(raw: string): T3Identity | null {
  const m = ROW2_RE.exec(raw.trim());
  if (!m) return null;
  const [, word, n, section] = m;
  return {
    levelCode: `${word.toLowerCase() === 'primary' ? 'P' : 'S'}${n}`,
    sectionName: titleCase(section.replace(/\s*-\s*$/, '')),
  };
}

// Tab: "<Subject> - P<N> <Name>" / "- S<N> <Name>" / "- Sec <N> <Name>".
// T3 has "History- S1 Discipline 2" (no space before the dash) too.
const TAB_RE = /^.+?\s*-\s*(Sec|P|S)\.?\s*(\d+)\s+(.+)$/i;
export function parseTab(sheetName: string): T3Identity | null {
  const m = TAB_RE.exec(sheetName.trim());
  if (!m) return null;
  const [, prefix, n, section] = m;
  return {
    levelCode: `${prefix.toLowerCase().startsWith('p') ? 'P' : 'S'}${n}`,
    sectionName: titleCase(section),
  };
}

function parseSheet(
  file: string,
  sheetName: string,
  ws: XLSX.WorkSheet,
  subjectCode: string
): ParsedT3Sheet {
  const text: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
  });
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

  const row2Raw = cell(text[ROW_LEVEL_SECTION], 0);
  const layout = findColumnLayout(text[ROW_SUBCOLS]);
  const maxText = text[ROW_MAXSCORES];
  const maxRaw = raw[ROW_MAXSCORES] ?? [];

  // Slots are read by BLOCK POSITION, not by their row-7 label: the WW block
  // is every column before the WW "Total", the PT block every column between
  // the WW block's WS column and the PT "Total". T3's Humanities and History
  // tabs label their third performance task "3" instead of "PT3" — a
  // label-only reader (T2's) drops that slot and grades out of 55, not 80.
  // A slot is real when its max-score cell is a number ("-" or blank = unused).
  const wwBlock: number[] = [];
  for (let c = 2; c < layout.wwTotalCol; c++) wwBlock.push(c);
  const ptBlock: number[] = [];
  for (let c = layout.wwTotalCol + 3; c < layout.ptTotalCol; c++)
    ptBlock.push(c);
  const realWw = wwBlock.filter((c) => num(maxRaw[c]) !== null);
  const realPt = ptBlock.filter((c) => num(maxRaw[c]) !== null);
  const wwTotals = realWw.map((c) => num(maxRaw[c]) as number);
  const ptTotals = realPt.map((c) => num(maxRaw[c]) as number);
  const qaTotalN = num(maxRaw[layout.examCol]);
  const qaTotal = qaTotalN === null || qaTotalN === 0 ? null : qaTotalN;

  const headerWeights = {
    ww: pctToFraction(
      maxRaw[layout.wwTotalCol + 2] ?? maxText?.[layout.wwTotalCol + 2]
    ),
    pt: pctToFraction(
      maxRaw[layout.ptTotalCol + 2] ?? maxText?.[layout.ptTotalCol + 2]
    ),
    qa: pctToFraction(
      maxRaw[layout.examCol + 2] ?? maxText?.[layout.examCol + 2]
    ),
  };

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    text[ROW_LABELS],
    layout.examCol + 1
  );

  const label = (c: number) => {
    const w = realWw.indexOf(c);
    if (w >= 0) return `W${w + 1}`;
    const p = realPt.indexOf(c);
    if (p >= 0) return `PT${p + 1}`;
    return c === layout.examCol ? 'Exam' : cell(text[ROW_SUBCOLS], c);
  };

  const students: ParsedT3Student[] = [];
  const lastRow = Math.max(range.e.r, raw.length - 1);
  for (let i = ROW_STUDENTS_START; i <= lastRow; i++) {
    const r = raw[i] ?? [];
    const idx = num(r[0]);
    const name = r[1] == null ? '' : String(r[1]).trim();
    // Template rows past the class list carry a name formula that evaluates to
    // 0 — a name with no letter in it is not a student.
    if (idx === null || !Number.isInteger(idx) || !/[A-Za-z]/.test(name))
      continue;

    const nonNumericCells: string[] = [];
    const readScore = (c: number): number | null => {
      const v = r[c];
      if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
      const n = num(v);
      if (n === null) nonNumericCells.push(`${label(c)}="${String(v).trim()}"`);
      return n;
    };

    // A mark typed into a column that has no max score is invisible to the
    // workbook's own total as well — name it rather than drop it silently.
    for (const c of [...wwBlock, ...ptBlock]) {
      if (realWw.includes(c) || realPt.includes(c)) continue;
      const v = r[c];
      if (v != null && String(v).trim() !== '')
        nonNumericCells.push(
          `column ${XLSX.utils.encode_col(c)} (no max score)="${String(v).trim()}"`
        );
    }

    let quarterlyIsFormula: boolean | null = null;
    if (quarterlyCol != null) {
      const addr = XLSX.utils.encode_cell({ r: i, c: quarterlyCol });
      const c = ws[addr];
      quarterlyIsFormula = c ? Boolean(c.f) : null;
    }

    students.push({
      rowNumber: i + 1,
      indexNo: idx,
      fullName: name,
      wwScores: realWw.map(readScore),
      ptScores: realPt.map(readScore),
      examScore: readScore(layout.examCol),
      nonNumericCells,
      printedWwTotal: num(r[layout.wwTotalCol]),
      printedPtTotal: num(r[layout.ptTotalCol]),
      printedWwPs: num(r[layout.wwTotalCol + 1]),
      printedPtPs: num(r[layout.ptTotalCol + 1]),
      printedQaPs: num(r[layout.examCol + 1]),
      printedInitial: initialCol == null ? null : num(r[initialCol]),
      printedQuarterly: quarterlyCol == null ? null : num(r[quarterlyCol]),
      quarterlyIsFormula,
    });
  }

  return {
    file,
    sheetName,
    subjectCode,
    tabIdentity: parseTab(sheetName),
    row2Identity: parseRow2(row2Raw),
    row2Raw,
    teacherName: parseTeacherName(cell(text[ROW_TEACHER], 0)),
    headerWeights,
    wwTotals,
    ptTotals,
    qaTotal,
    printedWwTotalMax: num(maxRaw[layout.wwTotalCol]),
    printedPtTotalMax: num(maxRaw[layout.ptTotalCol]),
    students,
  };
}

export function parseGradingWorkbookT3(
  filePath: string,
  subjectCode: string
): ParseT3Result {
  const wb = XLSX.readFile(filePath, { cellFormula: true });
  const file = filePath.split('/').slice(-2).join('/');
  const sheets: ParsedT3Sheet[] = [];
  const skipped: { sheetName: string; reason: string }[] = [];
  const meta = wb.Workbook?.Sheets ?? [];
  for (const sheetName of wb.SheetNames) {
    const hidden = meta.find((s) => s.name === sheetName)?.Hidden ?? 0;
    if (/^DO NOT USE/i.test(sheetName.trim())) {
      skipped.push({ sheetName, reason: 'tab is named "DO NOT USE"' });
      continue;
    }
    if (hidden) {
      skipped.push({ sheetName, reason: 'tab is hidden in the workbook' });
      continue;
    }
    try {
      sheets.push(
        parseSheet(file, sheetName, wb.Sheets[sheetName], subjectCode)
      );
    } catch (e) {
      skipped.push({
        sheetName,
        reason: `could not read the tab's columns: ${(e as Error).message}`,
      });
    }
  }
  return { sheets, skipped };
}

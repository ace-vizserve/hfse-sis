// lib/sis/backfill/grading/grading-workbook-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks (Primary + a
// Secondary Regular-track tab riding along in the same file) into one
// ParsedSubjectSheet per real PRIMARY section tab. Secondary tabs are
// recognized and skipped (Phase 6b's scope), never processed here.
//
// Deltas from Phase 3's T1 parser (grading-workbook.ts, never modified —
// this is a standalone module):
//   1. Row 2's identity text has no numeric section suffix for Primary
//      ("Primary 1 PATIENCE - MATH") and carries a trailing " - SUBJECT"
//      T1's raw text never had — a new regex handles both this and the
//      still-numbered Secondary shape ("Secondary 1 DISCIPLINE 2 - LIT").
//   2. Every T2 sheet has a SECOND, unreliable "Quarterly"/"Term 1" column
//      pair after the real printed-grade columns. T1's finder took the
//      LAST label match scanning forward — silently wrong here. This
//      finder takes the FIRST match of each label only.
//   3. (Added after a real run — see design doc §8.) Row 2's text is
//      sometimes simply WRONG — a copy-paste artifact from cloning an
//      existing tab as a template in Excel and forgetting to update the
//      label. Because roster resolution keys on (levelCode, sectionName,
//      indexNumber), trusting a wrong row-2 label doesn't fail loud — it
//      can silently resolve against a DIFFERENT real section's roster.
//      Tab names are structurally reliable (Excel forbids duplicate tab
//      names), so identity is now resolved from the tab name FIRST, with
//      row 2 used only as a fallback when the tab name itself doesn't
//      parse (the real case for the never-renamed "Reserved N" tabs).
//      Every case where the two signals disagree is recorded so a human
//      can see exactly what got corrected.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface ParseGradingWorkbookT2Result {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
}

const ROW_LEVEL_SECTION = 2;
const ROW_TEACHER = 3;
const ROW_LABELS = 5;
const ROW_SUBCOLS = 7;
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
      'grading-workbook-t2: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

function weightAt(maxRow: unknown[], totalCol: number): number {
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `grading-workbook-t2: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

// Fixed version of Phase 3's column finder — takes the FIRST match of each
// label, not the last, and stops scanning once both are found. This is
// what keeps the spurious second "Quarterly"/"Term 1" pair out of the
// import entirely.
function findPrintedGradeColsT2(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    if (initialCol !== null && quarterlyCol !== null) break;
    const label = cell(labelRow, i);
    if (initialCol === null && /Initial/i.test(label)) {
      initialCol = i;
      continue;
    }
    if (quarterlyCol === null && /Quarterly/i.test(label)) {
      quarterlyCol = i;
    }
  }
  return { initialCol, quarterlyCol };
}

type IdentityT2 =
  | { kind: 'primary'; levelCode: string; sectionName: string }
  | { kind: 'secondary'; levelCode: string; sectionName: string }
  | { kind: 'unrecognized' };

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Row 2's shape: "Primary N NAME - SUBJECT" or "Secondary N NAME - SUBJECT".
const ROW2_IDENTITY_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)\s+-\s+.+$/i;

function parseRow2Identity(raw: string): IdentityT2 {
  const m = ROW2_IDENTITY_RE.exec(raw.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, levelWord, levelNum, sectionRaw] = m;
  const isPrimary = levelWord.toLowerCase() === 'primary';
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

// Tab name's shape: "<Subject> - P<N> <Name>", "<Subject> - S<N> <Name>", or
// "<Subject> - Sec <N> <Name>" (the S/Sec spelling varies by file — both
// observed in real data, "Sec" tried first so it isn't shadowed by the
// single-letter "S" alternative).
const TAB_NAME_IDENTITY_RE = /^.+?\s*-\s*(Sec|P|S)\.?\s*(\d+)\s+(.+)$/i;

function parseTabNameIdentity(sheetName: string): IdentityT2 {
  const m = TAB_NAME_IDENTITY_RE.exec(sheetName.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, prefix, levelNum, sectionRaw] = m;
  const isPrimary = prefix.toLowerCase().startsWith('p');
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

function identityLabel(identity: IdentityT2): string {
  return identity.kind === 'unrecognized'
    ? '(unrecognized)'
    : `${identity.levelCode} ${identity.sectionName}`;
}

// Tab name wins whenever it parses — Excel forbids two tabs sharing a
// name, so a mistyped tab name would be immediately visible to whoever
// built the workbook, unlike a free-text label cell that's easy to
// fat-finger via copy-paste without visual feedback. Row 2 is the
// fallback ONLY when the tab name doesn't parse (the real case for
// never-renamed "Reserved N" tabs). When both parse but disagree, a
// human-readable correction note is returned so the operator can see
// exactly what got overridden.
function resolveIdentity(
  sheetName: string,
  row2Raw: string
): { identity: IdentityT2; correctionNote: string | null } {
  const tabIdentity = parseTabNameIdentity(sheetName);
  if (tabIdentity.kind === 'unrecognized') {
    return { identity: parseRow2Identity(row2Raw), correctionNote: null };
  }

  const row2Identity = parseRow2Identity(row2Raw);
  const disagrees =
    row2Identity.kind !== 'unrecognized' &&
    (row2Identity.kind !== tabIdentity.kind ||
      row2Identity.levelCode !== tabIdentity.levelCode ||
      row2Identity.sectionName !== tabIdentity.sectionName);

  return {
    identity: tabIdentity,
    correctionNote: disagrees
      ? `"${sheetName}": tab name says ${identityLabel(tabIdentity)}, row 2 says ${identityLabel(row2Identity)} — using tab name`
      : null,
  };
}

function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

function parseOneSheetT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
} {
  const { identity, correctionNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'primary')
    return { sheet: null, identity, correctionNote };

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
  };
}

export function parseGradingWorkbookT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote } = parseOneSheetT2(
      rows,
      subjectCode,
      sheetName
    );
    if (correctionNote) identityCorrections.push(correctionNote);
    if (identity.kind === 'primary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return { sheets, skippedSecondary, skippedUnrecognized, identityCorrections };
}

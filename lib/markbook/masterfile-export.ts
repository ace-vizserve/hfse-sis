import 'server-only';

import ExcelJS from 'exceljs';

import { resolveNonExaminableLetter } from '@/lib/compute/letter-grade';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubject,
} from '@/lib/markbook/masterfile';
import { toPlainText } from '@/lib/rich-text';
import type { AttendanceDateIndex } from '@/lib/markbook/masterfile-attendance-dates';

// HFSE Masterfile → Excel report-book export (KD #95).
//
// Pure generation from the already-computed `MasterfilePayload` (the same data
// the on-screen grid renders). No spreadsheet input, no DB reads — the route
// loads the payload via `loadMasterfile`, then hands it here.
//
// The xlsx sheet is a COPY of the "Masterfile" sheet in the school's own
// `AY2025 Final Report Book_Primary.xlsx` / `_Secondary.xlsx` — same rows,
// same headers, same column order, same cell words — so the registrar gets the
// file they already work from (Mr Ace, 2026-10-27: "mirror what they're doing
// in excel"). Only the layout is copied; every value is the SIS's own:
//   Row 1  HFSE INTERNATIONAL SCHOOL
//   Row 2  AY 2026 REPORT CARD - PRIMARY | SECONDARY
//   Row 4  column numbers 1, 2, 3… from STUDENT NAME (the report-book sheets
//          VLOOKUP by them)
//   Rows 5–7  three header rows: group · Term / Overall / Remarks · attendance
//          School Days / Present / Late
//   Rows 8+  one per student, S/N counting 1, 2, 3…
// Secondary only: the Teacher's Comments block ends in CCA (the CCA subject's
// year letter) instead of Term 4, attendance has a Remarks column, and two
// "Remarks for Economics" columns close the sheet (the SIS holds no such
// remark, so they stay empty, as in the school's file for non-Economics rows).
//
// The CSV branch is the flat data table and keeps its own simple shape below.

const IDENTITY_HEADERS = [
  'S/N',
  'STUDENT NAME',
  'LEVEL',
  'CLASS',
  'FORM CLASS ADVISER',
  'STUDENT\nSTATUS',
] as const;

const TERM_SUBCOLS = ['Term 1', 'Term 2', 'Term 3', 'Term 4'] as const;

// The school's file puts these first, in this order (English, Math, Mother
// Tongue, then History / Science / Social Studies…). Anything not listed keeps
// the payload's order after them.
const SUBJECT_ORDER = [
  'ENG',
  'MATH',
  'MT',
  'FIL',
  'MANDARIN',
  'HIST',
  'SCI',
  'SS',
  'LIT',
  'HUM',
  'ECON',
];

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** "S1" → "Secondary One", "P3" → "Primary Three"; anything else → its label. */
function levelLabel(level: MasterfilePayload['level']): string {
  const m = /^([PS])(\d)$/i.exec(level.code);
  if (!m || !NUMBER_WORDS[Number(m[2])]) return level.label;
  const school = m[1].toUpperCase() === 'S' ? 'Secondary' : 'Primary';
  return `${school} ${NUMBER_WORDS[Number(m[2])]}`;
}

/** The school file's STUDENT STATUS words. */
function excelStatusLabel(row: MasterfileStudentRow): string {
  if (row.enrollmentStatus === 'late_enrollee') {
    return row.lateEnrolleeTermNumber != null
      ? `Late Enrolment | Term ${row.lateEnrolleeTermNumber}`
      : 'Late Enrolment';
  }
  return statusLabel(row.enrollmentStatus);
}

function statusLabel(status: string): string {
  if (status === 'late_enrollee') return 'Late Enrolment';
  if (status === 'withdrawn') return 'Withdrawn';
  return 'Active';
}

/**
 * The Teacher's Comments cell — one line per term, prose only.
 *
 * ⚠ THE WRITE-UP IS FORMATTED TEXT AND ARRIVES AS HTML. A spreadsheet cell
 * renders nothing, so the registrar would read `<p><strong>…` verbatim.
 * `toPlainText` is the single stripper for every boundary like this one; it is
 * safe on the bare sentences written before the editor existed, which parse to
 * one paragraph and come back unchanged.
 *
 * A term whose comment strips to nothing is DROPPED rather than printed as an
 * empty "T2: ". An adviser who opens the box, types nothing and saves leaves
 * `<p></p>` behind — seven characters that no string test reads as blank. The
 * loader already excludes those (`lib/markbook/masterfile.ts`), and this is the
 * same rule applied where the cell is actually written, so neither export can
 * announce a comment that nobody wrote.
 *
 * Feeds BOTH export formats — the xlsx sheet and the flat CSV table.
 */
function commentsText(row: MasterfileStudentRow): string {
  if (!row.commentsByTerm || row.commentsByTerm.length === 0) return '';
  return row.commentsByTerm
    .map((c) => ({ termNumber: c.termNumber, prose: toPlainText(c.text) }))
    .filter((c) => c.prose !== '')
    .map((c) => `T${c.termNumber}: ${c.prose}`)
    .join('\n\n');
}

/** One term's adviser comment as plain text, '' when there is none. */
function commentForTerm(row: MasterfileStudentRow, termNumber: number): string {
  const c = row.commentsByTerm?.find((x) => x.termNumber === termNumber);
  return c ? toPlainText(c.text) : '';
}

/** A letter-graded term cell: override → derived letter, N.A. when excused. */
function termLetter(
  cell: MasterfileStudentRow['subjectRows'][number]['cells'][number]
): string {
  const resolved = resolveNonExaminableLetter({
    isNa: cell.isNa,
    letterOverride: cell.letter,
    quarterly: cell.quarterly,
  });
  return resolved === 'NA' ? 'N.A.' : (resolved ?? '');
}

/** The school file's subject order: SUBJECT_ORDER first, the rest as given. */
function orderSubjects(subjects: MasterfileSubject[]): MasterfileSubject[] {
  const rank = (s: MasterfileSubject) => {
    const i = SUBJECT_ORDER.indexOf(s.code.toUpperCase());
    return i === -1 ? SUBJECT_ORDER.length : i;
  };
  return subjects
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      if (a.s.isExaminable !== b.s.isExaminable)
        return a.s.isExaminable ? -1 : 1;
      return rank(a.s) - rank(b.s) || a.i - b.i;
    })
    .map((x) => x.s);
}

/**
 * Builds an `.xlsx` workbook from the computed Masterfile payload and returns
 * it as a Node Buffer (`Content-Type` xlsx). Server-only. Written with
 * ExcelJS, not SheetJS: SheetJS's free build writes no fills, fonts or
 * borders, so the file opened looking like a bare CSV.
 */
export async function buildMasterfileWorkbook(
  payload: MasterfilePayload
): Promise<Buffer> {
  const isSecondary = /^S/i.test(payload.level.code);
  // Secondary's CCA is a cell in the comments block, not a subject group.
  const isCca = (s: MasterfileSubject) =>
    isSecondary && s.code.toUpperCase() === 'CCA';
  const cca = payload.subjects.find(isCca) ?? null;
  const ordered = orderSubjects(payload.subjects.filter((s) => !isCca(s)));
  const examinable = ordered.filter((s) => s.isExaminable);
  const nonExam = ordered.filter((s) => !s.isExaminable);
  const termNumbers = [1, 2, 3, 4];

  // Header rows: 0 school name · 1 title · 2 blank · 3 column numbers ·
  // 4 group · 5 Term/Overall/Remarks · 6 attendance sub-columns.
  const HEADER_ROWS = 7;
  const head: (string | number)[][] = Array.from(
    { length: HEADER_ROWS },
    () => []
  );
  const merges: { r1: number; c1: number; r2: number; c2: number }[] = [];
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 !== r2 || c1 !== c2) merges.push({ r1, c1, r2, c2 });
  };
  const put = (r: number, c: number, v: string) => {
    head[r][c] = v;
  };

  head[0][0] = 'HFSE INTERNATIONAL SCHOOL';
  head[1][0] = `AY ${payload.ayCode.replace(/^AY/i, '')} REPORT CARD - ${
    isSecondary ? 'SECONDARY' : 'PRIMARY'
  }`;

  let col = 0;
  // What each column holds — drives its cell style and width.
  const kinds: ColKind[] = [];

  // Identity: one column each, merged down the three header rows.
  for (const [i, h] of IDENTITY_HEADERS.entries()) {
    put(4, col, h);
    merge(4, col, 6, col);
    kinds[col++] = i === 0 ? 'serial' : i === 1 ? 'name' : 'text';
  }

  // Examinable subject: Term 1–4 · Overall · Remarks (the subject award).
  for (const sub of examinable) {
    put(4, col, sub.name.toUpperCase());
    merge(4, col, 4, col + 5);
    for (const h of [...TERM_SUBCOLS, 'Overall', 'Remarks']) {
      put(5, col, h);
      merge(5, col, 6, col);
      kinds[col++] =
        h === 'Overall' ? 'overall' : h === 'Remarks' ? 'remarks' : 'grade';
    }
  }

  // Letter-graded subject: Term 1–4 only.
  for (const sub of nonExam) {
    put(4, col, sub.name.toUpperCase());
    merge(4, col, 4, col + 3);
    for (const h of TERM_SUBCOLS) {
      put(5, col, h);
      merge(5, col, 6, col);
      kinds[col++] = 'grade';
    }
  }

  // Overall Academic Award: General Average · award, no sub-headers.
  put(4, col, 'OVERALL ACADEMIC AWARD');
  merge(4, col, 6, col + 1);
  kinds[col++] = 'ga';
  kinds[col++] = 'award';

  // Attendance: per term School Days · Present · Late, then Overall
  // Present · Late, then (Secondary) Remarks.
  const attStart = col;
  put(4, col, 'ATTENDANCE');
  for (const n of termNumbers) {
    put(5, col, `Term ${n}`);
    merge(5, col, 5, col + 2);
    for (const h of ['School Days', 'Present', 'Late']) {
      put(6, col, h);
      kinds[col++] = 'att';
    }
  }
  put(5, col, 'Overall');
  merge(5, col, 5, col + 1);
  for (const h of ['Present', 'Late']) {
    put(6, col, h);
    kinds[col++] = 'att';
  }
  if (isSecondary) {
    put(5, col, 'Remarks');
    merge(5, col, 6, col);
    kinds[col++] = 'remarks';
  }
  merge(4, attStart, 4, col - 1);

  // Teacher's Comments: Term 1 · Term 2 · Term 3 · Term 4 (Primary) or CCA.
  const commentsStart = col;
  put(4, col, "TEACHER'S COMMENTS");
  for (const h of [
    'Term 1',
    'Term 2',
    'Term 3',
    isSecondary ? 'CCA' : 'Term 4',
  ]) {
    put(5, col, h);
    merge(5, col, 6, col);
    kinds[col++] = h === 'CCA' ? 'grade' : 'comment';
  }
  merge(4, commentsStart, 4, col - 1);
  const numberedCols = col;

  if (isSecondary) {
    put(4, col, 'Remarks for Economics');
    merge(4, col, 6, col + 1);
    kinds[col++] = 'econ';
    kinds[col++] = 'econ';
  }
  const totalCols = col;

  // Column numbers 1, 2, 3… from STUDENT NAME to the end of the comments.
  for (let c = 1; c < numberedCols; c++) head[3][c] = c;

  // ---- Data rows ----
  const dataRows: (string | number)[][] = payload.rows.map((row, idx) => {
    const cells: (string | number)[] = [
      idx + 1,
      row.fullName || row.studentNumber,
      levelLabel(payload.level),
      row.sectionName,
      row.formClassAdviser ?? '',
      excelStatusLabel(row),
    ];

    const subjectRowById = new Map(
      row.subjectRows.map((sr) => [sr.subjectId, sr])
    );

    // Examinable: T1–T4 quarterly, Overall (2dp), Remarks. A subject the
    // student doesn't take reads NA in the terms, blank after.
    for (const sub of examinable) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('NA', 'NA', 'NA', 'NA', '', '');
        continue;
      }
      for (const cell of sr.cells) {
        if (cell.isNa) cells.push('N.A.');
        else if (cell.quarterly != null) cells.push(cell.quarterly);
        else cells.push('');
      }
      cells.push(sr.overall != null ? Number(sr.overall.toFixed(2)) : '');
      cells.push(sr.award ?? '');
    }

    // Letter-graded: T1–T4 derived/override letters.
    for (const sub of nonExam) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('NA', 'NA', 'NA', 'NA');
        continue;
      }
      for (const cell of sr.cells) cells.push(termLetter(cell));
    }

    // Overall Academic Award: General Average (1dp) + award.
    cells.push(
      row.generalAverage != null ? Number(row.generalAverage.toFixed(1)) : ''
    );
    cells.push(row.overallAward ?? '');

    // Attendance. `?? ''` not `|| ''` — a real 0 must print as 0.
    for (const n of termNumbers) {
      const termId = payload.terms.find((t) => t.termNumber === n)?.id;
      const att = row.attendanceByTerm.find((a) => a.termId === termId);
      cells.push(att?.schoolDays ?? '', att?.present ?? '', att?.late ?? '');
    }
    cells.push(
      row.attendanceTotal.present ?? '',
      row.attendanceTotal.late ?? ''
    );
    if (isSecondary) cells.push('');

    // Teacher's Comments, one column per term.
    for (const n of [1, 2, 3]) cells.push(commentForTerm(row, n));
    if (isSecondary) {
      const sr = cca ? subjectRowById.get(cca.id) : undefined;
      cells.push(sr ? (sr.annualLetter ?? sr.derivedAnnualLetter ?? '') : '');
      cells.push('', ''); // Remarks for Economics
    } else {
      cells.push(commentForTerm(row, 4));
    }

    return cells;
  });

  // ---- Render, in the school file's look ----
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Masterfile', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 0 }],
  });

  [...head, ...dataRows].forEach((cells, r) => {
    const row = ws.getRow(r + 1);
    for (let c = 0; c < totalCols; c++) {
      const v = cells[c];
      if (v !== undefined && v !== '') row.getCell(c + 1).value = v;
    }
  });
  for (const m of merges) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);

  ws.getCell('A1').font = { ...FONT, bold: true, size: 15 };
  ws.getCell('A2').font = FONT;
  ws.getRow(4).height = 48.75;
  ws.getRow(5).height = 21;
  for (let c = 0; c < totalCols; c++) {
    const kind = kinds[c];
    ws.getColumn(c + 1).width = COLUMN_WIDTH[kind];
    if (c > 0 && c < numberedCols) {
      const n = ws.getCell(4, c + 1);
      n.font = FONT;
      n.alignment = { horizontal: 'center', vertical: 'bottom' };
    }
    // Header block: orange, white bold; the award header is blue.
    for (let r = 5; r <= 7; r++) {
      const cell = ws.getCell(r, c + 1);
      cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = solid(kind === 'ga' || kind === 'award' ? BLUE : ORANGE);
      cell.border = HAIR_BOX;
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    }
    // Student rows.
    for (let r = HEADER_ROWS + 1; r <= HEADER_ROWS + dataRows.length; r++) {
      const cell = ws.getCell(r, c + 1);
      cell.font = FONT;
      cell.border = kind === 'name' ? THIN_BOX : HAIR_BOX;
      cell.alignment = {
        horizontal: LEFT_KINDS.has(kind) ? 'left' : 'center',
        vertical: 'middle',
      };
      if (kind === 'overall') {
        cell.fill = solid(LIGHT_ORANGE);
        cell.numFmt = '0';
      } else if (kind === 'ga') {
        cell.fill = solid(LIGHT_BLUE);
        cell.numFmt = '0';
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

type ColKind =
  | 'serial'
  | 'name'
  | 'text'
  | 'grade'
  | 'overall'
  | 'remarks'
  | 'ga'
  | 'award'
  | 'att'
  | 'comment'
  | 'econ';

// The school file's look (AY2025 Final Report Book, Masterfile sheet): Arial
// 10, an orange header block with white bold text, the Overall Academic Award
// header in blue, Overall cells light orange, General Average light blue,
// hairline borders. Spreadsheet colours, not UI tokens — Hard Rule #7 covers
// app/ and components/.
const FONT = { name: 'Arial', size: 10, color: { argb: 'FF000000' } };
const ORANGE = 'FFED7D31';
const BLUE = 'FF0000FF';
const LIGHT_ORANGE = 'FFFBE4D5';
const LIGHT_BLUE = 'FFDEEAF6';
const hair = { style: 'hair' as const, color: { argb: 'FF000000' } };
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const HAIR_BOX = { top: hair, left: hair, bottom: hair, right: hair };
const THIN_BOX = { top: thin, left: thin, bottom: thin, right: thin };
const LEFT_KINDS = new Set<ColKind>([
  'name',
  'text',
  'remarks',
  'award',
  'comment',
  'econ',
]);
const COLUMN_WIDTH: Record<ColKind, number> = {
  serial: 7.43,
  name: 33.43,
  text: 18,
  grade: 8.71,
  overall: 8.71,
  remarks: 27,
  ga: 8.71,
  award: 30.43,
  att: 11.86,
  comment: 45,
  econ: 37.43,
};

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

// ---------------------------------------------------------------------------
// Flat CSV helper — the data table, single header row.
//
// Used by the `?format=csv` branch in the export route. Unlike the xlsx sheet
// (a copy of the school's file), it keeps Student No., each non-exam subject's
// Final letter and the attendance "Days missed" dates.
//
// Column order:
//   Identity (7) · examinable subjects (6 each) · non-exam subjects (5 each) ·
//   General Average · Overall Academic Award · attendance per-term + totals ·
//   Teacher's Comments
// ---------------------------------------------------------------------------

/** RFC-4180 escape: wrap fields containing , " or newlines in double-quotes. */
function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Shape returned by flattenMasterfileRows. */
export interface MasterfileFlatTable {
  /** Single header row, prefixed where needed (e.g. "MATH T1", "MATH Award"). */
  headers: string[];
  /** One array per student, values parallel to headers. Nulls = empty in CSV. */
  rows: (string | number | null)[][];
}

/**
 * Produces a flat table (headers + data rows) from the MasterfilePayload with
 * the same column order as `buildMasterfileWorkbook`.  Used by the CSV branch
 * of the export route.  Pure — no xlsx dependency.
 */
export function flattenMasterfileRows(
  payload: MasterfilePayload,
  /** Same optional date index as the workbook builder — see its note. */
  dates?: AttendanceDateIndex
): MasterfileFlatTable {
  const examinable = payload.subjects.filter((s) => s.isExaminable);
  const nonExam = payload.subjects.filter((s) => !s.isExaminable);
  const terms = payload.terms;

  // --- Build header row ---
  const headers: string[] = [
    'S/N',
    'Student Name',
    'Student No.',
    'Level',
    'Class',
    'Form Class Adviser',
    'Status',
  ];

  for (const sub of examinable) {
    headers.push(
      `${sub.code} Term 1`,
      `${sub.code} Term 2`,
      `${sub.code} Term 3`,
      `${sub.code} Term 4`,
      `${sub.code} Overall`,
      `${sub.code} Award`
    );
  }

  for (const sub of nonExam) {
    headers.push(
      `${sub.code} Term 1`,
      `${sub.code} Term 2`,
      `${sub.code} Term 3`,
      `${sub.code} Term 4`,
      `${sub.code} Final`
    );
  }

  headers.push('General Average', 'Overall Academic Award');

  for (const t of terms) {
    headers.push(
      `T${t.termNumber} School Days`,
      `T${t.termNumber} Present`,
      `T${t.termNumber} Late`
    );
    if (dates) headers.push(`T${t.termNumber} Days missed`);
  }
  headers.push('Total School Days', 'Total Present', 'Total Late');
  headers.push("Teacher's Comments");

  // --- Build data rows (mirrors buildMasterfileWorkbook data section) ---
  const rows: (string | number | null)[][] = payload.rows.map((row) => {
    const cells: (string | number | null)[] = [];

    // S/N = the student's permanent per-section index number (KD #85 rule:
    // index numbers are permanent roll numbers, never renumbered by position).
    cells.push(row.indexNumber ?? null);
    cells.push(row.fullName || row.studentNumber);
    cells.push(row.studentNumber);
    cells.push(payload.level.label);
    cells.push(row.sectionName);
    cells.push(row.formClassAdviser ?? null);
    cells.push(statusLabel(row.enrollmentStatus));

    const subjectRowById = new Map(
      row.subjectRows.map((sr) => [sr.subjectId, sr])
    );

    // Examinable: T1-T4 quarterly, Overall (2dp), Award.
    for (const sub of examinable) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push(null, null, null, null, null, null);
        continue;
      }
      for (const cell of sr.cells) {
        if (cell.isNa) cells.push('N.A.');
        else if (cell.quarterly != null) cells.push(cell.quarterly);
        else cells.push(null);
      }
      cells.push(sr.overall != null ? Number(sr.overall.toFixed(2)) : null);
      cells.push(sr.award ?? null);
    }

    // Non-examinable: T1-T4 derived/override letters + Final.
    for (const sub of nonExam) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push(null, null, null, null, null);
        continue;
      }
      for (const cell of sr.cells) {
        const resolved = resolveNonExaminableLetter({
          isNa: cell.isNa,
          letterOverride: cell.letter,
          quarterly: cell.quarterly,
        });
        cells.push(resolved === 'NA' ? 'N.A.' : (resolved ?? null));
      }
      cells.push(sr.annualLetter ?? null);
    }

    // Overall Academic Award.
    cells.push(
      row.generalAverage != null ? Number(row.generalAverage.toFixed(1)) : null
    );
    cells.push(row.overallAward ?? null);

    // Attendance per term + totals.
    for (const att of row.attendanceByTerm) {
      cells.push(att.schoolDays ?? null);
      cells.push(att.present ?? null);
      cells.push(att.late ?? null);
      if (dates) cells.push(dates.get(row.studentId, att.termId));
    }
    cells.push(row.attendanceTotal.schoolDays ?? null);
    cells.push(row.attendanceTotal.present ?? null);
    cells.push(row.attendanceTotal.late ?? null);

    // Teacher's Comments (joined T1-T3).
    cells.push(commentsText(row) || null);

    return cells;
  });

  return { headers, rows };
}

/**
 * Serialises a MasterfileFlatTable to an RFC-4180 CSV string with a leading
 * UTF-8 BOM (so Excel opens it correctly — matches the project's drill CSV
 * convention, KD #56).
 */
export function masterfileToCsv(table: MasterfileFlatTable): string {
  const BOM = '﻿';
  const lines: string[] = [];
  lines.push(table.headers.map(csvEscape).join(','));
  for (const row of table.rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return BOM + lines.join('\r\n');
}

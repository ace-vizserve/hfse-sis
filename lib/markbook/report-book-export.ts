import 'server-only';

import ExcelJS from 'exceljs';

import { resolveNonExaminableLetter } from '@/lib/compute/letter-grade';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubject,
} from '@/lib/markbook/masterfile';
import type { ConsolidatedFilters } from '@/lib/markbook/masterfile-export';
import { toPlainText } from '@/lib/rich-text';

// HFSE Masterfile → the school's Final Report Book "Masterfile" sheet (KD #95).
//
// The second export template, beside the Consolidated File
// (masterfile-export.ts). A COPY of the "Masterfile" sheet in the school's
// `AY2025 Final Report Book_Primary.xlsx` / `_Secondary.xlsx` — the sheet the
// report-card tabs VLOOKUP — so the registrar gets the file they already work
// from. Only the layout is copied; every value is the SIS's own:
//   Row 1  HFSE INTERNATIONAL SCHOOL
//   Row 2  AY 2026 REPORT CARD - PRIMARY | SECONDARY
//   Row 4  column numbers 1, 2, 3… from STUDENT NAME (the report-book sheets
//          VLOOKUP by them)
//   Rows 5–7  three header rows: group · Term / Overall / Remarks · attendance
//          School Days / Present / Late
//   Rows 8+  one per student, S/N counting 1, 2, 3…
// ONE sheet for the whole division — every level of Primary (or Secondary),
// level after level, S/N running on — as in the school's file. Columns are
// every subject any of those levels takes; a level that does not take one
// reads NA (Sec 3–4 under HISTORY).
// Secondary only: the Teacher's Comments block ends in CCA (the CCA subject's
// year letter) instead of Term 4, attendance has a Remarks column, and two
// "Remarks for Economics" columns close the sheet (the SIS holds no such
// remark, so they stay empty, as in the school's file for non-Economics rows).
//
// The page's filters narrow it the same way as the Consolidated File: level
// and class pick the students, subject the subject columns, term the terms
// filled, status the students. The CSV is the same grid without the colours.

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
function statusLabel(row: MasterfileStudentRow): string {
  if (row.enrollmentStatus === 'late_enrollee') {
    return row.lateEnrolleeTermNumber != null
      ? `Late Enrolment | Term ${row.lateEnrolleeTermNumber}`
      : 'Late Enrolment';
  }
  if (row.enrollmentStatus === 'withdrawn') return 'Withdrawn';
  return 'Active';
}

/**
 * One term's adviser comment as plain text, '' when there is none.
 *
 * ⚠ THE WRITE-UP IS FORMATTED TEXT AND ARRIVES AS HTML. A spreadsheet cell
 * renders nothing, so the registrar would read `<p><strong>…` verbatim.
 * `toPlainText` is the single stripper for every boundary like this one; an
 * empty editor document (`<p></p>`) strips to ''.
 */
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

type Grid = {
  head: (string | number)[][];
  dataRows: (string | number)[][];
  merges: { r1: number; c1: number; r2: number; c2: number }[];
  kinds: ColKind[];
  totalCols: number;
  numberedCols: number;
};

const HEADER_ROWS = 7;

/** The sheet as a grid of values — the ONE layout both formats write. */
function buildGrid(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): Grid {
  const payloads = Array.isArray(input) ? input : [input];
  const first = payloads[0];
  const isSecondary = !!first && /^S/i.test(first.level.code);
  const lastTerm = filters.termNumber ?? 4;

  // Every subject any level takes, once, in the order first met.
  const subjectById = new Map<string, MasterfileSubject>();
  for (const p of payloads)
    for (const s of p.subjects)
      if (!subjectById.has(s.id)) subjectById.set(s.id, s);
  const subjects = [...subjectById.values()];
  // Secondary's CCA is a cell in the comments block, not a subject group.
  const isCca = (s: MasterfileSubject) =>
    isSecondary && s.code.toUpperCase() === 'CCA';
  const ccaIds = new Set(subjects.filter(isCca).map((s) => s.id));
  const ordered = orderSubjects(
    subjects.filter(
      (s) => !isCca(s) && (!filters.subjectId || s.id === filters.subjectId)
    )
  );
  const examinable = ordered.filter((s) => s.isExaminable);
  const nonExam = ordered.filter((s) => !s.isExaminable);
  const termNumbers = [1, 2, 3, 4];

  // Header rows: 0 school name · 1 title · 2 blank · 3 column numbers ·
  // 4 group · 5 Term/Overall/Remarks · 6 attendance sub-columns.
  const head: (string | number)[][] = Array.from(
    { length: HEADER_ROWS },
    () => []
  );
  const merges: Grid['merges'] = [];
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 !== r2 || c1 !== c2) merges.push({ r1, c1, r2, c2 });
  };
  const put = (r: number, c: number, v: string) => {
    head[r][c] = v;
  };

  head[0][0] = 'HFSE INTERNATIONAL SCHOOL';
  head[1][0] = `AY ${(first?.ayCode ?? '').replace(/^AY/i, '')} REPORT CARD - ${
    isSecondary ? 'SECONDARY' : 'PRIMARY'
  }`;

  let col = 0;
  const kinds: ColKind[] = [];

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

  // ---- Data rows: every level in order, S/N running on ----
  const studentRows = payloads.flatMap((payload) =>
    payload.rows
      .filter(
        (row) =>
          payload.selectedSectionIds.includes(row.sectionId) &&
          (!filters.status || row.enrollmentStatus === filters.status)
      )
      .map((row) => ({ payload, row }))
  );
  const dataRows = studentRows.map(({ payload, row }, idx) => {
    const cells: (string | number)[] = [
      idx + 1,
      row.fullName || row.studentNumber,
      levelLabel(payload.level),
      row.sectionName,
      row.formClassAdviser ?? '',
      statusLabel(row),
    ];
    const subjectRowById = new Map(
      row.subjectRows.map((sr) => [sr.subjectId, sr])
    );
    const full = lastTerm >= 4;

    // Examinable: T1–T4 quarterly, Overall (2dp), Remarks. A subject the
    // student's level doesn't take reads NA in the terms, blank after.
    for (const sub of examinable) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('NA', 'NA', 'NA', 'NA', '', '');
        continue;
      }
      sr.cells.forEach((cell, i) => {
        if (i + 1 > lastTerm) cells.push('');
        else if (cell.isNa) cells.push('N.A.');
        else cells.push(cell.quarterly ?? '');
      });
      cells.push(
        full && sr.overall != null ? Number(sr.overall.toFixed(2)) : ''
      );
      cells.push(full && sr.overall != null ? (sr.award ?? '') : '');
    }

    // Letter-graded: T1–T4 derived/override letters.
    for (const sub of nonExam) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('NA', 'NA', 'NA', 'NA');
        continue;
      }
      sr.cells.forEach((cell, i) =>
        cells.push(i + 1 > lastTerm ? '' : termLetter(cell))
      );
    }

    // Overall Academic Award: General Average (1dp) + award.
    const ga = full ? row.generalAverage : null;
    cells.push(ga != null ? Number(ga.toFixed(1)) : '');
    cells.push(ga != null ? (row.overallAward ?? '') : '');

    // Attendance. `?? ''` not `|| ''` — a real 0 must print as 0.
    for (const n of termNumbers) {
      const termId = payload.terms.find((t) => t.termNumber === n)?.id;
      const att =
        n > lastTerm
          ? undefined
          : row.attendanceByTerm.find((a) => a.termId === termId);
      cells.push(att?.schoolDays ?? '', att?.present ?? '', att?.late ?? '');
    }
    cells.push(
      row.attendanceTotal.present ?? '',
      row.attendanceTotal.late ?? ''
    );
    if (isSecondary) cells.push('');

    // Teacher's Comments, one column per term.
    for (const n of [1, 2, 3])
      cells.push(n > lastTerm ? '' : commentForTerm(row, n));
    if (isSecondary) {
      const sr = row.subjectRows.find((x) => ccaIds.has(x.subjectId));
      cells.push(
        full && sr ? (sr.annualLetter ?? sr.derivedAnnualLetter ?? '') : ''
      );
      cells.push('', ''); // Remarks for Economics
    } else {
      cells.push(full ? commentForTerm(row, 4) : '');
    }

    return cells;
  });

  return { head, dataRows, merges, kinds, totalCols, numberedCols };
}

/**
 * The Report Book Masterfile sheet as `.xlsx` (Node Buffer). Pass one level's
 * payload or every level of a division, in level order.
 */
export async function buildReportBookWorkbook(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): Promise<Buffer> {
  const { head, dataRows, merges, kinds, totalCols, numberedCols } = buildGrid(
    input,
    filters
  );
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

/** The same grid as an RFC-4180 CSV with a UTF-8 BOM (KD #56). */
export function reportBookToCsv(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): string {
  const { head, dataRows, totalCols } = buildGrid(input, filters);
  const lines = [...head, ...dataRows].map((row) =>
    Array.from({ length: totalCols }, (_, c) => csvEscape(row[c])).join(',')
  );
  return '﻿' + lines.join('\r\n');
}

function csvEscape(v: string | number | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.split('"').join('""')}"` : s;
}

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

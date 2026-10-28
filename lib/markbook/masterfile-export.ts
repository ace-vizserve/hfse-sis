import 'server-only';

import ExcelJS from 'exceljs';

import { resolveNonExaminableLetter } from '@/lib/compute/letter-grade';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubject,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';
import { toPlainText } from '@/lib/rich-text';

// HFSE Masterfile → the school's AY2026 Consolidated File (KD #95).
//
// The export is a COPY of the file the registrar keeps this year,
// "AY2026 Consolidated File Primary|Secondary Grades Term N.xlsx" (Mr Ace,
// 2026-10-28: "just copy the template they have"). Only the layout is copied;
// every value is the SIS's own computed payload:
//
//   One tab per class ("Primary 1 Patience", "Sec 1 Discipline 1").
//   Rows 1–5  HFSE INTERNATIONAL SCHOOL · CONSOLIDATED FORM · PRIMARY ONE
//             PATIENCE · AY 2026 - Term Two · Teacher: <form adviser>
//   Row 6  per subject: T1 T2 T3 T4 Overall Award (letter subjects: T1–T4)
//   Row 7  No · Name · the subject's name over its columns
//   Rows 8+ one per student, No counting 1, 2, 3… within the tab
// After the subjects: each term's attendance (School Days · Present · Late)
// and the teacher's evaluation comments, T1–T4.
//
// Subjects run English, Math, Science, then the class's other examinable
// subjects (MT = whichever of Filipino / Mandarin the student takes), then —
// Secondary only — the "Academic" Overall · Award (the General Average and the
// Overall Academic Award), then the letter subjects (STAR / CA / PE). A tab
// carries only the subjects its students are graded in, which is why Sec 1D1
// and 1D2 have different columns, as in the school's file. Each column block
// keeps the school's colour for its position.
//
// The page's filters narrow the file: grade level and class pick the tabs,
// subject picks the columns, term fills the terms up to that one (the school's
// "Grades Term 2" file holds T1–T2), status picks the students.
//
// The CSV is the same grid without the colours, tabs one after another.

export type ConsolidatedFilters = {
  subjectId?: string | null;
  termNumber?: number | null;
  status?: 'active' | 'late_enrollee' | 'withdrawn' | null;
};

type Kind = 'exam' | 'academic' | 'letter' | 'attendance' | 'comments';

/**
 * One column block on a tab: a subject (or MT pair), the Academic GA, one
 * term's attendance, or the teacher's comments.
 */
type Block = {
  kind: Kind;
  label: string;
  /** The SIS subjects that fill it — two for MT, none for the others. */
  subjectIds: string[];
  /** Attendance only: which term. */
  termNumber?: number;
  fill: string;
};

type Tab = {
  name: string;
  /** The school's title block above the table, one line per row. */
  title: string[];
  blocks: Block[];
  rows: (string | number | null)[][];
};

/** Rows above the table: the five-line title, then the two header rows. */
const TITLE_ROWS = 5;

const TERMS = [1, 2, 3, 4];

// The school file's short names, and its order within each kind.
const EXAM_ORDER: [string[], string][] = [
  [['ENG'], 'English'],
  [['MATH'], 'Math'],
  [['SCI'], 'Science'],
  [['FIL', 'MANDARIN', 'MT'], 'MT'],
  [['GP'], 'Global Perspectives'],
  [['HIST'], 'History'],
  [['HUM'], 'Humanities'],
  [['SS'], 'Social Studies'],
  [['LIT'], 'Lit'],
  [['COMP'], 'Computing'],
];
const LETTER_ORDER: [string[], string][] = [
  [['STAR'], 'STAR'],
  [['CA'], 'CA'],
  [['ARTD'], 'Arts & Design'],
  [['PESTD', 'PEH', 'PE'], 'PE'],
];

// The school file's colours, by position: examinable blocks, the Academic
// block, letter blocks. Spreadsheet colours, not UI tokens — Hard Rule #7
// covers app/ and components/.
const EXAM_FILLS = [
  'FF00FF99',
  'FFFFC000',
  'FFFFFFCC',
  'FFD76DCC',
  'FFF1CEEE',
  'FFFAE2D5',
];
const ACADEMIC_FILL = 'FFD9F2D0';
const LETTER_FILLS = ['FFCAEDFB', 'FFFFFF00'];
const NAME_HEADER_FILL = 'FFE8E8E8';

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** "P1" → "PRIMARY ONE", "S2" → "SECONDARY TWO"; else the label, capitals. */
function levelTitle(level: MasterfilePayload['level']): string {
  const m = /^([PS])(\d)$/i.exec(level.code);
  if (!m || !NUMBER_WORDS[Number(m[2])]) return level.label.toUpperCase();
  const school = m[1].toUpperCase() === 'S' ? 'SECONDARY' : 'PRIMARY';
  return `${school} ${NUMBER_WORDS[Number(m[2])].toUpperCase()}`;
}

/** "P1" → "Primary 1", "S2" → "Sec 2"; anything else → its label. */
function levelTabPrefix(level: MasterfilePayload['level']): string {
  const m = /^([PS])(\d)$/i.exec(level.code);
  if (!m) return level.label;
  return `${m[1].toUpperCase() === 'S' ? 'Sec' : 'Primary'} ${m[2]}`;
}

/** "Primary" | "Secondary" — the division word in the school's file name. */
export function divisionName(level: MasterfilePayload['level']): string {
  return /^S/i.test(level.code) ? 'Secondary' : 'Primary';
}

/** Excel tab names: ≤31 chars, none of : \ / ? * [ ], unique. */
function tabName(raw: string, taken: Set<string>): string {
  const base = raw
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  let name = base;
  for (let i = 2; taken.has(name); i++)
    name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  taken.add(name);
  return name;
}

/**
 * "Banta, Stephanie Louise, Santos" → "BANTA, Stephanie Louise S." — the
 * school file's name style (surname in capitals, middle-name initial).
 */
function schoolName(row: MasterfileStudentRow): string {
  const parts = (row.fullName || row.studentNumber)
    .split(',')
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (parts.length < 2) return parts[0] ?? row.studentNumber;
  const [last, first, middle] = parts;
  return `${last.toUpperCase()}, ${first}${middle ? ` ${middle[0].toUpperCase()}.` : ''}`;
}

/** A letter-graded term cell: override → derived letter, N.A. when excused. */
function termLetter(
  cell: MasterfileSubjectRow['cells'][number]
): string | null {
  const resolved = resolveNonExaminableLetter({
    isNa: cell.isNa,
    letterOverride: cell.letter,
    quarterly: cell.quarterly,
  });
  return resolved === 'NA' ? 'N.A.' : (resolved ?? null);
}

/** Whether a student has anything recorded in this subject. */
function graded(sr: MasterfileSubjectRow | undefined): boolean {
  return (
    !!sr &&
    (sr.cells.some((c) => c.quarterly != null || c.letter != null || c.isNa) ||
      sr.annualLetter != null)
  );
}

/** The column blocks of one class, from what its students are graded in. */
function blocksFor(
  subjects: MasterfileSubject[],
  rows: MasterfileStudentRow[],
  isSecondary: boolean,
  filters: ConsolidatedFilters
): Block[] {
  const taken = subjects.filter(
    (s) =>
      (!filters.subjectId || s.id === filters.subjectId) &&
      rows.some((r) =>
        graded(r.subjectRows.find((sr) => sr.subjectId === s.id))
      )
  );
  const build = (kind: 'exam' | 'letter', order: [string[], string][]) => {
    const pool = taken.filter((s) => s.isExaminable === (kind === 'exam'));
    const out: Omit<Block, 'fill'>[] = [];
    for (const [codes, label] of order) {
      const hit = pool.filter((s) => codes.includes(s.code.toUpperCase()));
      if (hit.length)
        out.push({ kind, label, subjectIds: hit.map((s) => s.id) });
    }
    // Anything the school's file does not name keeps its own name, after.
    for (const s of pool)
      if (!order.some(([codes]) => codes.includes(s.code.toUpperCase())))
        out.push({ kind, label: s.name, subjectIds: [s.id] });
    return out;
  };
  const exam = build('exam', EXAM_ORDER).map((b, i) => ({
    ...b,
    fill: EXAM_FILLS[i % EXAM_FILLS.length],
  }));
  const letter = build('letter', LETTER_ORDER).map((b, i) => ({
    ...b,
    fill: LETTER_FILLS[i % LETTER_FILLS.length],
  }));
  const academic: Block[] =
    isSecondary && !filters.subjectId
      ? [
          {
            kind: 'academic',
            label: 'Academic',
            subjectIds: [],
            fill: ACADEMIC_FILL,
          },
        ]
      : [];
  // Attendance per term, then the teacher's (evaluation) comments — on every
  // tab, whatever the subject filter, since they are not subjects.
  const attendance: Block[] = TERMS.map((n) => ({
    kind: 'attendance',
    label: `Attendance T${n}`,
    subjectIds: [],
    termNumber: n,
    fill: NAME_HEADER_FILL,
  }));
  const comments: Block = {
    kind: 'comments',
    label: "Teacher's Comments",
    subjectIds: [],
    fill: NAME_HEADER_FILL,
  };
  return [...exam, ...academic, ...letter, ...attendance, comments];
}

function blockWidth(b: Block): number {
  if (b.kind === 'exam') return 6;
  if (b.kind === 'academic') return 2;
  if (b.kind === 'attendance') return 3;
  return 4;
}

/** One student's cells across a tab's blocks. */
function studentCells(
  row: MasterfileStudentRow,
  blocks: Block[],
  lastTerm: number,
  terms: MasterfilePayload['terms']
): (string | number | null)[] {
  const out: (string | number | null)[] = [];
  for (const b of blocks) {
    if (b.kind === 'attendance') {
      const termId = terms.find((t) => t.termNumber === b.termNumber)?.id;
      const att =
        (b.termNumber ?? 0) > lastTerm
          ? undefined
          : row.attendanceByTerm.find((a) => a.termId === termId);
      // `?? null` not `|| null` — a real 0 must print as 0.
      out.push(
        att?.schoolDays ?? null,
        att?.present ?? null,
        att?.late ?? null
      );
      continue;
    }
    if (b.kind === 'comments') {
      for (const n of TERMS) {
        const c = row.commentsByTerm?.find((x) => x.termNumber === n);
        // The write-up is HTML; a cell shows it as text.
        out.push(n > lastTerm || !c ? null : toPlainText(c.text) || null);
      }
      continue;
    }
    if (b.kind === 'academic') {
      out.push(
        row.generalAverage != null
          ? Number(row.generalAverage.toFixed(2))
          : null,
        // No average yet → no award, as in the school's file (never "Not
        // eligible" for a year still being graded).
        row.generalAverage != null ? (row.overallAward ?? null) : null
      );
      continue;
    }
    // MT: whichever of the pair this student is graded in.
    const srs = b.subjectIds
      .map((id) => row.subjectRows.find((sr) => sr.subjectId === id))
      .filter((sr): sr is MasterfileSubjectRow => !!sr);
    const sr = srs.find(graded) ?? srs[0];
    for (const n of TERMS) {
      const cell = sr?.cells[n - 1];
      if (!cell || n > lastTerm) out.push(null);
      else if (b.kind === 'letter') out.push(termLetter(cell));
      else if (cell.isNa) out.push('N.A.');
      else out.push(cell.quarterly);
    }
    if (b.kind === 'exam') {
      const overall = lastTerm >= 4 ? (sr?.overall ?? null) : null;
      out.push(
        overall != null ? Number(overall.toFixed(2)) : null,
        overall != null ? (sr?.award ?? null) : null
      );
    }
  }
  return out;
}

/** The class tabs, in level order then class order. */
function buildTabs(
  payloads: MasterfilePayload[],
  filters: ConsolidatedFilters
): Tab[] {
  const lastTerm = filters.termNumber ?? 4;
  const taken = new Set<string>();
  const tabs: Tab[] = [];
  for (const p of payloads) {
    const isSecondary = /^S/i.test(p.level.code);
    for (const section of p.sections) {
      if (!p.selectedSectionIds.includes(section.id)) continue;
      const rows = p.rows.filter(
        (r) =>
          r.sectionId === section.id &&
          (!filters.status || r.enrollmentStatus === filters.status)
      );
      if (rows.length === 0) continue;
      const blocks = blocksFor(p.subjects, rows, isSecondary, filters);
      // The term in the title: the filter's, else the latest term graded.
      const shownTerm =
        filters.termNumber ??
        Math.max(
          1,
          ...rows.flatMap((r) =>
            r.subjectRows.flatMap((sr) =>
              sr.cells
                .map((c, i) =>
                  c.quarterly != null || c.letter != null ? i + 1 : 0
                )
                .filter(Boolean)
            )
          )
        );
      const teacher = rows.find((r) => r.formClassAdviser)?.formClassAdviser;
      tabs.push({
        name: tabName(`${levelTabPrefix(p.level)} ${section.name}`, taken),
        title: [
          'HFSE INTERNATIONAL SCHOOL',
          'CONSOLIDATED FORM',
          `${levelTitle(p.level)} ${section.name.toUpperCase()}`,
          `AY ${p.ayCode.replace(/^AY/i, '')} - Term ${NUMBER_WORDS[shownTerm] ?? shownTerm}`,
          `Teacher: ${teacher ?? ''}`,
        ],
        blocks,
        rows: rows.map((r, i) => [
          i + 1,
          schoolName(r),
          ...studentCells(r, blocks, lastTerm, p.terms),
        ]),
      });
    }
  }
  return tabs;
}

/** Row 1 and row 2 of a tab, plus the merges on row 2. */
function tabHeader(blocks: Block[]) {
  const row1: (string | null)[] = [null, null];
  const row2: (string | null)[] = ['No', 'Name'];
  const merges: [number, number][] = []; // [firstCol, lastCol], 1-based
  for (const b of blocks) {
    const start = row1.length + 1;
    if (b.kind === 'academic') {
      row1.push('Overall', 'Award');
      row2.push(b.label, null);
      merges.push([start, start + 1]);
      continue;
    }
    if (b.kind === 'attendance') {
      row1.push('School Days', 'Present', 'Late');
      row2.push(b.label, null, null);
      merges.push([start, start + 2]);
      continue;
    }
    row1.push('T1', 'T2', 'T3', 'T4');
    row2.push(b.label, null, null, null);
    merges.push([start, start + 3]);
    if (b.kind === 'exam') {
      row1.push('Overall', 'Award');
      row2.push(b.label, null);
      merges.push([start + 4, start + 5]);
    }
  }
  return { row1, row2, merges };
}

/**
 * Builds the consolidated file as `.xlsx` (Node Buffer). Pass one level's
 * payload or every level of a division, in level order.
 */
export async function buildMasterfileWorkbook(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): Promise<Buffer> {
  const payloads = Array.isArray(input) ? input : [input];
  const tabs = buildTabs(payloads, filters);
  const wb = new ExcelJS.Workbook();
  if (tabs.length === 0) wb.addWorksheet('No students');

  for (const tab of tabs) {
    const ws = wb.addWorksheet(tab.name, {
      properties: { tabColor: { argb: 'FFFFFF00' }, defaultColWidth: 12.63 },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 0 }],
    });
    const { row1, row2, merges } = tabHeader(tab.blocks);
    const totalCols = row2.length;
    // The fill of each column, by its block.
    const colFill: (string | null)[] = [null, null];
    const colKind: (Kind | null)[] = [null, null];
    for (const b of tab.blocks)
      for (let i = 0; i < blockWidth(b); i++) {
        colFill.push(b.fill);
        colKind.push(b.kind);
      }

    ws.getColumn(1).width = 8.88;
    ws.getColumn(2).width = 35.75;
    for (let c = 3; c <= totalCols; c++)
      ws.getColumn(c).width = colKind[c - 1] === 'comments' ? 45 : 8.88;

    // The title block: school, form, class, year and term, teacher.
    tab.title.forEach((line, i) => {
      const cell = ws.getCell(i + 1, 1);
      cell.value = line;
      cell.font = { ...HEADER_FONT, size: i === 0 ? 12 : 10, bold: i < 3 };
    });

    const H = TITLE_ROWS; // the table starts below the title
    ws.getRow(H + 1).height = 14.25;
    ws.getRow(H + 2).height = 26.25;

    [row1, row2].forEach((values, r) => {
      for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(H + r + 1, c);
        const v = values[c - 1];
        if (v != null) cell.value = v;
        if (r === 0 && c <= 2) continue; // empty above No / Name in the school file
        cell.font = HEADER_FONT;
        cell.fill = solid(c <= 2 ? NAME_HEADER_FILL : colFill[c - 1]!);
        cell.border = BOX;
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        };
      }
    });
    for (const [a, b] of merges) ws.mergeCells(H + 2, a, H + 2, b);

    tab.rows.forEach((values, i) => {
      const r = H + i + 3;
      for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(r, c);
        const v = values[c - 1];
        if (v != null && v !== '') cell.value = v;
        cell.border = BOX;
        if (c === 2) {
          cell.font = NAME_FONT;
          cell.alignment = { vertical: 'bottom' };
          continue;
        }
        const kind = colKind[c - 1];
        if (kind === 'comments') {
          cell.font = NAME_FONT;
          cell.alignment = { vertical: 'top', wrapText: true };
          continue;
        }
        // Letter grades are Arial 10 in the school file; numbers Aptos Narrow.
        cell.font = kind === 'letter' ? NAME_FONT : NUMBER_FONT;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (kind !== 'attendance') cell.fill = solid(colFill[c - 1]!);
      }
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The tab names the file would carry — for the route's filename and tests. */
export function consolidatedTabNames(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): string[] {
  return buildTabs(Array.isArray(input) ? input : [input], filters).map(
    (t) => t.name
  );
}

const HEADER_FONT = {
  name: 'Arial',
  size: 10,
  bold: true,
  color: { argb: 'FF000000' },
};
const NAME_FONT = { name: 'Arial', size: 10, color: { argb: 'FF000000' } };
const NUMBER_FONT = {
  name: 'Aptos Narrow',
  size: 11,
  color: { argb: 'FF000000' },
};
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

// ---------------------------------------------------------------------------
// CSV — the same grid, without the colours. A CSV has no tabs, so each tab
// follows the last under its own name, a blank row between.
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

/**
 * The consolidated file as an RFC-4180 CSV with a leading UTF-8 BOM (so Excel
 * opens it correctly — the project's drill CSV convention, KD #56).
 */
export function masterfileToCsv(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): string {
  const tabs = buildTabs(Array.isArray(input) ? input : [input], filters);
  const lines: string[] = [];
  tabs.forEach((tab, i) => {
    if (i > 0) lines.push('');
    for (const line of tab.title) lines.push(csvEscape(line));
    const { row1, row2 } = tabHeader(tab.blocks);
    for (const row of [row1, row2, ...tab.rows])
      lines.push(row.map(csvEscape).join(','));
  });
  return '﻿' + lines.join('\r\n');
}

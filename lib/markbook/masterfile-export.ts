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

// HFSE Masterfile → the school's CONSOLIDATED FORM (KD #95).
//
// A COPY of the registrar's own "Term 2 CONSOLIDATED FORM.xlsx"
// (AY2026/T2/ in the repo; Mr Ace, 2026-10-28: "everything must be a clear
// copy of their template"). Only the values are the SIS's; the layout, words,
// colours, fonts, widths and merges are the school's:
//
//   ONE TERM per file, ONE TAB per class ("P1-Patience", "S1-Discipline 1").
//   A1:O1…A5:O5  " HFSE INTERNATIONAL SCHOOL" · CONSOLIDATED FORM ·
//                PRIMARY ONE PATIENCE · AY 2026 - Term Two · Teacher: <adviser>
//   Row 6        a 1.5pt spacer
//   Rows 7–8     Index Number · NAME · one column per subject (merged down) ·
//                Attendance over Number of School Days / Days Late / Days
//                Present · Remarks · Notes/Comment · Student(s) Evaluation
//   Rows 9+      one per student: index number, name, that term's grade per
//                subject (letters for STAR / CA / PE), that term's
//                attendance, Remarks + Notes left for the checker (Remarks
//                has the school's dropdown), that term's evaluation write-up
//   Footer       a blank row, "Aligned with DepEd Order No. 8, s. 2015", and
//                the school's empty notes box below it
//
// Subjects sit in columns C–J. Primary takes five (English, Math, Mother
// Tongue, Science, STAR) and keeps H–J as the school does — hidden — so the
// attendance block lands in K–M on every tab. Secondary fills all eight.
//
// The page's filters narrow it: grade level and class pick the tabs, subject
// the subject columns, term which term the file is (default: the latest term
// with grades), status the students. The CSV is the same rows, no styling.

export type ConsolidatedFilters = {
  subjectId?: string | null;
  termNumber?: number | null;
  status?: 'active' | 'late_enrollee' | 'withdrawn' | null;
};

/** A subject column: its header words, fill, and the SIS subjects behind it. */
type SubjectCol = {
  label: string;
  fill: string;
  letter: boolean;
  subjectIds: string[];
};

type Tab = {
  name: string;
  secondary: boolean;
  title: string[];
  cols: SubjectCol[];
  rows: (string | number | null)[][];
};

// Each subject in the school's words and header colour, in the school's
// column order. Spreadsheet colours, not UI tokens — Hard Rule #7 covers
// app/ and components/.
type SubjectSpec = { codes: string[]; label: string; fill: string };

// Mandarin and Filipino share the form's ONE Mother Tongue column; its
// header names the language — "Mother Tongue (Mandarin)" — when the class
// takes just one.
const MT_CODES = ['MANDARIN', 'FIL'];
const MT_NAMES: Record<string, string> = {
  MANDARIN: 'Mandarin',
  FIL: 'Filipino',
};

const PRIMARY_SUBJECTS: SubjectSpec[] = [
  { codes: ['ENG'], label: 'English', fill: 'FF6AA84F' },
  { codes: ['MATH'], label: 'Math', fill: 'FFFBBC04' },
  { codes: MT_CODES, label: 'Mother Tongue', fill: 'FFA70D8C' },
  { codes: ['SCI'], label: 'Science', fill: 'FFFFF2CC' },
  { codes: ['STAR'], label: 'STAR', fill: 'FFC9DAF8' },
];

const SECONDARY_SUBJECTS: SubjectSpec[] = [
  { codes: ['ENG'], label: 'English', fill: 'FFFFFF00' },
  { codes: ['MATH'], label: 'Math', fill: 'FF00FFFF' },
  { codes: ['SCI'], label: 'Science', fill: 'FF9FC5E8' },
  { codes: MT_CODES, label: 'Mother Tongue', fill: 'FFFF0000' },
  { codes: ['HUM'], label: 'Humanities', fill: 'FF1155CC' },
  { codes: ['SS'], label: 'Social Studies', fill: 'FF4A86E8' },
  { codes: ['GP'], label: 'Global Perspectives', fill: 'FFEAD1DC' },
  { codes: ['HIST'], label: 'History', fill: 'FF1155CC' },
  { codes: ['LIT'], label: 'Literature', fill: 'FFEAD1DC' },
  { codes: ['COMP'], label: 'Computing', fill: 'FFFF0000' },
  { codes: ['CA'], label: 'Contemporary Art', fill: 'FFB6D7A8' },
  { codes: ['ARTD'], label: 'Art & Design', fill: 'FFB6D7A8' },
  { codes: ['PESTD'], label: 'Physical Education', fill: 'FFB6D7A8' },
  { codes: ['PEH'], label: 'PE & Health', fill: 'FFB6D7A8' },
];

/** Columns C–J: eight subject columns, the unused ones hidden. */
const SUBJECT_SLOTS = 8;
const SPARE_FILL = 'FFE69138';

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** "P1" → "PRIMARY ONE", "S2" → "SECONDARY TWO"; else the label, capitals. */
function levelTitle(level: MasterfilePayload['level']): string {
  const m = /^([PS])(\d)$/i.exec(level.code);
  if (!m || !NUMBER_WORDS[Number(m[2])]) return level.label.toUpperCase();
  const school = m[1].toUpperCase() === 'S' ? 'SECONDARY' : 'PRIMARY';
  return `${school} ${NUMBER_WORDS[Number(m[2])].toUpperCase()}`;
}

/** "Primary" | "Secondary" — the division word in a file name. */
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

/** The subject columns of one class, from what its students are graded in. */
function columnsFor(
  subjects: MasterfileSubject[],
  rows: MasterfileStudentRow[],
  secondary: boolean,
  filters: ConsolidatedFilters
): SubjectCol[] {
  const taken = subjects.filter(
    (s) =>
      (!filters.subjectId || s.id === filters.subjectId) &&
      rows.some((r) =>
        graded(r.subjectRows.find((sr) => sr.subjectId === s.id))
      )
  );
  const specs = secondary ? SECONDARY_SUBJECTS : PRIMARY_SUBJECTS;
  const cols: SubjectCol[] = [];
  for (const spec of specs) {
    const hit = taken.filter((s) => spec.codes.includes(s.code.toUpperCase()));
    if (hit.length)
      cols.push({
        label:
          spec.codes === MT_CODES && hit.length === 1
            ? `${spec.label} (${MT_NAMES[hit[0].code.toUpperCase()]})`
            : spec.label,
        fill: spec.fill,
        letter: !hit[0].isExaminable,
        subjectIds: hit.map((s) => s.id),
      });
  }
  // A subject the school's form does not name keeps its own name, after.
  for (const s of taken)
    if (!specs.some((spec) => spec.codes.includes(s.code.toUpperCase())))
      cols.push({
        label: s.name,
        fill: 'FFD9D9D9',
        letter: !s.isExaminable,
        subjectIds: [s.id],
      });
  // The school's order: examinable subjects, then the letter-graded ones.
  return [...cols.filter((c) => !c.letter), ...cols.filter((c) => c.letter)];
}

/** Every term with a grade, attendance or write-up in these classes. */
function recordedTerms(payloads: MasterfilePayload[]): number[] {
  const seen = new Set<number>();
  for (const p of payloads) {
    const termNo = new Map(p.terms.map((t) => [t.id, t.termNumber]));
    for (const r of p.rows) {
      for (const sr of r.subjectRows)
        sr.cells.forEach((c, i) => {
          if (c.quarterly != null || c.letter != null) seen.add(i + 1);
        });
      for (const a of r.attendanceByTerm)
        if (a.schoolDays != null) seen.add(termNo.get(a.termId) ?? 0);
      for (const c of r.commentsByTerm ?? []) seen.add(c.termNumber);
    }
  }
  const terms = [1, 2, 3, 4].filter((n) => seen.has(n));
  return terms.length ? terms : [1];
}

function buildTabs(
  payloads: MasterfilePayload[],
  filters: ConsolidatedFilters
): { terms: number[]; tabs: Tab[] } {
  // A term picked in the filter → that term's form. "All terms" → every
  // term with anything recorded, one form each, in term order.
  const terms = filters.termNumber
    ? [filters.termNumber]
    : recordedTerms(payloads);
  const taken = new Set<string>();
  const tabs: Tab[] = [];
  for (const term of terms)
    for (const p of payloads) {
      const secondary = /^S/i.test(p.level.code);
      const termId = p.terms.find((t) => t.termNumber === term)?.id;
      for (const section of p.sections) {
        if (!p.selectedSectionIds.includes(section.id)) continue;
        const rows = p.rows.filter(
          (r) =>
            r.sectionId === section.id &&
            (!filters.status || r.enrollmentStatus === filters.status)
        );
        if (rows.length === 0) continue;
        const cols = columnsFor(p.subjects, rows, secondary, filters);
        const teacher = rows.find((r) => r.formClassAdviser)?.formClassAdviser;
        tabs.push({
          name: tabName(
            `${terms.length > 1 ? `T${term} ` : ''}${p.level.code}-${section.name}`,
            taken
          ),
          secondary,
          title: [
            ' HFSE INTERNATIONAL SCHOOL',
            'CONSOLIDATED FORM',
            `${levelTitle(p.level)} ${section.name.toUpperCase()}`,
            `AY ${p.ayCode.replace(/^AY/i, '')} - Term ${NUMBER_WORDS[term] ?? term}`,
            `Teacher: ${teacher ?? ''}`,
          ],
          cols,
          rows: rows.map((r, i) => {
            const grades = cols.map((col) => {
              // Mother Tongue etc.: whichever of the subjects this student takes.
              const srs = col.subjectIds
                .map((id) => r.subjectRows.find((sr) => sr.subjectId === id))
                .filter((sr): sr is MasterfileSubjectRow => !!sr);
              const cell = (srs.find(graded) ?? srs[0])?.cells[term - 1];
              if (!cell) return null;
              if (col.letter) return termLetter(cell);
              return cell.isNa ? 'N.A.' : cell.quarterly;
            });
            const att = r.attendanceByTerm.find((a) => a.termId === termId);
            const comment = r.commentsByTerm?.find(
              (c) => c.termNumber === term
            );
            return [
              r.indexNumber ?? i + 1,
              schoolName(r),
              ...grades,
              // School Days · Days Late · Days Present — the form's order.
              // `?? null` not `|| null`: a real 0 prints as 0.
              att?.schoolDays ?? null,
              att?.late ?? null,
              att?.present ?? null,
              null, // Remarks — the checker's dropdown
              null, // Notes/Comment
              comment ? toPlainText(comment.text) || null : null,
            ];
          }),
        });
      }
    }
  return { terms, tabs };
}

/**
 * Builds the CONSOLIDATED FORM as `.xlsx` (Node Buffer). Pass one level's
 * payload or several (P1–S4), in level order.
 */
export async function buildMasterfileWorkbook(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): Promise<Buffer> {
  const { tabs } = buildTabs(Array.isArray(input) ? input : [input], filters);
  const wb = new ExcelJS.Workbook();
  if (tabs.length === 0) wb.addWorksheet('No students');

  for (const tab of tabs) {
    const ws = wb.addWorksheet(tab.name, {
      properties: { tabColor: { argb: 'FF00FF00' } },
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });
    // Subject columns fill C onward; Primary's spare slots stay, hidden.
    const slots = Math.max(SUBJECT_SLOTS, tab.cols.length);
    const first = 3; // C
    const att = first + slots; // K on the school's form
    const remarks = att + 3;
    const notes = remarks + 1;
    const evaluation = notes + 1;
    const lastTitleCol = notes; // the title rows span A:O

    // Widths, as the school's form sets them.
    ws.getColumn(1).width = 8.43;
    ws.getColumn(2).width = tab.secondary ? 33.57 : 27.57;
    for (let c = first; c < att + 3; c++) ws.getColumn(c).width = 10.14;
    if (!tab.secondary) ws.getColumn(5).width = 11.71; // Mother Tongue
    ws.getColumn(notes).width = tab.secondary ? 23.71 : 21.86;
    ws.getColumn(evaluation).width = tab.secondary ? 45.71 : 40.86;

    // Title block.
    tab.title.forEach((line, i) => {
      ws.mergeCells(i + 1, 1, i + 1, lastTitleCol);
      const cell = ws.getCell(i + 1, 1);
      cell.value = line;
      cell.font = {
        name: 'Arial',
        size: i === 4 ? 11 : 16,
        bold: true,
        color: BLACK,
      };
      cell.alignment = { horizontal: 'center' };
    });
    ws.getRow(6).height = 1.5;
    ws.getRow(8).height = 73.5;

    // Header rows 7–8.
    const head = (
      c: number,
      value: string | null,
      fill: string,
      color = BLACK
    ) => {
      const cell = ws.getCell(7, c);
      cell.value = value;
      cell.font = { name: 'Arial', size: 11, bold: true, color };
      cell.fill = solid(fill);
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = BOX;
      ws.getCell(8, c).border = BOX;
      ws.mergeCells(7, c, 8, c);
    };
    head(1, 'Index Number', 'FFFFFFFF', NAME_BLUE);
    head(2, 'NAME', 'FFFFFFFF', NAME_BLUE);
    for (let i = 0; i < slots; i++) {
      const col = tab.cols[i];
      head(first + i, col?.label ?? null, col?.fill ?? SPARE_FILL);
      if (!col) ws.getColumn(first + i).hidden = true;
    }
    ws.mergeCells(7, att, 7, att + 2);
    const attHead = ws.getCell(7, att);
    attHead.value = 'Attendance';
    attHead.font = { name: 'Arial', size: 11, bold: true, color: BLACK };
    attHead.fill = solid(tab.secondary ? 'FFC9DAF8' : 'FF3D85C6');
    attHead.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    attHead.border = BOX;
    [
      'Number of School Days ',
      'Number of Days Late',
      'Number of Days Present',
    ].forEach((label, i) => {
      const cell = ws.getCell(8, att + i);
      cell.value = label;
      cell.font = { name: 'Arial', size: 11, bold: true, color: BLACK };
      cell.fill = solid(tab.secondary ? 'FFC9DAF8' : 'FFD9D2E9');
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = BOX;
    });
    head(remarks, 'Remarks', 'FFFFE599');
    head(notes, 'Notes/Comment', 'FFB4A7D6');
    head(
      evaluation,
      tab.secondary ? 'Student Evaluation' : 'Students Evaluation',
      'FFC9DAF8'
    );

    // Student rows.
    tab.rows.forEach((values, i) => {
      const r = 9 + i;
      const put = (c: number, v: string | number | null) => {
        const cell = ws.getCell(r, c);
        if (v != null) cell.value = v;
        cell.border = BOX;
        return cell;
      };
      const [index, name, ...rest] = values;
      const grades = rest.slice(0, tab.cols.length);
      const [days, late, present, , , evalText] = rest.slice(tab.cols.length);

      Object.assign(put(1, index), {
        font: { name: 'Arial', size: 11, color: BLACK },
        alignment: { horizontal: 'center' },
      });
      Object.assign(put(2, name), {
        font: { name: 'Arial', size: 10, color: BLACK },
        fill: solid('FFFFFFFF'),
      });
      for (let k = 0; k < slots; k++) {
        const col = tab.cols[k];
        const cell = put(first + k, col ? (grades[k] ?? null) : null);
        cell.alignment = { horizontal: 'center' };
        cell.font = col?.letter
          ? { name: 'Arial', size: 12, bold: true, color: LETTER_BLUE }
          : { name: 'Arial', size: 10, color: BLACK };
        if (col && !col.letter) cell.numFmt = '0';
      }
      [days, late, present].forEach((v, k) =>
        Object.assign(put(att + k, v ?? null), {
          font: { name: 'Calibri', size: 13, bold: true, color: BLACK },
          alignment: { horizontal: 'center' },
        })
      );
      const remark = put(remarks, null);
      remark.font = { name: 'Calibri', size: 11, color: BLACK };
      remark.dataValidation = REMARKS_LIST;
      put(notes, null).font = { name: 'Calibri', size: 11, color: BLACK };
      Object.assign(put(evaluation, evalText ?? null), {
        font: { name: 'Arial', size: 10, color: BLACK },
        alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
      });
    });

    // Footer: a blank row, the DepEd line across A:N, the empty notes box A:O.
    const footer = 9 + tab.rows.length + 1;
    ws.mergeCells(footer, 1, footer, remarks);
    const deped = ws.getCell(footer, 1);
    deped.value = 'Aligned with DepEd Order No. 8, s. 2015';
    deped.font = {
      name: 'Arial',
      size: 11,
      bold: true,
      italic: true,
      color: BLACK,
    };
    deped.alignment = { horizontal: 'center' };
    ws.mergeCells(footer + 1, 1, footer + 17, notes);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The tab names the file would carry — for tests. */
export function consolidatedTabNames(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): string[] {
  return buildTabs(Array.isArray(input) ? input : [input], filters).tabs.map(
    (t) => t.name
  );
}

/** The terms the file holds — the route names the file with them. */
export function consolidatedTerms(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): number[] {
  return buildTabs(Array.isArray(input) ? input : [input], filters).terms;
}

const BLACK = { argb: 'FF000000' };
const NAME_BLUE = { argb: 'FF548DD4' };
const LETTER_BLUE = { argb: 'FF0066CC' };
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const REMARKS_LIST: ExcelJS.DataValidation = {
  type: 'list',
  allowBlank: true,
  showErrorMessage: true,
  formulae: ['"No Correction (Verified),With Correction (See Notes/Comment)"'],
};

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

// ---------------------------------------------------------------------------
// CSV — the same rows, without the styling. A CSV has no tabs, so each class
// follows the last, a blank row between.
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
 * The CONSOLIDATED FORM as an RFC-4180 CSV with a leading UTF-8 BOM (so Excel
 * opens it correctly — the project's drill CSV convention, KD #56).
 */
export function masterfileToCsv(
  input: MasterfilePayload | MasterfilePayload[],
  filters: ConsolidatedFilters = {}
): string {
  const { tabs } = buildTabs(Array.isArray(input) ? input : [input], filters);
  const lines: string[] = [];
  tabs.forEach((tab, i) => {
    if (i > 0) lines.push('');
    for (const line of tab.title) lines.push(csvEscape(line));
    const subjects = tab.cols.map((c) => c.label);
    const blanks = subjects.map(() => '');
    const evalLabel = tab.secondary
      ? 'Student Evaluation'
      : 'Students Evaluation';
    for (const row of [
      [
        'Index Number',
        'NAME',
        ...subjects,
        'Attendance',
        '',
        '',
        'Remarks',
        'Notes/Comment',
        evalLabel,
      ],
      [
        '',
        '',
        ...blanks,
        'Number of School Days ',
        'Number of Days Late',
        'Number of Days Present',
        '',
        '',
        '',
      ],
      ...tab.rows,
      [],
      ['Aligned with DepEd Order No. 8, s. 2015'],
    ])
      lines.push(row.map(csvEscape).join(','));
  });
  return '﻿' + lines.join('\r\n');
}

import 'server-only';

import * as XLSX from 'xlsx';

import { resolveNonExaminableLetter } from '@/lib/compute/letter-grade';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
} from '@/lib/markbook/masterfile';

// HFSE Masterfile → Excel report-book export (KD #95).
//
// Pure generation from the already-computed `MasterfilePayload` (the same data
// the on-screen grid renders). No spreadsheet input, no DB reads — the route
// loads the payload via `loadMasterfile`, then hands it here.
//
// Sheet layout mirrors the AY Final Report Book Masterfile:
//   Row 1 (group header): Identity block · one merged group per examinable
//     subject · one merged group per non-examinable subject · Overall Academic
//     Award · Attendance · Teacher's Comments.
//   Row 2 (sub-header): per-subject Term 1/2/3/4 · Overall · Award (examinable)
//     or Term 1–4 (non-exam); attendance School Days/Present/Late per term plus
//     totals.
//   Rows 3+: one per student.
//
// Correctness > pixel-perfect merges — column counts and merge spans are
// derived from the payload shape so they always line up with the data rows.

const IDENTITY_HEADERS = [
  'S/N',
  'Student Name',
  'Student No.',
  'Level',
  'Class',
  'Form Class Adviser',
  'Status',
] as const;

const EXAMINABLE_SUBCOLS = [
  'Term 1',
  'Term 2',
  'Term 3',
  'Term 4',
  'Overall',
  'Award',
] as const;

// Non-examinable subjects render T1–T4 derived/override letters PLUS a Final
// column (the registrar-entered year-end letter) — mirrors the on-screen grid's
// T1·T2·T3·T4·Final layout (KD #95). The 5-wide span must match the grid or
// every group-merge + downstream column index drifts off by one per subject.
const NONEXAM_SUBCOLS = [
  'Term 1',
  'Term 2',
  'Term 3',
  'Term 4',
  'Final',
] as const;

const OVERALL_AWARD_SUBCOLS = ['General Average', 'Award'] as const;

function statusLabel(status: string): string {
  if (status === 'late_enrollee') return 'Late Enrolment';
  if (status === 'withdrawn') return 'Withdrawn';
  return 'Active';
}

function commentsText(row: MasterfileStudentRow): string {
  if (!row.commentsByTerm || row.commentsByTerm.length === 0) return '';
  return row.commentsByTerm
    .map((c) => `T${c.termNumber}: ${c.text}`)
    .join('\n\n');
}

/**
 * Builds an `.xlsx` workbook from the computed Masterfile payload and returns
 * it as a Node Buffer (`Content-Type` xlsx). Server-only.
 */
export function buildMasterfileWorkbook(payload: MasterfilePayload): Buffer {
  const examinable = payload.subjects.filter((s) => s.isExaminable);
  const nonExam = payload.subjects.filter((s) => !s.isExaminable);
  const terms = payload.terms; // already ordered by term_number

  // Attendance sub-columns: per term (School Days/Present/Late) + totals.
  const attendancePerTermSubcols: string[] = [];
  for (const t of terms) {
    attendancePerTermSubcols.push(
      `T${t.termNumber} School Days`,
      `T${t.termNumber} Present`,
      `T${t.termNumber} Late`
    );
  }
  const attendanceTotalSubcols = [
    'Total School Days',
    'Total Present',
    'Total Late',
  ];

  // ---- Header rows (two rows: group + sub-header) ----
  const groupRow: (string | number)[] = [];
  const subRow: (string | number)[] = [];
  const merges: XLSX.Range[] = [];

  let col = 0;

  // Identity block: each column is its own group (merged vertically r0..r1).
  for (const h of IDENTITY_HEADERS) {
    groupRow.push(h);
    subRow.push('');
    merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
    col++;
  }

  // Examinable subjects: 6 sub-columns each, group merged horizontally.
  for (const sub of examinable) {
    const start = col;
    groupRow.push(sub.name);
    subRow.push(EXAMINABLE_SUBCOLS[0]);
    col++;
    for (let i = 1; i < EXAMINABLE_SUBCOLS.length; i++) {
      groupRow.push('');
      subRow.push(EXAMINABLE_SUBCOLS[i]);
      col++;
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: col - 1 } });
  }

  // Non-examinable subjects: 4 term sub-columns each.
  for (const sub of nonExam) {
    const start = col;
    groupRow.push(sub.name);
    subRow.push(NONEXAM_SUBCOLS[0]);
    col++;
    for (let i = 1; i < NONEXAM_SUBCOLS.length; i++) {
      groupRow.push('');
      subRow.push(NONEXAM_SUBCOLS[i]);
      col++;
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: col - 1 } });
  }

  // Overall Academic Award block: General Average + Award.
  {
    const start = col;
    groupRow.push('Overall Academic Award');
    subRow.push(OVERALL_AWARD_SUBCOLS[0]);
    col++;
    for (let i = 1; i < OVERALL_AWARD_SUBCOLS.length; i++) {
      groupRow.push('');
      subRow.push(OVERALL_AWARD_SUBCOLS[i]);
      col++;
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: col - 1 } });
  }

  // Attendance block: per-term (School Days/Present/Late) + totals.
  {
    const start = col;
    const allAttSub = [...attendancePerTermSubcols, ...attendanceTotalSubcols];
    groupRow.push('Attendance');
    subRow.push(allAttSub[0]);
    col++;
    for (let i = 1; i < allAttSub.length; i++) {
      groupRow.push('');
      subRow.push(allAttSub[i]);
      col++;
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: col - 1 } });
  }

  // Teacher's Comments: single column, merged vertically.
  groupRow.push("Teacher's Comments");
  subRow.push('');
  merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
  col++;

  const totalCols = col;

  // ---- Data rows ----
  const dataRows: (string | number)[][] = [];
  payload.rows.forEach((row) => {
    const cells: (string | number)[] = [];
    // S/N = the student's permanent per-section index number (KD #85 rule:
    // index numbers are permanent roll numbers, never renumbered by position).
    cells.push(row.indexNumber ?? '');
    cells.push(row.fullName || row.studentNumber);
    cells.push(row.studentNumber);
    cells.push(payload.level.label);
    cells.push(row.sectionName);
    cells.push(row.formClassAdviser ?? '');
    cells.push(statusLabel(row.enrollmentStatus));

    const subjectRowById = new Map(
      row.subjectRows.map((sr) => [sr.subjectId, sr])
    );

    // Examinable: T1-T4 quarterly, Overall (2dp), Award.
    for (const sub of examinable) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('', '', '', '', '', '');
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

    // Non-examinable: T1-T4 derived/override letters + Final (year-end letter).
    for (const sub of nonExam) {
      const sr = subjectRowById.get(sub.id);
      if (!sr) {
        cells.push('', '', '', '', '');
        continue;
      }
      for (const cell of sr.cells) {
        const resolved = resolveNonExaminableLetter({
          isNa: cell.isNa,
          letterOverride: cell.letter,
          quarterly: cell.quarterly,
        });
        cells.push(resolved === 'NA' ? 'N.A.' : (resolved ?? ''));
      }
      // Final column — the registrar-entered year-end letter (KD #100). Mirrors
      // exactly what the grid's Final cell shows (sr.annualLetter, or blank when
      // no T4 entry / not yet set; the grid renders "—" for the same null).
      cells.push(sr.annualLetter ?? '');
    }

    // Overall Academic Award: General Average (1dp) + Award.
    cells.push(
      row.generalAverage != null ? Number(row.generalAverage.toFixed(1)) : ''
    );
    cells.push(row.overallAward ?? '');

    // Attendance per term + totals.
    for (const att of row.attendanceByTerm) {
      cells.push(att.schoolDays ?? '');
      cells.push(att.present ?? '');
      cells.push(att.late ?? '');
    }
    // `?? ''` not `|| ''` — a real 0 (e.g. withdrawn / no attendance) must
    // print as 0 so downstream SUMs stay correct, not collapse to blank.
    cells.push(row.attendanceTotal.schoolDays ?? '');
    cells.push(row.attendanceTotal.present ?? '');
    cells.push(row.attendanceTotal.late ?? '');

    // Teacher's Comments (joined T1-T3).
    cells.push(commentsText(row));

    dataRows.push(cells);
  });

  const aoa: (string | number)[][] = [groupRow, subRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;

  // Column widths — identity columns wider, comments widest.
  const colWidths: { wch: number }[] = [];
  for (let c = 0; c < totalCols; c++) {
    if (c === 1)
      colWidths.push({ wch: 28 }); // Student Name
    else if (c === 5)
      colWidths.push({ wch: 22 }); // Form Class Adviser
    else if (c === totalCols - 1)
      colWidths.push({ wch: 60 }); // Comments
    else colWidths.push({ wch: 8 });
  }
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Masterfile');

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return out as Buffer;
}

// ---------------------------------------------------------------------------
// Flat CSV helper — same column ORDER as the xlsx workbook, single header row.
//
// Used by the `?format=csv` branch in the export route so the two export
// formats share the same column set and can't drift independently.
//
// Column order (mirrors buildMasterfileWorkbook exactly):
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
  payload: MasterfilePayload
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

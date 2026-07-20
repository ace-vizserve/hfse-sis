// lib/sis/backfill/attendance/attendance-workbook-t2.ts
// Parses HFSE's real T2 attendance workbook (per-section sheet tabs) into
// the same roster shape Phase 2's T1 import already produces, reusing
// Phase 2's `parseSheet` as-is for the roster grid — T2's two extra
// leading columns (Bus No., Classroom Officers) don't break it, since
// `parseSheet` locates the date columns and the Full Name column
// dynamically (regex + relative offset), never by a fixed index. See
// docs/superpowers/specs/2026-07-18-ay2026-t2-attendance-import-design.md
// Locked Decision #3.
//
// The one genuinely new piece is `extractDateAlignedLabels`: T2's
// masthead prints each event's label directly in the date column it
// falls on, on the row directly above the date-header row (Locked
// Decision #5) — a different, more reliable shape than T1's free-text
// "School Holiday"/"Important dates" legend table, which T2 does not use
// at all.
import * as XLSX from 'xlsx';

import {
  parseSheet,
  type ParsedSection,
} from '../enrollment/attendance-workbook';

export interface ParsedSectionWithLabels {
  section: ParsedSection;
  // Date-column header string (e.g. "3-Apr") -> the label printed in that
  // column on the row directly above the date-header row. Only non-blank
  // cells are included.
  dateLabels: Record<string, string>;
}

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;

// Re-derives just enough of the header-row location to find the row
// directly above it — `parseSheet` doesn't expose `headerRowIdx` or the
// date column indices, so this is a small, independent re-scan (not a
// re-implementation of the roster/mark parsing itself, which stays fully
// owned by `parseSheet`).
export function extractDateAlignedLabels(
  ws: XLSX.WorkSheet
): Record<string, string> {
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });

  const headerRowIdx = rows.findIndex((r) =>
    r.some((c) => DATE_COL_RE.test(c.trim()))
  );
  if (headerRowIdx <= 0) return {};

  const header = rows[headerRowIdx];
  const labelRow = rows[headerRowIdx - 1] ?? [];
  const dateLabels: Record<string, string> = {};
  header.forEach((cell, colIdx) => {
    if (!DATE_COL_RE.test(cell.trim())) return;
    const label = (labelRow[colIdx] ?? '').trim();
    if (label) dateLabels[cell.trim()] = label;
  });
  return dateLabels;
}

export function parseSheetT2(
  ws: XLSX.WorkSheet,
  sheetName: string
): ParsedSectionWithLabels {
  return {
    section: parseSheet(ws, sheetName),
    dateLabels: extractDateAlignedLabels(ws),
  };
}

export function parseWorkbookT2(filePath: string): ParsedSectionWithLabels[] {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map((name) => parseSheetT2(wb.Sheets[name], name));
}

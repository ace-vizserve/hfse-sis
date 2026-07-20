// lib/sis/backfill/enrollment/attendance-workbook.ts
// Parses HFSE's real T1 attendance workbook (per-section sheet tabs, a
// 9-row masthead, a dated-column roster) into structured data. Pure
// extraction only — no name matching, no section-name cleanup (see
// name-match.ts / section-identity.ts for those), no day-type
// classification (see attendance/day-classifier.ts).
import * as XLSX from 'xlsx';

export interface RosterStudent {
  indexNo: string;
  fullName: string;
  // Date-column header string (e.g. "8-Jan") → trimmed cell value ("P" /
  // "A" / "EX" / "L" / "" for a blank/no-class day).
  marks: Record<string, string>;
}

export interface LegendRawEntry {
  rawText: string;
  column: 'schoolHoliday' | 'importantDates';
}

export interface ParsedSection {
  sheetName: string;
  classSectionLabel: string | null;
  formTeacher: string | null;
  students: RosterStudent[];
  firstDate: string | null;
  lastDate: string | null;
  // The ordered list of date-column header strings (e.g. ['8-Jan', ...]).
  dateColumns: string[];
  // Non-blank name-column values that were rejected for lacking a comma
  // (e.g. the stray second-table "Name" header artifact) — tracked so a
  // human reviewer can confirm none of these are actually real students
  // with a data-entry quirk. Always [] when nothing was rejected.
  rejectedNames: string[];
  // Raw masthead legend cells (holiday/event notes), unparsed — see
  // attendance/legend-parser.ts for turning these into resolved dates.
  legendEntries: LegendRawEntry[];
}

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;
const LEGEND_HEADER_LABELS: Record<string, LegendRawEntry['column']> = {
  'School Holiday': 'schoolHoliday',
  'Important dates': 'importantDates',
};

// Scans the masthead rows for a cell exactly matching `label`, and returns
// the very next cell in that row (the file always puts the value
// immediately after the label, though the label's own column position
// varies between YS and the Primary/Secondary sheets).
function findLabelValue(rows: string[][], label: string): string | null {
  for (const row of rows) {
    const idx = row.findIndex((c) => c.trim() === label);
    if (idx !== -1 && idx + 1 < row.length) {
      const value = row[idx + 1].trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

// Scans the masthead's legend header row (row index 1) for every "School
// Holiday" / "Important dates" column — the file repeats this pair once
// per month block (Jan/Feb/Mar) at column positions that shift slightly
// between sheets, so headers are located dynamically, never by fixed
// index — then collects every non-blank cell found in that same column
// across the rows below it (rows 2 through the end of the masthead
// window) as one legend entry.
function extractLegendEntries(mastheadRows: string[][]): LegendRawEntry[] {
  const headerRow = mastheadRows[1] ?? [];
  const entries: LegendRawEntry[] = [];
  headerRow.forEach((cell, colIdx) => {
    const column = LEGEND_HEADER_LABELS[cell.trim()];
    if (!column) return;
    for (let rowIdx = 2; rowIdx < mastheadRows.length; rowIdx++) {
      const text = (mastheadRows[rowIdx]?.[colIdx] ?? '').trim();
      if (text) entries.push({ rawText: text, column });
    }
  });
  return entries;
}

export function parseSheet(
  ws: XLSX.WorkSheet,
  sheetName: string
): ParsedSection {
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });

  const mastheadRows = rows.slice(0, 9);
  const classSectionLabel = findLabelValue(mastheadRows, 'Class Section');
  const formTeacher = findLabelValue(mastheadRows, 'Form Teacher');
  const legendEntries = extractLegendEntries(mastheadRows);

  const headerRowIdx = rows.findIndex((r) =>
    r.some((c) => DATE_COL_RE.test(c.trim()))
  );
  if (headerRowIdx === -1) {
    return {
      sheetName,
      classSectionLabel,
      formTeacher,
      students: [],
      firstDate: null,
      lastDate: null,
      dateColumns: [],
      rejectedNames: [],
      legendEntries,
    };
  }

  const header = rows[headerRowIdx];
  const dateColIndices = header.reduce<number[]>((acc, c, i) => {
    if (DATE_COL_RE.test(c.trim())) acc.push(i);
    return acc;
  }, []);
  const dateColumns = dateColIndices.map((idx) => header[idx].trim());
  // The roster's "Full Name" column always sits immediately before the
  // first dated column (Index No / Bus No / Leave [/ Classroom Officers] /
  // Full Name / dates...) — safer than matching the header text, which is
  // sometimes blank in real sheets even though the data column is present.
  const nameColIdx = Math.min(...dateColIndices) - 1;
  const indexColIdx = 0;

  const students: RosterStudent[] = [];
  const rejectedNames: string[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const fullName = (row[nameColIdx] ?? '').trim();
    // Every real sheet has a second, unrelated mini-table further down with
    // its own header row containing the literal text "Name" in this same
    // column (positional coincidence, not a real roster row) — and on fully
    // empty "Reserved" sheets, that stray label is the ONLY non-blank value
    // in the column. Genuine names in this file are always
    // "LASTNAME, First Middle." (always contains a comma); the stray label
    // never does, so reject non-comma values the same way blanks are.
    // Rejections are tracked (not just silently dropped) so a human
    // reviewer can confirm none of them are actually real students with a
    // data-entry quirk (blank comma, single-word name, merge glitch).
    if (!fullName) continue;
    if (!fullName.includes(',')) {
      rejectedNames.push(fullName);
      continue;
    }
    const marks: Record<string, string> = {};
    for (const idx of dateColIndices) {
      marks[header[idx].trim()] = (row[idx] ?? '').trim();
    }
    students.push({
      indexNo: (row[indexColIdx] ?? '').trim(),
      fullName,
      marks,
    });
  }

  return {
    sheetName,
    classSectionLabel,
    formTeacher,
    students,
    firstDate: header[dateColIndices[0]].trim(),
    lastDate: header[dateColIndices[dateColIndices.length - 1]].trim(),
    dateColumns,
    rejectedNames,
    legendEntries,
  };
}

export function parseWorkbook(filePath: string): ParsedSection[] {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map((name) => parseSheet(wb.Sheets[name], name));
}

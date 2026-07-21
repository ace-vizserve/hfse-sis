// lib/sis/backfill/attendance/attendance-workbook-t3.ts
// Parses HFSE's real T3 attendance workbook (a different, richer native
// masthead than T1/T2 — see the design doc). Extracts identity fields,
// the 4 legend groups (School Events / School Holiday / Public Holiday /
// Examination), the row-11 date-column tags, and the roster + marks grid.
//
// Does NOT reuse Phase 1's parseSheet: parseSheet finds the roster's
// date-header row by scanning for the FIRST row containing any
// "D-Mon"-shaped cell, but T3's legend rows (4-7) already contain
// scattered single dates in that exact shape (one per legend group) —
// parseSheet locks onto row 4 (<=4 matches) instead of the real header
// at row 12 (68 matches) on the real file. This parser instead finds the
// header row as the one with the MOST date-shaped cells, an unambiguous
// rule given the real gap (68 vs <=4), then reuses parseSheet's exact
// name/index/marks extraction logic (adapted, not called).
import * as XLSX from 'xlsx';

export interface RosterStudentT3 {
  indexNo: string;
  fullName: string;
  // Date-column header string (e.g. "29-Jun") -> trimmed cell value ("P"
  // / "A" / "EX" / "L" / "" for a blank/no-class day).
  marks: Record<string, string>;
}

export interface ParsedSectionCoreT3 {
  sheetName: string;
  students: RosterStudentT3[];
  // The ordered list of date-column header strings (e.g. ['29-Jun', ...]).
  dateColumns: string[];
}

export type LegendGroupT3 =
  | 'schoolEvents'
  | 'schoolHoliday'
  | 'publicHoliday'
  | 'examination';

export interface LegendEntryT3 {
  dateText: string;
  label: string;
}

export interface ParsedSectionT3 {
  section: ParsedSectionCoreT3;
  term: string | null;
  course: string | null;
  sectionLabel: string | null;
  formAdviser: string | null;
  legendGroups: Record<LegendGroupT3, LegendEntryT3[]>;
  // Date-column header string ("29-Jun") -> the row-11 tag ("SH"/"SE"/
  // "PH"/"EX"). Only non-blank tags are included.
  dateTags: Record<string, string>;
}

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;

const IDENTITY_LABELS: Record<
  string,
  'term' | 'course' | 'sectionLabel' | 'formAdviser'
> = {
  Term: 'term',
  Course: 'course',
  Section: 'sectionLabel',
  'Form Class Adviser': 'formAdviser',
};

const LEGEND_GROUP_LABELS: Record<string, LegendGroupT3> = {
  'SCHOOL EVENTS': 'schoolEvents',
  'SCHOOL HOLIDAY': 'schoolHoliday',
  'PUBLIC HOLIDAY': 'publicHoliday',
  EXAMINATION: 'examination',
};

// Identity fields sit two columns after their label ("Term", "", "3") —
// the column in between is always blank in the real masthead.
export function extractIdentityFields(rows: string[][]): {
  term: string | null;
  course: string | null;
  sectionLabel: string | null;
  formAdviser: string | null;
} {
  const out: {
    term: string | null;
    course: string | null;
    sectionLabel: string | null;
    formAdviser: string | null;
  } = { term: null, course: null, sectionLabel: null, formAdviser: null };
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const key = IDENTITY_LABELS[cell.trim()];
      if (!key) return;
      const value = (row[idx + 2] ?? '').trim();
      out[key] = value === '' ? null : value;
    });
  }
  return out;
}

// Each of the 4 legend groups is headed by a label in the "CLASS
// INFORMATION" row (row 3); its (date-text, label) pairs sit 2 columns
// apart, directly below the header, up to one pair per row across rows
// 4-7. Header column position is located dynamically per sheet, never
// assumed fixed — legend content (and therefore its exact column) is
// section-specific.
export function extractLegendGroups(
  rows: string[][]
): Record<LegendGroupT3, LegendEntryT3[]> {
  const out: Record<LegendGroupT3, LegendEntryT3[]> = {
    schoolEvents: [],
    schoolHoliday: [],
    publicHoliday: [],
    examination: [],
  };
  const headerRow = rows[3] ?? [];
  headerRow.forEach((cell, colIdx) => {
    const group = LEGEND_GROUP_LABELS[cell.trim()];
    if (!group) return;
    for (let r = 4; r < 8; r++) {
      const dateText = (rows[r]?.[colIdx] ?? '').trim();
      const label = (rows[r]?.[colIdx + 2] ?? '').trim();
      if (dateText && label) out[group].push({ dateText, label });
    }
  });
  return out;
}

// The row with the most date-shaped cells is the real roster header row
// (68 on the real file) — unambiguous vs. the legend rows' scattered
// dates (at most 4 each). Returns -1 if no row has any date-shaped cell.
function findHeaderRowIdx(rows: string[][]): number {
  let bestIdx = -1;
  let bestCount = 0;
  rows.forEach((r, idx) => {
    const count = r.filter((c) => DATE_COL_RE.test(c.trim())).length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

// Row 11 (directly above the real date-header row) carries each date
// column's SH/SE/PH/EX tag, or leaves it blank for an ordinary day.
export function extractDateTags(ws: XLSX.WorkSheet): Record<string, string> {
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });
  const headerRowIdx = findHeaderRowIdx(rows);
  if (headerRowIdx <= 0) return {};
  const header = rows[headerRowIdx];
  const tagRow = rows[headerRowIdx - 1] ?? [];
  const dateTags: Record<string, string> = {};
  header.forEach((cell, colIdx) => {
    if (!DATE_COL_RE.test(cell.trim())) return;
    const tag = (tagRow[colIdx] ?? '').trim();
    if (tag) dateTags[cell.trim()] = tag;
  });
  return dateTags;
}

// Roster + marks extraction, adapted from Phase 1's parseSheet — same
// name/index/marks logic (Full Name = first date column - 1, Index No =
// column 0, reject non-comma names), but using findHeaderRowIdx instead
// of parseSheet's "first row with any date-shaped cell" rule.
function parseRosterT3(
  rows: string[][],
  sheetName: string
): ParsedSectionCoreT3 {
  const headerRowIdx = findHeaderRowIdx(rows);
  if (headerRowIdx === -1) {
    return { sheetName, students: [], dateColumns: [] };
  }

  const header = rows[headerRowIdx];
  const dateColIndices = header.reduce<number[]>((acc, c, i) => {
    if (DATE_COL_RE.test(c.trim())) acc.push(i);
    return acc;
  }, []);
  const dateColumns = dateColIndices.map((idx) => header[idx].trim());
  const nameColIdx = Math.min(...dateColIndices) - 1;
  const indexColIdx = 0;

  const students: RosterStudentT3[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const rowData = rows[i];
    const fullName = (rowData[nameColIdx] ?? '').trim();
    if (!fullName || !fullName.includes(',')) continue;
    const marks: Record<string, string> = {};
    for (const idx of dateColIndices) {
      marks[header[idx].trim()] = (rowData[idx] ?? '').trim();
    }
    students.push({
      indexNo: (rowData[indexColIdx] ?? '').trim(),
      fullName,
      marks,
    });
  }

  return { sheetName, students, dateColumns };
}

export function parseSheetT3(
  ws: XLSX.WorkSheet,
  sheetName: string
): ParsedSectionT3 {
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });
  return {
    section: parseRosterT3(rows, sheetName),
    ...extractIdentityFields(rows.slice(0, 8)),
    legendGroups: extractLegendGroups(rows),
    dateTags: extractDateTags(ws),
  };
}

export function parseWorkbookT3(filePath: string): ParsedSectionT3[] {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map((name) => parseSheetT3(wb.Sheets[name], name));
}

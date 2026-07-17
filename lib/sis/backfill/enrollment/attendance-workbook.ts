// lib/sis/backfill/enrollment/attendance-workbook.ts
// Parses HFSE's real T1 attendance workbook (per-section sheet tabs, a
// 9-row masthead, a dated-column roster) into structured data. Pure
// extraction only — no name matching, no section-name cleanup (see
// name-match.ts / section-identity.ts for those).
import * as XLSX from 'xlsx';

export interface RosterStudent {
  indexNo: string;
  fullName: string;
}

export interface ParsedSection {
  sheetName: string;
  classSectionLabel: string | null;
  formTeacher: string | null;
  students: RosterStudent[];
  firstDate: string | null;
  lastDate: string | null;
  // Non-blank name-column values that were rejected for lacking a comma
  // (e.g. the stray second-table "Name" header artifact) — tracked so a
  // human reviewer can confirm none of these are actually real students
  // with a data-entry quirk. Always [] when nothing was rejected.
  rejectedNames: string[];
}

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;

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
      rejectedNames: [],
    };
  }

  const header = rows[headerRowIdx];
  const dateColIndices = header.reduce<number[]>((acc, c, i) => {
    if (DATE_COL_RE.test(c.trim())) acc.push(i);
    return acc;
  }, []);
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
    students.push({
      indexNo: (row[indexColIdx] ?? '').trim(),
      fullName,
    });
  }

  return {
    sheetName,
    classSectionLabel,
    formTeacher,
    students,
    firstDate: header[dateColIndices[0]].trim(),
    lastDate: header[dateColIndices[dateColIndices.length - 1]].trim(),
    rejectedNames,
  };
}

export function parseWorkbook(filePath: string): ParsedSection[] {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map((name) => parseSheet(wb.Sheets[name], name));
}

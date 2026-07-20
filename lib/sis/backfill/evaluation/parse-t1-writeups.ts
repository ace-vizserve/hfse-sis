// Parses HFSE's real T1 "Student Evaluation_Subject Checklists.xlsx" file.
// Structurally different from the T2 Consolidated Form (Phase 7): sheets
// use a variable-height print template where one student's write-up can
// span multiple physical rows, and the header row repeats at irregular
// intervals between students. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-evaluation-writeups-import-design.md
import * as XLSX from 'xlsx';

export interface SheetIdentity {
  levelCode: string;
  sectionName: string;
}

// Explicit lookup table, not a regex — the Secondary D1/D2/I1/I2
// abbreviations aren't derivable generically (unlike T2's fully-spelled-out
// sheet names). Verified against the live AY2026 roster: all 20 map
// cleanly. Sheets not in this table (3 hidden PTC sheets, 3 empty Reserved
// sheets, 1 stray "xx" scratch sheet) are not real sections and surface as
// unrecognized.
const SHEET_TO_IDENTITY: Record<string, SheetIdentity> = {
  'P1 Patience (G)': { levelCode: 'P1', sectionName: 'Patience' },
  'P1 Obedience': { levelCode: 'P1', sectionName: 'Obedience' },
  'P2 Honesty (G)': { levelCode: 'P2', sectionName: 'Honesty' },
  'P2 Humility': { levelCode: 'P2', sectionName: 'Humility' },
  'P3 Courtesy (G)': { levelCode: 'P3', sectionName: 'Courtesy' },
  'P3 Courageous': { levelCode: 'P3', sectionName: 'Courageous' },
  'P3 Responsibility': { levelCode: 'P3', sectionName: 'Responsibility' },
  'P4 Trust': { levelCode: 'P4', sectionName: 'Trust' },
  'P4 Diligence (G)': { levelCode: 'P4', sectionName: 'Diligence' },
  'P5 Commitment (G)': { levelCode: 'P5', sectionName: 'Commitment' },
  'P5 Tenacity': { levelCode: 'P5', sectionName: 'Tenacity' },
  'P5 Perseverance': { levelCode: 'P5', sectionName: 'Perseverance' },
  'P6 Loyalty': { levelCode: 'P6', sectionName: 'Loyalty' },
  'P6 Grit': { levelCode: 'P6', sectionName: 'Grit' },
  'Sec 1 D1': { levelCode: 'S1', sectionName: 'Discipline 1' },
  'Sec 1 D2': { levelCode: 'S1', sectionName: 'Discipline 2' },
  'Sec 2 I1': { levelCode: 'S2', sectionName: 'Integrity 1' },
  'Sec 2 I2': { levelCode: 'S2', sectionName: 'Integrity 2' },
  'Sec 3': { levelCode: 'S3', sectionName: 'Consistency' },
  'Sec 4': { levelCode: 'S4', sectionName: 'Excellence' },
};

export interface ParsedT1WriteupRow {
  levelCode: string;
  sectionName: string;
  sheetIndexNo: string;
  fullName: string;
  writeup: string;
}

export interface SheetT1Stats {
  levelCode: string;
  sectionName: string;
  namedBlankCount: number;
  unusedTemplateCount: number;
  duplicateIndexNotes: string[];
}

export interface ParseT1WriteupsResult {
  rows: ParsedT1WriteupRow[];
  sheetStats: SheetT1Stats[];
  unrecognizedSheets: string[];
}

const ROW_HEADER = 2;
const ROW_STUDENTS_START = 3;
const COL_INDEX = 0;
const COL_NAME = 1;

function cell(row: unknown[] | undefined, i: number): string {
  if (!row || i < 0) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findWriteupColumn(headerRow: unknown[] | undefined): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (
      String(headerRow[c] ?? '')
        .toLowerCase()
        .includes('student evaluation')
    ) {
      return c;
    }
  }
  return -1;
}

interface StudentBlock {
  indexNo: string;
  fullName: string;
  fragments: string[];
}

function parseOneSheet(
  rows: unknown[][],
  identity: SheetIdentity
): { rows: ParsedT1WriteupRow[]; stats: SheetT1Stats } {
  const writeupCol = findWriteupColumn(rows[ROW_HEADER]);
  const headerLabel = normalize(cell(rows[ROW_HEADER], writeupCol));

  const blocks: StudentBlock[] = [];
  let current: StudentBlock | null = null;

  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, COL_INDEX);
    const fullName = cell(row, COL_NAME);
    const text = cell(row, writeupCol);
    const isHeaderRepeat =
      headerLabel !== '' && normalize(text) === headerLabel;
    const isIdentity = indexNo !== '' || fullName !== '';

    if (isIdentity) {
      current = { indexNo, fullName, fragments: [] };
      blocks.push(current);
      if (!isHeaderRepeat && text !== '') current.fragments.push(text);
    } else if (isHeaderRepeat) {
      // template noise between students — no state change
    } else if (current && text !== '') {
      current.fragments.push(text);
    }
  }

  const parsedRows: ParsedT1WriteupRow[] = [];
  let namedBlankCount = 0;
  let unusedTemplateCount = 0;
  const indexNames = new Map<string, string[]>();

  for (const block of blocks) {
    const writeup = block.fragments
      .map((f) => f.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (block.indexNo !== '') {
      const names = indexNames.get(block.indexNo) ?? [];
      names.push(block.fullName);
      indexNames.set(block.indexNo, names);
    }

    if (writeup === '') {
      if (block.fullName === '') unusedTemplateCount++;
      else namedBlankCount++;
      continue;
    }

    parsedRows.push({
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      sheetIndexNo: block.indexNo,
      fullName: block.fullName,
      writeup,
    });
  }

  const duplicateIndexNotes: string[] = [];
  for (const [indexNo, names] of indexNames) {
    if (names.length > 1) {
      duplicateIndexNotes.push(`index ${indexNo}: ${names.join(' | ')}`);
    }
  }

  return {
    rows: parsedRows,
    stats: {
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      namedBlankCount,
      unusedTemplateCount,
      duplicateIndexNotes,
    },
  };
}

export function parseT1Writeups(filePath: string): ParseT1WriteupsResult {
  const wb = XLSX.readFile(filePath);
  const rows: ParsedT1WriteupRow[] = [];
  const sheetStats: SheetT1Stats[] = [];
  const unrecognizedSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const identity = SHEET_TO_IDENTITY[sheetName];
    if (!identity) {
      unrecognizedSheets.push(sheetName);
      continue;
    }
    const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(
      wb.Sheets[sheetName],
      { header: 1, defval: '', raw: false }
    );
    const { rows: parsedRows, stats } = parseOneSheet(sheetRows, identity);
    rows.push(...parsedRows);
    sheetStats.push(stats);
  }

  return { rows, sheetStats, unrecognizedSheets };
}

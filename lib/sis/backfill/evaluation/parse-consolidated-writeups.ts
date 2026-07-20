// lib/sis/backfill/evaluation/parse-consolidated-writeups.ts
// Parses HFSE's real T2 "Term 2 CONSOLIDATED FORM.xlsx" — one sheet per
// section (unlike the grading imports, this file has no Reserved / DO NOT
// USE / corrupted-duplicate tabs, so no dedup logic is needed). See:
// docs/superpowers/specs/2026-07-20-ay2026-t2-evaluation-writeups-import-design.md
import * as XLSX from 'xlsx';

export interface IdentityResult {
  levelCode: string;
  sectionName: string;
}

// "P1-Patience", "P6 Grit", "S1-Discipline 1 (G)", "S4 - Excellence" — the
// (G) Global-track marker is stripped; it is not part of the real
// sections.name value.
const SHEET_NAME_RE = /^([PS])(\d+)\s*-?\s*(.+?)(?:\s*\(G\))?$/i;

export function parseSheetIdentity(sheetName: string): IdentityResult | null {
  const m = SHEET_NAME_RE.exec(sheetName.trim());
  if (!m) return null;
  const [, letter, num, sectionRaw] = m;
  return {
    levelCode: `${letter.toUpperCase()}${num}`,
    sectionName: sectionRaw.trim(),
  };
}

export interface ParsedWriteupRow {
  levelCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  writeup: string;
}

export interface SheetBlankCount {
  levelCode: string;
  sectionName: string;
  blankCount: number;
}

export interface ParseConsolidatedWriteupsResult {
  rows: ParsedWriteupRow[];
  blankCounts: SheetBlankCount[];
  unrecognizedSheets: string[];
}

const ROW_STUDENTS_START = 8;
const COL_INDEX = 0;
const COL_NAME = 1;
const COL_WRITEUP = 15;

function cell(row: unknown[] | undefined, i: number): string {
  if (!row) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

export function parseConsolidatedWriteups(
  filePath: string
): ParseConsolidatedWriteupsResult {
  const wb = XLSX.readFile(filePath);
  const rows: ParsedWriteupRow[] = [];
  const blankCounts: SheetBlankCount[] = [];
  const unrecognizedSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const identity = parseSheetIdentity(sheetName);
    if (!identity) {
      unrecognizedSheets.push(sheetName);
      continue;
    }

    const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(
      wb.Sheets[sheetName],
      { header: 1, defval: '', raw: false }
    );

    let blankCount = 0;
    for (let i = ROW_STUDENTS_START; i < sheetRows.length; i++) {
      const row = sheetRows[i];
      const indexNo = cell(row, COL_INDEX);
      const fullName = cell(row, COL_NAME);
      if (!/^\d+$/.test(indexNo) || fullName === '') continue;

      const writeup = cell(row, COL_WRITEUP);
      if (writeup === '') {
        blankCount++;
        continue;
      }

      rows.push({
        levelCode: identity.levelCode,
        sectionName: identity.sectionName,
        indexNo,
        fullName,
        writeup,
      });
    }

    blankCounts.push({
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      blankCount,
    });
  }

  return { rows, blankCounts, unrecognizedSheets };
}

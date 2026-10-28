// Reads the school's book list workbook (`AY2027 Book List_v02.xlsx`) into the
// items of the books & supplies tracker (migration 199).
//
// Pure module — no database. `parseBookList` reads the file; everything after
// that is `parseBookListWorkbook`, which tests drive with a workbook built in
// memory. Server-only in practice (xlsx), used by
// scripts/backfill/import-ay2027-book-list.ts.
//
// TWO SHEETS ARE READ, nothing else (the workbook holds ~30 working tabs):
//
//   * `AY2027 Book list_Enhanced` — header row 4. B Course, C Module (the
//     subject), D Book Title, E Publisher, F ISBN, R the AY's status. A row
//     whose status is `End of life / Cancel` is dropped. The course names the
//     level and, for Primary, the track: `Primary Three - Global` → P3 Global,
//     `Secondary One` → S1 for both tracks. `HFSE International Education
//     Programme - Year N` rows are not SIS levels and are skipped.
//   * `Other Materials List` — column A Item. Every supply is for every level,
//     except names starting `YS` (`YS Kit`, `YS Blue Booklet A5`, …), which
//     are Youngstarters only.
//
// ⚠ THE HEADER ROW IS CHECKED, not assumed. The workbook is a draft the school
// keeps editing; a column inserted before R would otherwise import publishers
// as statuses without a word. A header that no longer reads as expected stops
// the import.

import * as XLSX from 'xlsx';

import {
  EXTRA_LEVEL_LABELS,
  LEVEL_LABELS,
  type AnyLevelCode,
} from '@/lib/sis/levels';
import type {
  ParsedBookList,
  ParsedSupplyItem,
  SkippedBookRow,
  SupplyClassType,
} from '@/lib/sis/supplies/types';

export const BOOKS_SHEET = 'AY2027 Book list_Enhanced';
export const SUPPLIES_SHEET = 'Other Materials List';

// 0-based column indexes on the books sheet.
const COL = {
  course: 1,
  module: 2,
  title: 3,
  publisher: 4,
  isbn: 5,
  status: 17,
} as const;
// 1-based sheet row of the books header; data starts on the row after it.
const BOOKS_HEADER_ROW = 4;

const END_OF_LIFE = 'end of life / cancel';
const IEP_PREFIX = 'hfse international education programme';

/** Whitespace collapsed to single spaces (titles carry line breaks), or null. */
export function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

/**
 * An ISBN as written, or null when the cell holds none — the sheet writes
 * `Not Applicable` for the school's own booklets and `0` for some Cambridge
 * titles still to be confirmed.
 */
export function cleanIsbn(value: unknown): string | null {
  const s = cleanText(value);
  if (!s || s === '0' || !/\d/.test(s)) return null;
  return s;
}

const LEVEL_CODE_BY_LABEL = new Map<string, AnyLevelCode>(
  Object.entries({ ...LEVEL_LABELS, ...EXTRA_LEVEL_LABELS }).map(
    ([code, label]) => [label.toLowerCase(), code as AnyLevelCode]
  )
);

/**
 * `Primary Three - Global` → P3 Global; `Secondary One` → S1, both tracks.
 * Null when the course is not an SIS level (the IEP years, anything unknown).
 */
export function mapCourse(
  course: string
): { levelCode: AnyLevelCode; classType: SupplyClassType | null } | null {
  const m = /^(.+?)(?:\s*-\s*(Global|Standard))?$/i.exec(course.trim());
  if (!m) return null;
  const levelCode = LEVEL_CODE_BY_LABEL.get(m[1].trim().toLowerCase());
  if (!levelCode) return null;
  const track = m[2]?.toLowerCase();
  return {
    levelCode,
    classType:
      track === 'global' ? 'Global' : track === 'standard' ? 'Standard' : null,
  };
}

/** `YS Kit`, `YS brown Booklet A4` → Youngstarters only. */
export function isYoungstartersSupply(title: string): boolean {
  return /^YS\s/.test(title);
}

function rowsOf(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`The workbook has no "${sheet}" sheet.`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: true,
  });
}

function itemKey(i: ParsedSupplyItem): string {
  return [
    i.kind,
    i.levelCode ?? '*',
    i.classType ?? '*',
    i.subject ?? '*',
    i.title,
  ].join('|');
}

export function parseBookListWorkbook(
  wb: XLSX.WorkBook,
  ayCode: string
): ParsedBookList {
  const items: ParsedSupplyItem[] = [];
  const skipped: SkippedBookRow[] = [];
  const seen = new Set<string>();

  const push = (item: ParsedSupplyItem, course: string | null) => {
    const key = itemKey(item);
    if (seen.has(key)) {
      skipped.push({
        sheet: item.sheet,
        row: item.sortOrder,
        reason: 'duplicate',
        course,
        title: item.title,
      });
      return;
    }
    seen.add(key);
    items.push(item);
  };

  // ── Books ──
  const bookRows = rowsOf(wb, BOOKS_SHEET);
  const header = bookRows[BOOKS_HEADER_ROW - 1] ?? [];
  const expected: Array<[number, string]> = [
    [COL.course, 'Course'],
    [COL.module, 'Module'],
    [COL.title, 'Book Title'],
    [COL.publisher, 'Publisher'],
    [COL.isbn, 'ISBN'],
    [COL.status, ayCode],
  ];
  for (const [col, want] of expected) {
    const got = cleanText(header[col]);
    if (got?.toLowerCase() !== want.toLowerCase()) {
      throw new Error(
        `"${BOOKS_SHEET}" row ${BOOKS_HEADER_ROW}, column ${XLSX.utils.encode_col(col)}: expected "${want}", found "${got ?? ''}".`
      );
    }
  }

  for (let i = BOOKS_HEADER_ROW; i < bookRows.length; i++) {
    const r = bookRows[i] ?? [];
    const row = i + 1;
    const title = cleanText(r[COL.title]);
    if (!title) continue;
    const course = cleanText(r[COL.course]);
    const status = cleanText(r[COL.status])?.toLowerCase() ?? null;

    if (course?.toLowerCase().startsWith(IEP_PREFIX)) {
      skipped.push({
        sheet: BOOKS_SHEET,
        row,
        reason: 'iep_course',
        course,
        title,
      });
      continue;
    }
    const mapped = course ? mapCourse(course) : null;
    if (!mapped) {
      skipped.push({
        sheet: BOOKS_SHEET,
        row,
        reason: 'unknown_course',
        course,
        title,
      });
      continue;
    }
    if (status === END_OF_LIFE) {
      skipped.push({
        sheet: BOOKS_SHEET,
        row,
        reason: 'end_of_life',
        course,
        title,
      });
      continue;
    }
    push(
      {
        kind: 'book',
        levelCode: mapped.levelCode,
        classType: mapped.classType,
        subject: cleanText(r[COL.module]),
        title,
        publisher: cleanText(r[COL.publisher]),
        isbn: cleanIsbn(r[COL.isbn]),
        sortOrder: row,
        sheet: BOOKS_SHEET,
      },
      course
    );
  }

  // ── Supplies ──
  const supplyRows = rowsOf(wb, SUPPLIES_SHEET);
  const supplyHeader = cleanText(supplyRows[0]?.[0]);
  if (supplyHeader?.toLowerCase() !== 'item') {
    throw new Error(
      `"${SUPPLIES_SHEET}" row 1, column A: expected "Item", found "${supplyHeader ?? ''}".`
    );
  }
  for (let i = 1; i < supplyRows.length; i++) {
    const title = cleanText(supplyRows[i]?.[0]);
    if (!title) continue;
    push(
      {
        kind: 'supply',
        levelCode: isYoungstartersSupply(title) ? 'YS' : null,
        classType: null,
        subject: null,
        title,
        publisher: null,
        isbn: null,
        sortOrder: i + 1,
        sheet: SUPPLIES_SHEET,
      },
      null
    );
  }

  return { ayCode, items, skipped };
}

export function parseBookList(
  filePath: string,
  ayCode: string
): ParsedBookList {
  return parseBookListWorkbook(XLSX.readFile(filePath), ayCode);
}

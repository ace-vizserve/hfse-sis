# AY2026 T3 Attendance Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reviewable `preview.sql` / chunked `apply/*.sql` files that import HFSE's real AY2026 T3 daily attendance (P/A/EX/L marks, 20 real sections, 29-Jun–4-Sep 2026) into `attendance_daily` + `school_calendar` + `calendar_events`, without ever writing to the database directly from this codebase.

**Architecture:** A new masthead parser (`attendance-workbook-t3.ts`) reads T3's richer native template — identity fields, 4 legend groups, row-11 date-column tags — and its own roster/marks extraction (NOT a reuse of Phase 1's `parseSheet`; see Global Constraints). A day-first date-list/range parser (`legend-dates-t3.ts`) resolves legend cell text into ISO dates. A tag-driven classifier (`day-classifier-t3.ts`) turns each date's row-11 tag directly into a `school_calendar` day-type + optional `calendar_events` row — simpler than T1/T2 since the tag is given, not guessed. A composer (`build-attendance-import-t3.ts`) wires these together with section-identity resolution + SQL emission, following Phase 2/T2's exact chunked-apply-files shape. One orchestrator script wires DB reads + file parsing + the composer together and writes the two output artifacts.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-21-ay2026-t3-attendance-import-design.md` — read it before starting; every task below implements a piece of it, including the corrections at the top of the file (found during planning).
- Scope is the same 20 real sections T1/T2 cover (all of P1–P6 and S1–S4, including the `Discipline 1/2` and `Integrity 1/2` splits) — `ADMIN_Bus Summary`, `YS`, and `Reference - Dropdown` are excluded.
- **Do not modify or call Phase 1's `parseSheet`** (`lib/sis/backfill/enrollment/attendance-workbook.ts`). Verified against the real file: its header-row detection ("first row with any date-shaped cell") locks onto T3's legend rows, which contain scattered single dates in the same shape as the real roster header. T3 gets its own header-row detection ("row with the most date-shaped cells") and its own roster/marks extraction, adapted from `parseSheet`'s logic but not calling it.
- Reuse `resolveDate` / `MONTH_MAP` (via `resolveHeaderDate`) from `lib/sis/backfill/attendance/legend-parser.ts` as-is — do not modify that file. Do NOT reuse `parseLegendDateRange` from the same file — it's T1-specific (month-first shape), wrong for T3's day-first shapes.
- Reuse `lib/sis/backfill/enrollment/sql-escape.ts` (`sqlString`, `sqlStringOrNull`) as-is.
- Reuse `lib/sis/backfill/enrollment/section-identity.ts::deriveSectionIdentity` as-is — T3's `"Section - N"` → `"Section N"` naming wrinkle is handled by a small new normalization wrapper in the composer, not by editing `section-identity.ts`.
- `calendar_events.label` is `NOT NULL` (no default) — a `SE`/`EX`-tagged date with no matching legend label is never written to `calendar_events`, only flagged (`labelMissing`) in stats + preview for a human to add by hand.
- No code in this plan ever writes to the database. The orchestrator only reads (for AY/roster lookups) and writes local `.sql` files.
- Marks chunk size defaults to 2000 rows (T2's tuned ~150KB/file target, reused as-is).
- Output files (`scripts/backfill/ay2026-t3-attendance-preview.sql`, `scripts/backfill/ay2026-t3-attendance-apply/*.sql`) contain real student attendance data (PII) — must be gitignored, matching every prior phase's pattern.
- Do not modify any Phase 1/2/3/T2 file. Every new capability for T3 lives in a new file; existing modules are imported and reused, never edited.

---

### Task 1: T3 masthead parser (identity fields, legend groups, row-11 tags, roster/marks)

**Files:**

- Create: `lib/sis/backfill/attendance/attendance-workbook-t3.ts`
- Test: `__tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts`

**Interfaces:**

- Consumes: `xlsx` (`import * as XLSX from 'xlsx'`), the same library every parser in this codebase already uses. No other project imports.
- Produces (consumed by Task 4):

  ```ts
  export interface RosterStudentT3 {
    indexNo: string;
    fullName: string;
    marks: Record<string, string>;
  }

  export interface ParsedSectionCoreT3 {
    sheetName: string;
    students: RosterStudentT3[];
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
    dateTags: Record<string, string>;
  }

  export function extractIdentityFields(rows: string[][]): {
    term: string | null;
    course: string | null;
    sectionLabel: string | null;
    formAdviser: string | null;
  };

  export function extractLegendGroups(
    rows: string[][]
  ): Record<LegendGroupT3, LegendEntryT3[]>;

  export function extractDateTags(ws: XLSX.WorkSheet): Record<string, string>;

  export function parseSheetT3(
    ws: XLSX.WorkSheet,
    sheetName: string
  ): ParsedSectionT3;

  export function parseWorkbookT3(filePath: string): ParsedSectionT3[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts`:

```ts
// __tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  extractDateTags,
  extractIdentityFields,
  extractLegendGroups,
  parseSheetT3,
  type ParsedSectionT3,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t3';

const WIDTH = 40;

function row(overrides: Record<number, string>): string[] {
  const r = new Array(WIDTH).fill('');
  for (const [idx, value] of Object.entries(overrides)) {
    r[Number(idx)] = value;
  }
  return r;
}

// Mirrors the real T3 masthead shape (confirmed by direct inspection of
// the source file — see design doc §1): identity fields at col0/col2
// across rows 4-7; 4 legend groups headed at row 3 (cols 13/20/27/34),
// each group's (date-text, label) pairs at (headerCol, headerCol+2) — all
// 4 land on row 4 in this fixture (4 date-shaped cells total); row 11
// carries the roster's identity-column labels (cols 0-4) AND the row-11
// date-column tags (col5 onward); row 12 is the real date-header row.
// Row 4 ALSO contains scattered single dates in the exact same "D-Mon"
// shape as row 12's — this is the collision that makes Phase 1's
// parseSheet unusable for T3 (see Global Constraints): parseSheet's "first
// row with any date-shaped cell" rule would lock onto row 4. This fixture
// proves the fix works by giving row 12 MORE date-shaped cells (5) than
// row 4's legend dates (4) — the same "most cells wins" property the real
// file has (68 vs <=4), just scaled down to a fixture-sized gap.
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = row({});
  rows[1] = row({});
  rows[2] = row({});
  rows[3] = row({
    0: 'CLASS INFORMATION',
    6: 'LEGEND',
    13: 'SCHOOL EVENTS',
    20: 'SCHOOL HOLIDAY',
    27: 'PUBLIC HOLIDAY',
    34: 'EXAMINATION',
  });
  rows[4] = row({
    0: 'Term',
    2: '3',
    6: 'P',
    7: 'Present',
    13: '21-Jul',
    15: 'Racial Harmony Celebration',
    20: '6-Jul',
    22: 'In Lieu of Youth Day',
    27: '9-Aug',
    29: 'National Day',
    34: '26-Aug',
    36: 'Term 3 Exam (Math)',
  });
  rows[5] = row({ 0: 'Course', 2: 'Primary One', 6: 'A', 7: 'Absent' });
  rows[6] = row({
    0: 'Section',
    2: 'Patience (Global)',
    6: 'EX',
    7: 'Excused (MC or Excuse Leave)',
  });
  rows[7] = row({
    0: 'Form Class Adviser',
    2: 'Ms. Kristel',
    6: 'L',
    7: 'Late',
  });
  rows[8] = row({});
  rows[9] = row({});
  rows[10] = row({});
  // 5 date columns (col5-9) — one more than row 4's 4 legend dates, so
  // findHeaderRowIdx's "most date-shaped cells" rule picks row 12, not
  // row 4, exactly the property that breaks on a plain "first row with
  // any match" scan.
  rows[11] = row({
    0: 'Index \r\nNo',
    1: 'Bus No. / Student Care',
    2: 'Academics',
    3: 'Admin',
    4: 'Full Name',
    5: 'SE',
  });
  rows[12] = row({
    5: '21-Jul',
    6: '22-Jul',
    7: '23-Jul',
    8: '24-Jul',
    9: '25-Jul',
  });
  rows[13] = row({
    0: '1',
    4: 'ALVAREZ, Jaime III D.',
    5: 'P',
    6: 'P',
    7: 'P',
    8: 'P',
    9: 'P',
  });
  rows[14] = row({
    0: '2',
    4: 'AMATE, Jaiden Matthew A.',
    5: 'P',
    6: '',
    7: '',
    8: '',
    9: '',
  });
  return rows;
}

describe('extractIdentityFields', () => {
  it('reads Term/Course/Section/Form Class Adviser from two columns after each label', () => {
    const result = extractIdentityFields(buildFixtureRows().slice(0, 8));
    expect(result).toEqual({
      term: '3',
      course: 'Primary One',
      sectionLabel: 'Patience (Global)',
      formAdviser: 'Ms. Kristel',
    });
  });

  it('returns nulls when no identity rows are present', () => {
    expect(extractIdentityFields([])).toEqual({
      term: null,
      course: null,
      sectionLabel: null,
      formAdviser: null,
    });
  });
});

describe('extractLegendGroups', () => {
  it("reads each of the 4 groups' (date-text, label) pairs from their own header column", () => {
    const result = extractLegendGroups(buildFixtureRows());
    expect(result.schoolEvents).toEqual([
      { dateText: '21-Jul', label: 'Racial Harmony Celebration' },
    ]);
    expect(result.schoolHoliday).toEqual([
      { dateText: '6-Jul', label: 'In Lieu of Youth Day' },
    ]);
    expect(result.publicHoliday).toEqual([
      { dateText: '9-Aug', label: 'National Day' },
    ]);
    expect(result.examination).toEqual([
      { dateText: '26-Aug', label: 'Term 3 Exam (Math)' },
    ]);
  });
});

describe('extractDateTags', () => {
  it("reads the row-11 tag aligned to the real date-header row, ignoring the legend rows' own scattered dates", () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    // Row 12 is the real header (5 date-shaped cells) — more than row 4's
    // 4 legend dates, so findHeaderRowIdx picks row 12, and the tag comes
    // from row 11 (directly above it), not row 3 (directly above row 4,
    // which would give the wrong answer if the header-row rule regressed
    // to "first row with any match").
    expect(extractDateTags(ws)).toEqual({ '21-Jul': 'SE' });
  });
});

describe('parseSheetT3', () => {
  it('composes identity + legend groups + date tags + roster/marks extraction', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result: ParsedSectionT3 = parseSheetT3(ws, 'P1 Patience (Global)');
    expect(result.term).toBe('3');
    expect(result.sectionLabel).toBe('Patience (Global)');
    expect(result.dateTags).toEqual({ '21-Jul': 'SE' });
    expect(result.legendGroups.publicHoliday).toEqual([
      { dateText: '9-Aug', label: 'National Day' },
    ]);
    expect(result.section.dateColumns).toEqual([
      '21-Jul',
      '22-Jul',
      '23-Jul',
      '24-Jul',
      '25-Jul',
    ]);
    expect(result.section.students).toHaveLength(2);
    expect(result.section.students[0]).toEqual({
      indexNo: '1',
      fullName: 'ALVAREZ, Jaime III D.',
      marks: {
        '21-Jul': 'P',
        '22-Jul': 'P',
        '23-Jul': 'P',
        '24-Jul': 'P',
        '25-Jul': 'P',
      },
    });
    expect(result.section.students[1].marks).toEqual({
      '21-Jul': 'P',
      '22-Jul': '',
      '23-Jul': '',
      '24-Jul': '',
      '25-Jul': '',
    });
  });

  it('rejects a non-comma "name" (e.g. a stray label artifact) the same way Phase 1 does', () => {
    const rows = buildFixtureRows();
    rows[15] = row({ 0: '3', 4: 'NOT A REAL NAME', 5: 'P', 6: '' });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheetT3(ws, 'P1 Patience (Global)');
    expect(result.section.students).toHaveLength(2);
    expect(
      result.section.students.some((s) => s.fullName === 'NOT A REAL NAME')
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/attendance-workbook-t3'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/attendance/attendance-workbook-t3.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts`
Expected: PASS (6 tests — 2 in `extractIdentityFields`, 1 in `extractLegendGroups`, 1 in `extractDateTags`, 2 in `parseSheetT3`)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/attendance-workbook-t3.ts __tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts
git commit -m "feat(backfill): parse AY2026 T3's native masthead (identity, legend groups, row-11 tags, roster)"
```

---

### Task 2: Legend date-text parser (single / comma-list / range, day-first)

**Files:**

- Create: `lib/sis/backfill/attendance/legend-dates-t3.ts`
- Test: `__tests__/sis/backfill/attendance/legend-dates-t3.test.ts`

**Interfaces:**

- Consumes (existing, `legend-parser.ts`, reused as-is): `resolveHeaderDate`, `resolveDate` from `@/lib/sis/backfill/attendance/legend-parser`.
- Produces (consumed by Task 4):

  ```ts
  export function parseLegendDateTextT3(
    rawText: string,
    year: number
  ): string[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/legend-dates-t3.test.ts`:

```ts
// __tests__/sis/backfill/attendance/legend-dates-t3.test.ts
import { describe, expect, it } from 'vitest';

import { parseLegendDateTextT3 } from '@/lib/sis/backfill/attendance/legend-dates-t3';

describe('parseLegendDateTextT3', () => {
  it('parses a single abbreviated-month date', () => {
    expect(parseLegendDateTextT3('26-Aug', 2026)).toEqual(['2026-08-26']);
  });

  it('parses a comma-separated list of days sharing a trailing full month name', () => {
    expect(parseLegendDateTextT3('13, 20, 27 July', 2026)).toEqual([
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ]);
  });

  it('parses a day range sharing a trailing full month name', () => {
    expect(parseLegendDateTextT3('14-16 July', 2026)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseLegendDateTextT3('  9-Aug  ', 2026)).toEqual(['2026-08-09']);
  });

  it('resolves the year boundary correctly for a December date', () => {
    expect(parseLegendDateTextT3('3-Dec', 2026)).toEqual(['2026-12-03']);
  });

  it('returns an empty array for an unrecognized shape', () => {
    expect(parseLegendDateTextT3('sometime in August', 2026)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseLegendDateTextT3('', 2026)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/legend-dates-t3.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/legend-dates-t3'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/attendance/legend-dates-t3.ts`:

```ts
// lib/sis/backfill/attendance/legend-dates-t3.ts
// Parses a T3 legend cell's date-text into one or more ISO dates. T3's
// masthead (design doc §1 point 3) uses three distinct day-first shapes,
// none of which match T1's month-first "Month Day[-Day] Label" shape
// (legend-parser.ts::parseLegendDateRange) or T2's date-aligned lookup:
//   - single, abbreviated month:  "6-Jul", "26-Aug"
//   - comma list, full month:     "13, 20, 27 July"
//   - day range, full month:      "14-16 July"
// Reuses resolveHeaderDate (identical "D-Mon" shape) for the single-date
// case, and resolveDate (month-name resolution only) for the list/range
// shapes, which get their own small parsers here.
import { resolveDate, resolveHeaderDate } from './legend-parser';

const SINGLE_RE = /^(\d{1,2})-([A-Za-z]{3,})$/;
const RANGE_RE = /^(\d{1,2})-(\d{1,2})\s+([A-Za-z]+)$/;
const LIST_RE = /^([\d,\s]+)\s+([A-Za-z]+)$/;

// Returns every ISO date the cell's text covers, or [] if the shape isn't
// recognized (defensive — every real T3 legend cell observed matches one
// of the three shapes).
export function parseLegendDateTextT3(rawText: string, year: number): string[] {
  const text = rawText.trim();
  if (!text) return [];

  const single = text.match(SINGLE_RE);
  if (single) {
    const date = resolveHeaderDate(text, year);
    return date ? [date] : [];
  }

  const range = text.match(RANGE_RE);
  if (range) {
    const [, startStr, endStr, month] = range;
    const start = Number.parseInt(startStr, 10);
    const end = Number.parseInt(endStr, 10);
    const dates: string[] = [];
    for (let d = start; d <= end; d++) {
      const iso = resolveDate(month, d, year);
      if (iso) dates.push(iso);
    }
    return dates;
  }

  const list = text.match(LIST_RE);
  if (list) {
    const [, daysStr, month] = list;
    const dates: string[] = [];
    for (const part of daysStr.split(',')) {
      const day = Number.parseInt(part.trim(), 10);
      if (Number.isNaN(day)) continue;
      const iso = resolveDate(month, day, year);
      if (iso) dates.push(iso);
    }
    return dates;
  }

  return [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/legend-dates-t3.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/legend-dates-t3.ts __tests__/sis/backfill/attendance/legend-dates-t3.test.ts
git commit -m "feat(backfill): parse AY2026 T3's day-first legend date-text shapes"
```

---

### Task 3: Row-11-tag-driven day classifier

**Files:**

- Create: `lib/sis/backfill/attendance/day-classifier-t3.ts`
- Test: `__tests__/sis/backfill/attendance/day-classifier-t3.test.ts`

**Interfaces:**

- Consumes: nothing (pure, no imports from other tasks).
- Produces (consumed by Task 4):

  ```ts
  export type DayType =
    | 'school_day'
    | 'public_holiday'
    | 'school_holiday'
    | 'no_class';

  export type EventCategoryT3 = 'school_event' | 'term_exam';

  export interface DateClassificationT3 {
    date: string;
    dayType: DayType;
    label: string | null;
    event: {
      category: EventCategoryT3;
      label: string | null;
      labelMissing: boolean;
    } | null;
  }

  export function classifyDatesT3(
    datesISO: string[],
    tagByDate: Map<string, string>,
    legendLabelByDate: Map<string, string>,
    blankDates: Set<string>
  ): DateClassificationT3[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/day-classifier-t3.test.ts`:

```ts
// __tests__/sis/backfill/attendance/day-classifier-t3.test.ts
import { describe, expect, it } from 'vitest';

import { classifyDatesT3 } from '@/lib/sis/backfill/attendance/day-classifier-t3';

describe('classifyDatesT3', () => {
  it('classifies an SH-tagged date as school_holiday with its label, no event', () => {
    const result = classifyDatesT3(
      ['2026-07-06'],
      new Map([['2026-07-06', 'SH']]),
      new Map([['2026-07-06', 'In Lieu of Youth Day']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-06',
        dayType: 'school_holiday',
        label: 'In Lieu of Youth Day',
        event: null,
      },
    ]);
  });

  it('classifies a PH-tagged date as public_holiday with its label, no event', () => {
    const result = classifyDatesT3(
      ['2026-08-09'],
      new Map([['2026-08-09', 'PH']]),
      new Map([['2026-08-09', 'National Day']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-08-09',
        dayType: 'public_holiday',
        label: 'National Day',
        event: null,
      },
    ]);
  });

  it('classifies an SE-tagged date as school_day with a school_event, when a label was found', () => {
    const result = classifyDatesT3(
      ['2026-07-21'],
      new Map([['2026-07-21', 'SE']]),
      new Map([['2026-07-21', 'Racial Harmony Celebration']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-21',
        dayType: 'school_day',
        label: 'Racial Harmony Celebration',
        event: {
          category: 'school_event',
          label: 'Racial Harmony Celebration',
          labelMissing: false,
        },
      },
    ]);
  });

  it('classifies an EX-tagged date as school_day with a term_exam event', () => {
    const result = classifyDatesT3(
      ['2026-08-26'],
      new Map([['2026-08-26', 'EX']]),
      new Map([['2026-08-26', 'Term 3 Exam (Math, English)']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-08-26',
        dayType: 'school_day',
        label: 'Term 3 Exam (Math, English)',
        event: {
          category: 'term_exam',
          label: 'Term 3 Exam (Math, English)',
          labelMissing: false,
        },
      },
    ]);
  });

  it('flags a tagged date with no matching legend entry as labelMissing, never guessing a label', () => {
    const result = classifyDatesT3(
      ['2026-07-27'],
      new Map([['2026-07-27', 'SE']]),
      new Map(),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-27',
        dayType: 'school_day',
        label: null,
        event: { category: 'school_event', label: null, labelMissing: true },
      },
    ]);
  });

  it('classifies an untagged date with a real mark as school_day', () => {
    const result = classifyDatesT3(
      ['2026-06-29'],
      new Map(),
      new Map(),
      new Set()
    );
    expect(result).toEqual([
      { date: '2026-06-29', dayType: 'school_day', label: null, event: null },
    ]);
  });

  it('classifies an untagged, all-blank date (a weekend/gap) as no_class', () => {
    const result = classifyDatesT3(
      ['2026-07-04'],
      new Map(),
      new Map(),
      new Set(['2026-07-04'])
    );
    expect(result).toEqual([
      { date: '2026-07-04', dayType: 'no_class', label: null, event: null },
    ]);
  });

  it('preserves input order across a mixed date list', () => {
    const result = classifyDatesT3(
      ['2026-07-06', '2026-06-29', '2026-07-04'],
      new Map([['2026-07-06', 'SH']]),
      new Map([['2026-07-06', 'In Lieu of Youth Day']]),
      new Set(['2026-07-04'])
    );
    expect(result.map((r) => r.dayType)).toEqual([
      'school_holiday',
      'school_day',
      'no_class',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/day-classifier-t3.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/day-classifier-t3'`

- [ ] **Step 3: Implement the classifier**

Create `lib/sis/backfill/attendance/day-classifier-t3.ts`:

```ts
// lib/sis/backfill/attendance/day-classifier-t3.ts
// Classifies each date in the AY2026 T3 term as a real school day or a
// holiday/no-class day, for populating school_calendar + calendar_events.
// Pure. Unlike T1/T2's classifiers, day-type comes directly from the
// row-11 tag (design doc §3) rather than being guessed from blank cells
// — guessing is only needed for the untagged case, to distinguish an
// ordinary school day from a weekend/gap (no tag exists for either).

export type DayType =
  | 'school_day'
  | 'public_holiday'
  | 'school_holiday'
  | 'no_class';

export type EventCategoryT3 = 'school_event' | 'term_exam';

export interface DateClassificationT3 {
  date: string;
  dayType: DayType;
  // Informational label for school_calendar.label — populated for any
  // tagged date (SH/PH/SE/EX) from the matching legend entry; null for
  // untagged dates.
  label: string | null;
  // Set only for a school_day date tagged SE or EX — the calendar_events
  // row to create. label is null (and labelMissing true) when the tag
  // has no matching legend entry, so the composer can skip writing a row
  // (calendar_events.label is NOT NULL) and flag it for a human instead
  // of guessing or violating the constraint.
  event: {
    category: EventCategoryT3;
    label: string | null;
    labelMissing: boolean;
  } | null;
}

export function classifyDatesT3(
  datesISO: string[],
  tagByDate: Map<string, string>,
  legendLabelByDate: Map<string, string>,
  blankDates: Set<string>
): DateClassificationT3[] {
  return datesISO.map((date) => {
    const tag = tagByDate.get(date) ?? null;
    const label = legendLabelByDate.get(date) ?? null;

    if (tag === 'SH') {
      return { date, dayType: 'school_holiday', label, event: null };
    }
    if (tag === 'PH') {
      return { date, dayType: 'public_holiday', label, event: null };
    }
    if (tag === 'SE') {
      return {
        date,
        dayType: 'school_day',
        label,
        event: {
          category: 'school_event',
          label,
          labelMissing: label === null,
        },
      };
    }
    if (tag === 'EX') {
      return {
        date,
        dayType: 'school_day',
        label,
        event: { category: 'term_exam', label, labelMissing: label === null },
      };
    }

    return {
      date,
      dayType: blankDates.has(date) ? 'no_class' : 'school_day',
      label: null,
      event: null,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/day-classifier-t3.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/day-classifier-t3.ts __tests__/sis/backfill/attendance/day-classifier-t3.test.ts
git commit -m "feat(backfill): classify AY2026 T3 dates via the row-11 tag directly"
```

---

### Task 4: Import composer (roster resolution, chunked SQL emission incl. calendar_events)

**Files:**

- Create: `lib/sis/backfill/attendance/build-attendance-import-t3.ts`
- Test: `__tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts`

**Interfaces:**

- Consumes (from Task 1): `ParsedSectionT3`, `LegendGroupT3` from `@/lib/sis/backfill/attendance/attendance-workbook-t3`.
- Consumes (from Task 2): `parseLegendDateTextT3` from `@/lib/sis/backfill/attendance/legend-dates-t3`.
- Consumes (from Task 3): `classifyDatesT3`, `DateClassificationT3`, `EventCategoryT3` from `@/lib/sis/backfill/attendance/day-classifier-t3`.
- Consumes (existing, reused as-is): `deriveSectionIdentity` from `@/lib/sis/backfill/enrollment/section-identity`; `sqlString`, `sqlStringOrNull` from `@/lib/sis/backfill/enrollment/sql-escape`; `resolveHeaderDate` from `@/lib/sis/backfill/attendance/legend-parser`; `RosterLookupEntry` from `@/lib/sis/backfill/attendance/build-attendance-import` (re-exported by this task's module — same shape, no duplication).
- Produces (consumed by Task 5):

  ```ts
  export interface BuildAttendanceImportT3Input {
    sections: ParsedSectionT3[];
    rosterLookup: RosterLookupEntry[];
    ayCode: string;
    termNumber: number;
    year: number;
    marksChunkSize?: number;
  }

  export interface ApplySqlFile {
    filename: string;
    sql: string;
    description: string;
  }

  export interface BuildAttendanceImportT3Result {
    preview: string;
    applyFiles: ApplySqlFile[];
    stats: {
      schoolDays: number;
      holidays: number;
      events: number;
      eventsMissingLabel: number;
      attendanceRows: number;
      needsReview: number;
      excludedNonCore: string[];
      unrecognized: string[];
      skippedEmpty: string[];
      unparseableDateHeaders: string[];
    };
  }

  export function buildAttendanceImportT3(
    input: BuildAttendanceImportT3Input
  ): BuildAttendanceImportT3Result;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts`:

```ts
// __tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImportT3 } from '@/lib/sis/backfill/attendance/build-attendance-import-t3';
import type {
  ApplySqlFile,
  RosterLookupEntry,
} from '@/lib/sis/backfill/attendance/build-attendance-import-t3';
import type {
  LegendEntryT3,
  LegendGroupT3,
  ParsedSectionT3,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t3';

function joinApply(applyFiles: ApplySqlFile[]): string {
  return applyFiles.map((f) => f.sql).join('\n');
}

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 3, year: 2026 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'P1',
    cleanName: 'Patience',
    indexNumber: 1,
    sectionStudentId: 'ss-alvarez-uuid',
  },
  {
    levelCode: 'P1',
    cleanName: 'Patience',
    indexNumber: 2,
    sectionStudentId: 'ss-amate-uuid',
  },
];

function emptyLegendGroups(): Record<LegendGroupT3, LegendEntryT3[]> {
  return {
    schoolEvents: [],
    schoolHoliday: [],
    publicHoliday: [],
    examination: [],
  };
}

function buildSection(
  overrides: Partial<ParsedSectionT3> = {}
): ParsedSectionT3 {
  return {
    section: {
      sheetName: 'P1 Patience (Global)',
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': 'P' },
        },
        {
          indexNo: '2',
          fullName: 'AMATE, Jaiden Matthew A.',
          marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
        },
      ],
      dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
    },
    term: '3',
    course: 'Primary One',
    sectionLabel: 'Patience (Global)',
    formAdviser: 'Ms. Kristel',
    legendGroups: {
      ...emptyLegendGroups(),
      schoolHoliday: [{ dateText: '6-Jul', label: 'In Lieu of Youth Day' }],
      schoolEvents: [
        { dateText: '21-Jul', label: 'Racial Harmony Celebration' },
      ],
    },
    dateTags: { '6-Jul': 'SH', '21-Jul': 'SE' },
    ...overrides,
  };
}

describe('buildAttendanceImportT3', () => {
  it('classifies dates via row-11 tags + legend labels, builds attendance rows, and computes stats', () => {
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.schoolDays).toBe(2); // 29-Jun, 21-Jul (SE, has marks)
    expect(result.stats.holidays).toBe(1); // 6-Jul (SH)
    expect(result.stats.events).toBe(1); // 21-Jul's school_event
    expect(result.stats.eventsMissingLabel).toBe(0);
    expect(result.stats.attendanceRows).toBe(3); // Alvarez P x2, Amate P x1
    expect(result.stats.needsReview).toBe(0);

    expect(apply).toContain("'ss-alvarez-uuid'");
    expect(apply).toContain("'2026-06-29'");
    expect(apply).toContain("'school_holiday'");
    expect(apply).toContain("'Racial Harmony Celebration'");
    expect(apply).toContain("'school_event'");

    const holidayMarkLine = apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-07-06') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
  });

  it('normalizes a "Section - N" sheet name to the DB\'s "Section N" naming before roster lookup', () => {
    const section = buildSection({
      section: {
        sheetName: 'S1 Discipline - 1',
        students: [
          {
            indexNo: '1',
            fullName: 'CRUZ, Juan A.',
            marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const roster: RosterLookupEntry[] = [
      {
        levelCode: 'S1',
        cleanName: 'Discipline 1',
        indexNumber: 1,
        sectionStudentId: 'ss-cruz-uuid',
      },
    ];
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: roster,
    });
    expect(result.stats.needsReview).toBe(0);
    expect(joinApply(result.applyFiles)).toContain("'ss-cruz-uuid'");
  });

  it('flags an unresolved (section, index_number) pair as needs-review', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '99',
            fullName: 'NOBODY, Unresolved',
            marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(1);
    expect(joinApply(result.applyFiles)).not.toContain('NOBODY');
  });

  it('flags an unexpected mark value as needs-review instead of writing invalid SQL', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '1',
            fullName: 'ALVAREZ, Jaime III D.',
            marks: { '29-Jun': 'Q', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(1);
    expect(joinApply(result.applyFiles)).not.toContain("'Q'");
  });

  it('normalizes a lowercase mark before writing it', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '1',
            fullName: 'ALVAREZ, Jaime III D.',
            marks: { '29-Jun': 'p', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(0);
    expect(joinApply(result.applyFiles)).toContain("date '2026-06-29', 'P'");
  });

  it('excludes the YS sheet from the import', () => {
    const section = buildSection({
      section: {
        sheetName: 'YS',
        students: [
          {
            indexNo: '1',
            fullName: 'NURSERY, Someone A.',
            marks: { '29-Jun': 'Present' },
          },
        ],
        dateColumns: ['29-Jun'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.attendanceRows).toBe(0);
    expect(joinApply(result.applyFiles)).not.toContain('NURSERY');
  });

  describe('event label handling', () => {
    it('skips an SE/EX-tagged date with no matching legend entry from calendar_events, flags it in stats + preview', () => {
      const section = buildSection({
        dateTags: { '21-Jul': 'SE' },
        legendGroups: emptyLegendGroups(),
      });
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [section],
        rosterLookup: ROSTER,
      });
      expect(result.stats.events).toBe(1);
      expect(result.stats.eventsMissingLabel).toBe(1);
      expect(result.preview).toContain('NEEDS LABEL');
      expect(joinApply(result.applyFiles)).not.toContain('school_event');
    });
  });

  describe('apply file chunking', () => {
    it('splits marks into multiple self-contained, ordered files, with calendar + events always first', () => {
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });
      // calendar (1) + events (1) + 3 marks chunks (3 attendanceRows) + rollups (1) = 6
      expect(result.applyFiles).toHaveLength(6);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-events.sql');
      expect(result.applyFiles[2].filename).toBe('03-marks-01-of-03.sql');
      expect(result.applyFiles[5].filename).toBe('06-rollups-and-verify.sql');
      for (const f of result.applyFiles) {
        expect(f.sql).toContain('begin;');
        expect(f.sql).toContain('commit;');
      }
    });

    it('produces one un-split marks file when the default chunk size comfortably covers all rows', () => {
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
      });
      const marksFiles = result.applyFiles.filter((f) =>
        f.filename.includes('-marks-')
      );
      expect(marksFiles).toHaveLength(1);
      expect(marksFiles[0].filename).toBe('03-marks-01-of-01.sql');
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/build-attendance-import-t3'`

- [ ] **Step 3: Implement the composer**

Create `lib/sis/backfill/attendance/build-attendance-import-t3.ts`:

```ts
// lib/sis/backfill/attendance/build-attendance-import-t3.ts
// Composes attendance-workbook-t3 + day-classifier-t3 + legend-dates-t3
// (plus Phase 1's section-identity + sql-escape, and legend-parser's date
// resolver) into the SQL artifacts described by the design doc: a
// read-only preview report and a transactional, idempotent apply script
// split into chunked files from the start (T2's tuned ~150KB/file
// target). No I/O — takes already-parsed sections and an already-fetched
// roster lookup.
import { deriveSectionIdentity } from '../enrollment/section-identity';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import { resolveHeaderDate } from './legend-parser';
import { parseLegendDateTextT3 } from './legend-dates-t3';
import {
  classifyDatesT3,
  type DateClassificationT3,
  type EventCategoryT3,
} from './day-classifier-t3';
import type { LegendGroupT3, ParsedSectionT3 } from './attendance-workbook-t3';
import type { RosterLookupEntry } from './build-attendance-import';

export type { RosterLookupEntry };

export interface BuildAttendanceImportT3Input {
  sections: ParsedSectionT3[];
  rosterLookup: RosterLookupEntry[];
  ayCode: string;
  termNumber: number;
  year: number;
  // Overridable only for tests — forces multi-file splitting with a small
  // synthetic fixture instead of needing thousands of rows.
  marksChunkSize?: number;
}

interface AttendanceRow {
  sectionStudentId: string;
  date: string;
  status: 'P' | 'A' | 'EX' | 'L';
}

interface NeedsReviewRow {
  sheetName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

export interface ApplySqlFile {
  filename: string;
  sql: string;
  description: string;
}

export interface BuildAttendanceImportT3Result {
  preview: string;
  applyFiles: ApplySqlFile[];
  stats: {
    schoolDays: number;
    holidays: number;
    events: number;
    eventsMissingLabel: number;
    attendanceRows: number;
    needsReview: number;
    excludedNonCore: string[];
    unrecognized: string[];
    skippedEmpty: string[];
    unparseableDateHeaders: string[];
  };
}

const VALID_MARKS = new Set(['P', 'A', 'EX', 'L']);
const DEFAULT_MARKS_CHUNK_SIZE = 2000; // T2's tuned threshold — reused as-is
const LEGEND_GROUPS: LegendGroupT3[] = [
  'schoolEvents',
  'schoolHoliday',
  'publicHoliday',
  'examination',
];

// "S1 Discipline - 1" -> "Discipline 1" (design doc §1 point 7 / §2
// Locked Decision 1) — sheet names suffix split sections with " - N",
// the live DB names them "N" with no dash.
function normalizeCleanNameT3(cleanName: string): string {
  return cleanName.replace(/\s*-\s*(\d+)$/, ' $1');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function padFileNum(n: number): string {
  return String(n).padStart(2, '0');
}

function sanitizeComment(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

export function buildAttendanceImportT3(
  input: BuildAttendanceImportT3Input
): BuildAttendanceImportT3Result {
  const { sections, rosterLookup, ayCode, termNumber, year } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.cleanName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const excludedNonCore: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const coreSections: {
    parsed: ParsedSectionT3;
    levelCode: string;
    cleanName: string;
  }[] = [];

  for (const parsed of sections) {
    if (parsed.section.students.length === 0) {
      skippedEmpty.push(parsed.section.sheetName);
      continue;
    }
    const identity = deriveSectionIdentity(parsed.section.sheetName);
    if (identity.kind === 'ys') {
      excludedNonCore.push(parsed.section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(parsed.section.sheetName);
      continue;
    }
    coreSections.push({
      parsed,
      levelCode: identity.levelCode,
      cleanName: normalizeCleanNameT3(identity.cleanName),
    });
  }

  // --- Date resolution (once, across all core sections) ---
  const allDatesRaw = coreSections[0]?.parsed.section.dateColumns ?? [];
  const allDatesISO: (string | null)[] = allDatesRaw.map((d) =>
    resolveHeaderDate(d, year)
  );
  const unparseableDateHeaders: string[] = [];
  allDatesRaw.forEach((raw, i) => {
    if (allDatesISO[i] === null) unparseableDateHeaders.push(raw);
  });

  // --- Row-11 tags (shared across sections for a given date — first found wins) ---
  const tagByDate = new Map<string, string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate || tagByDate.has(isoDate)) continue;
    for (const { parsed } of coreSections) {
      const tag = parsed.dateTags[rawDate];
      if (tag) {
        tagByDate.set(isoDate, tag);
        break;
      }
    }
  }

  // --- Legend labels (section-specific content, merged across all groups + sections) ---
  const legendLabelByDate = new Map<string, string>();
  for (const { parsed } of coreSections) {
    for (const group of LEGEND_GROUPS) {
      for (const entry of parsed.legendGroups[group]) {
        for (const isoDate of parseLegendDateTextT3(entry.dateText, year)) {
          if (!legendLabelByDate.has(isoDate))
            legendLabelByDate.set(isoDate, entry.label);
        }
      }
    }
  }

  // --- Blank-date aggregation, for untagged columns only ---
  const blankDates = new Set<string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate) continue;
    const allBlank = coreSections.every(({ parsed }) =>
      parsed.section.students.every((s) => !(s.marks[rawDate] ?? '').trim())
    );
    if (allBlank) blankDates.add(isoDate);
  }

  const validDatesISO = allDatesISO.filter((d): d is string => d !== null);
  const classifications = classifyDatesT3(
    validDatesISO,
    tagByDate,
    legendLabelByDate,
    blankDates
  );
  const dayTypeByDate = new Map(classifications.map((c) => [c.date, c]));

  // --- Attendance rows + needs-review ---
  const attendanceRows: AttendanceRow[] = [];
  const needsReview: NeedsReviewRow[] = [];

  for (const { parsed, levelCode, cleanName } of coreSections) {
    for (const student of parsed.section.students) {
      const key = `${levelCode}::${cleanName}::${Number.parseInt(student.indexNo, 10)}`;
      const sectionStudentId = rosterMap.get(key);
      if (!sectionStudentId) {
        needsReview.push({
          sheetName: parsed.section.sheetName,
          indexNo: student.indexNo,
          fullName: student.fullName,
          reason: `no matching section_students row for index ${student.indexNo}`,
        });
        continue;
      }

      for (let i = 0; i < allDatesRaw.length; i++) {
        const rawDate = allDatesRaw[i];
        const isoDate = allDatesISO[i];
        if (!isoDate) continue;
        const classification = dayTypeByDate.get(isoDate);
        if (!classification || classification.dayType !== 'school_day')
          continue;

        const rawMark = (student.marks[rawDate] ?? '').trim();
        if (!rawMark) continue;
        const mark = rawMark.toUpperCase();
        if (!VALID_MARKS.has(mark)) {
          needsReview.push({
            sheetName: parsed.section.sheetName,
            indexNo: student.indexNo,
            fullName: student.fullName,
            reason: `unexpected mark "${rawMark}" on ${isoDate}`,
          });
          continue;
        }
        attendanceRows.push({
          sectionStudentId,
          date: isoDate,
          status: mark as AttendanceRow['status'],
        });
      }
    }
  }

  const stats: BuildAttendanceImportT3Result['stats'] = {
    schoolDays: classifications.filter((c) => c.dayType === 'school_day')
      .length,
    holidays: classifications.filter((c) => c.dayType !== 'school_day').length,
    events: classifications.filter((c) => c.event !== null).length,
    eventsMissingLabel: classifications.filter((c) => c.event?.labelMissing)
      .length,
    attendanceRows: attendanceRows.length,
    needsReview: needsReview.length,
    excludedNonCore,
    unrecognized,
    skippedEmpty,
    unparseableDateHeaders,
  };

  const markChunks = chunkArray(
    attendanceRows,
    input.marksChunkSize ?? DEFAULT_MARKS_CHUNK_SIZE
  );
  const applyFiles = buildApplyFiles(
    ayCode,
    termNumber,
    classifications,
    markChunks
  );

  return {
    preview: buildPreviewSql(
      termNumber,
      classifications,
      needsReview,
      stats,
      applyFiles
    ),
    applyFiles,
    stats,
  };
}

function buildPreviewSql(
  termNumber: number,
  classifications: DateClassificationT3[],
  needsReview: NeedsReviewRow[],
  stats: BuildAttendanceImportT3Result['stats'],
  applyFiles: ApplySqlFile[]
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${termNumber} attendance import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t3-attendance.ts from the T3 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Date classification (${classifications.length} dates):`);
  for (const c of classifications) {
    const label = c.label ? ` "${sanitizeComment(c.label)}"` : '';
    const event = c.event
      ? ` [event:${c.event.category}${c.event.labelMissing ? ' NEEDS LABEL' : ''}]`
      : '';
    lines.push(`--   ${c.date}: ${c.dayType}${event}${label}`);
  }
  lines.push('--');
  lines.push(
    `-- school_days=${stats.schoolDays} holidays=${stats.holidays} events=${stats.events} attendanceRows=${stats.attendanceRows}`
  );
  lines.push('--');
  lines.push(
    `-- Events missing a label (${stats.eventsMissingLabel}) — NOT written to calendar_events,`
  );
  lines.push('-- add these by hand after checking the source workbook:');
  const missingLabel = classifications.filter((c) => c.event?.labelMissing);
  if (missingLabel.length === 0) lines.push('--   (none)');
  for (const c of missingLabel) {
    lines.push(`--   ${c.date}: [${c.event!.category}]`);
  }
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (non-core tabs, e.g. YS): ${stats.excludedNonCore.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Unrecognized sheet names: ${stats.unrecognized.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Unparseable date headers (ignored, no data written for these): ${stats.unparseableDateHeaders.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by any apply file:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${sanitizeComment(r.sheetName)}] index ${sanitizeComment(r.indexNo)} "${sanitizeComment(r.fullName)}" — ${sanitizeComment(r.reason)}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Apply files (${applyFiles.length}) — run every file IN ORDER, each is`
  );
  lines.push(
    '-- its own transaction and safe to re-run (idempotent) if you retry:'
  );
  for (const f of applyFiles) {
    lines.push(`--   ${f.filename} — ${sanitizeComment(f.description)}`);
  }
  return lines.join('\n') + '\n';
}

function applyFileHeader(
  termNumber: number,
  fileNum: number,
  totalFiles: number,
  title: string
): string[] {
  return [
    `-- AY2026 T${termNumber} attendance import — APPLY file ${fileNum} of ${totalFiles}: ${title}`,
    '--',
    `-- RUN ay2026-t${termNumber}-attendance-preview.sql FIRST, and run apply files`,
    '-- IN ORDER (see the "Apply files" list at the end of the preview).',
    '-- Generated by gen-ay2026-t3-attendance.ts — do not hand-edit; regenerate',
    '-- instead. Each file is its own transaction and is safe to re-run',
    '-- (idempotent) if you need to retry.',
    '--',
  ];
}

function buildApplyFiles(
  ayCode: string,
  termNumber: number,
  classifications: DateClassificationT3[],
  markChunks: AttendanceRow[][]
): ApplySqlFile[] {
  const totalFiles = 2 + markChunks.length + 1; // calendar + events + marks chunks + rollups
  const files: ApplySqlFile[] = [];
  let fileNum = 1;

  // --- File: school_calendar ---
  {
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'school_calendar'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att3_calendar;');
    lines.push(
      'create temp table _ay26att3_calendar (date, day_type, hbl_overlay, label) as'
    );
    lines.push('values');
    const calendarRows = classifications.map(
      (c) =>
        `  (date ${sqlString(c.date)}, ${sqlString(c.dayType)}, false, ${sqlStringOrNull(c.label)})`
    );
    lines.push(
      (calendarRows.length
        ? calendarRows.join(',\n')
        : "  (date '1970-01-01', 'school_day', false, NULL)") + ';'
    );
    lines.push('');
    lines.push(
      'insert into school_calendar (term_id, date, day_type, hbl_overlay, label)'
    );
    lines.push('select t.id, c.date, c.day_type, c.hbl_overlay, c.label');
    lines.push('from _ay26att3_calendar c');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('on conflict (term_id, audience, date) do nothing;');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-calendar.sql`,
      sql: lines.join('\n') + '\n',
      description: `school_calendar (${classifications.length} rows)`,
    });
    fileNum++;
  }

  // --- File: calendar_events ---
  {
    const eventRows: {
      date: string;
      category: EventCategoryT3;
      label: string;
    }[] = classifications
      .filter((c) => c.event !== null && c.event.label !== null)
      .map((c) => ({
        date: c.date,
        category: c.event!.category,
        label: c.event!.label as string,
      }));
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'calendar_events'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att3_events;');
    lines.push('create temp table _ay26att3_events (date, category, label) as');
    lines.push('values');
    const rows = eventRows.map(
      (e) =>
        `  (date ${sqlString(e.date)}, ${sqlString(e.category)}, ${sqlString(e.label)})`
    );
    lines.push(
      (rows.length
        ? rows.join(',\n')
        : "  (date '1970-01-01', 'other', 'placeholder')") + ';'
    );
    lines.push('');
    lines.push(
      'insert into calendar_events (term_id, start_date, end_date, label, audience, category)'
    );
    lines.push("select t.id, e.date, e.date, e.label, 'all', e.category");
    lines.push('from _ay26att3_events e');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('where not exists (');
    lines.push('  select 1 from calendar_events ce');
    lines.push('  where ce.term_id = t.id');
    lines.push('    and ce.start_date = e.date');
    lines.push('    and ce.end_date = e.date');
    lines.push('    and ce.category = e.category');
    lines.push(');');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-events.sql`,
      sql: lines.join('\n') + '\n',
      description: `calendar_events (${eventRows.length} rows)`,
    });
    fileNum++;
  }

  // --- Files: attendance_daily marks, chunked ---
  markChunks.forEach((chunkRows, idx) => {
    const chunkLabel = `chunk ${idx + 1} of ${markChunks.length}`;
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      `attendance_daily marks (${chunkLabel}, ${chunkRows.length} rows)`
    );
    lines.push(
      '-- ex_reason is always NULL — the source workbook has no sub-reason data'
    );
    lines.push(
      '-- for EX marks (written explicitly, not omitted, so this is visible here)'
    );
    lines.push('begin;');
    lines.push('');
    lines.push('drop table if exists _ay26att3_marks;');
    lines.push(
      'create temp table _ay26att3_marks (section_student_id, date, status) as'
    );
    lines.push('values');
    const markRows = chunkRows.map(
      (r) =>
        `  (${sqlString(r.sectionStudentId)}, date ${sqlString(r.date)}, ${sqlString(r.status)})`
    );
    lines.push(markRows.join(',\n') + ';');
    lines.push('');
    lines.push(
      'insert into attendance_daily (section_student_id, term_id, date, status, ex_reason, period_id, recorded_by, recorded_at)'
    );
    lines.push(
      'select m.section_student_id::uuid, t.id, m.date, m.status, null, null, null, now()'
    );
    lines.push('from _ay26att3_marks m');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push(
      `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
    );
    lines.push('where not exists (');
    lines.push('  select 1 from attendance_daily ad');
    lines.push('  where ad.section_student_id = m.section_student_id::uuid');
    lines.push('    and ad.date = m.date');
    lines.push('    and ad.period_id is null');
    lines.push(');');
    lines.push('');
    lines.push('commit;');
    files.push({
      filename: `${padFileNum(fileNum)}-marks-${padFileNum(idx + 1)}-of-${padFileNum(markChunks.length)}.sql`,
      sql: lines.join('\n') + '\n',
      description: `attendance_daily marks — ${chunkLabel} (${chunkRows.length} rows)`,
    });
    fileNum++;
  });

  // --- File: rollups + verification ---
  {
    const distinctStudentIds = [
      ...new Set(markChunks.flat().map((r) => r.sectionStudentId)),
    ];
    const lines = applyFileHeader(
      termNumber,
      fileNum,
      totalFiles,
      'rollups + verification'
    );
    lines.push('begin;');
    lines.push('');
    for (const id of distinctStudentIds) {
      lines.push(
        `select public.recompute_attendance_rollup(t.id, ${sqlString(id)}::uuid) from academic_years ay join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber} where ay.ay_code = ${sqlString(ayCode)};`
      );
    }
    lines.push('');
    lines.push('-- pre-commit sanity check');
    lines.push('select');
    lines.push(
      `  (select count(*) from school_calendar sc join terms t on t.id=sc.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as calendar_count,`
    );
    lines.push(
      `  (select count(*) from calendar_events ce join terms t on t.id=ce.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as events_count,`
    );
    lines.push(
      `  (select count(*) from attendance_records ar join terms t on t.id=ar.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber}) as rollup_count;`
    );
    lines.push(
      `-- expect calendar_count ~= ${classifications.length}, rollup_count ~= ${distinctStudentIds.length}`
    );
    lines.push('');
    lines.push('commit;');
    lines.push('');
    lines.push('-- === post-commit verification ===');
    lines.push(
      `select count(*) as attendance_daily_rows from attendance_daily ad join terms t on t.id=ad.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
    );
    files.push({
      filename: `${padFileNum(fileNum)}-rollups-and-verify.sql`,
      sql: lines.join('\n') + '\n',
      description: `rollups + verification (${distinctStudentIds.length} students)`,
    });
    fileNum++;
  }

  return files;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts`
Expected: PASS (9 tests — 6 named + 1 in the event-label-handling describe block + 2 in the chunking describe block)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/build-attendance-import-t3.ts __tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts
git commit -m "feat(backfill): compose AY2026 T3 attendance import SQL, incl. calendar_events"
```

---

### Task 5: Orchestrator script, gitignore, full suite run, real generation

**Files:**

- Create: `scripts/backfill/gen-ay2026-t3-attendance.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseWorkbookT3` from Task 1, `buildAttendanceImportT3` + `RosterLookupEntry` from Task 4, `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks — this is the final task. Writes `scripts/backfill/ay2026-t3-attendance-preview.sql` and `scripts/backfill/ay2026-t3-attendance-apply/*.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t3-attendance.ts`:

```ts
// scripts/backfill/gen-ay2026-t3-attendance.ts
// Generates ay2026-t3-attendance-preview.sql + a chunked set of apply files
// under ay2026-t3-attendance-apply/ from HFSE's real T3 attendance
// workbook. Emits SQL for review — does NOT write to the database itself.
// See:
// docs/superpowers/specs/2026-07-21-ay2026-t3-attendance-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';
import { buildAttendanceImportT3 } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const WORKBOOK_PATH = 'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx';

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbookT3(WORKBOOK_PATH);

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    cleanName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  const result = buildAttendanceImportT3({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t3-attendance-preview.sql',
    result.preview
  );

  const applyDir = 'scripts/backfill/ay2026-t3-attendance-apply';
  // Clear stale files from a prior run (e.g. a different chunk count) so
  // the directory never mixes filenames from two generations.
  rmSync(applyDir, { recursive: true, force: true });
  mkdirSync(applyDir, { recursive: true });
  for (const f of result.applyFiles) {
    writeFileSync(join(applyDir, f.filename), f.sql);
  }

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t3-attendance-preview.sql');
  console.log(
    `Wrote ${result.applyFiles.length} apply files to ${applyDir}/ — run them IN ORDER (see preview.sql).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the gitignore entries**

Modify `.gitignore` — append at the end of the file (after the existing `scripts/backfill/ay2026-t2-attendance-apply/` line):

```

# AY2026 T3 attendance import output (real student PII — attendance marks
# keyed by section_student_id). Generated by gen-ay2026-t3-attendance.ts;
# apply is split into multiple chunked files under apply/ since the
# combined query is too large for the Supabase SQL Editor. Review locally,
# never commit.
scripts/backfill/ay2026-t3-attendance-preview.sql
scripts/backfill/ay2026-t3-attendance-apply/
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every prior Phase 1/2/3/T2 test plus the 30 new tests from Tasks 1–4 (6 + 7 + 8 + 9 = 30 new), all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t3-attendance.ts .gitignore
git commit -m "feat(backfill): add AY2026 T3 attendance import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance.ts`
Expected: prints a `Stats:` block with `schoolDays` + `holidays` summing to T3's 68 real date columns, `events` around the count of `SE`/`EX`-tagged dates (roughly one per section-specific legend entry, deduplicated by date), `attendanceRows` in the same order of magnitude as T1/T2's runs (roster × school days), `needsReview` near 0, and `eventsMissingLabel` reporting how many tagged dates had no resolvable legend label. Read `scripts/backfill/ay2026-t3-attendance-preview.sql` in full and hand-verify: (1) the 3-Sep date (conflicting legend text — "Teachers and ANTS Day" under School Events vs. "Teacher's Day" under School Holiday) classified as `school_day` + `school_event`, never `school_holiday`, matching the confirmed row-11 tag; (2) every `eventsMissingLabel` date against the real workbook — add its `calendar_events` row by hand once the correct label is confirmed; (3) a handful of `SH`/`PH`/`SE`/`EX` dates spot-checked against the source file's legend blocks; (4) the apply file run order. **Do not run any apply file against the database in this step** — that's a separate, explicit action after this review.

---

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 Locked Decisions 1–7 are each implemented — scope/exclusion (Task 4's reuse of `deriveSectionIdentity` + `excludedNonCore`/`unrecognized`/`skippedEmpty`, tested), the corrected roster-parser decision (Task 1, tested directly against a fixture that proves the header-row rule skips the legend rows' own scattered dates), row-11-tag-driven day-type (Task 3, tested per tag), `calendar_events` scoped to `SE`/`EX` only with the `NOT NULL` label constraint respected (Task 3's `labelMissing` + Task 4's filter before emitting the temp table, tested), the day-first legend date-text parser (Task 2, tested per shape), `ex_reason`/roster-resolution/chunking (Task 4, ported from T2's proven shapes), and `school_calendar`/`calendar_events` population with `audience='all'` (Task 4's apply files). §3's algorithm and §5's SQL write plan map 1:1 onto Task 4. §6's validation plan is Task 5 Step 5 (generator run + hand read of preview.sql, including the explicit 3-Sep conflict check and the instruction not to apply yet). §7's "reused, not retested" instruction for `sql-escape`/`legend-parser`'s date resolution is satisfied by importing those modules as-is; the genuinely new pieces (header-row detection, legend groups, date-list/range parsing, tag classification) all get fresh test coverage.
- **Placeholder scan:** none found — every step has complete, runnable code; no "TBD"/"similar to Task N" shortcuts.
- **Type consistency:** `ParsedSectionT3` (Task 1's producer) is consumed unchanged by Task 4's `BuildAttendanceImportT3Input.sections`. `LegendGroupT3`/`LegendEntryT3` names match between Task 1's export and Task 4's `LEGEND_GROUPS` iteration + test fixtures. `DateClassificationT3`/`DayType`/`EventCategoryT3` from Task 3 match exactly what Task 4 imports and destructures (`dayType`, `label`, `event.category`, `event.label`, `event.labelMissing`) — verified field-by-field against both the test assertions and the `buildPreviewSql`/`buildApplyFiles` consumers. `RosterLookupEntry` is imported from the existing `build-attendance-import.ts` (not redefined) and re-exported by Task 4's module, matching T2's exact pattern, so Task 5's orchestrator has one canonical import path.
- **Ambiguity resolved during planning:** the design doc's Locked Decision #5 originally said an unmatched-label tagged date "still gets its `calendar_events` row, with a placeholder label" — checked against the actual schema (`calendar_events.label text not null`, no default) and that's impossible without violating the constraint. Corrected in the design doc (committed separately, before this plan was written) to: no row is written, the date is flagged `labelMissing` in stats + preview, and a human adds it by hand after confirming the real label. Task 3's `classifyDatesT3` and Task 4's `buildApplyFiles` both implement this corrected behavior, and it's explicitly tested in Task 4's "event label handling" describe block.
- **Architecture correction found during planning:** the original design assumed Phase 1's `parseSheet` could be reused unmodified for T3's roster (matching T1→T2 precedent). Running it against the real file during plan-writing proved this wrong — T3's legend rows contain scattered dates in the same shape `parseSheet`'s header-row scan looks for, so it locks onto the wrong row. This is why Task 1 builds a new roster/marks parser (adapted logic, not a call to `parseSheet`) instead of the originally-planned reuse — reflected in both the design doc (corrected, committed) and this plan's Global Constraints.

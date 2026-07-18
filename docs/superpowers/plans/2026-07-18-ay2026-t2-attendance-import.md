# AY2026 T2 Attendance Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reviewable `preview.sql` / chunked `apply/*.sql` files that import HFSE's real AY2026 T2 daily attendance (P/A/EX/L marks, 22 real sections, 24-Mar–28-May 2026) into `attendance_daily` + `school_calendar`, without ever writing to the database directly from this codebase.

**Architecture:** Reuse Phase 2's already-shipped, already-tested roster/date-column parser (`enrollment/attendance-workbook.ts::parseSheet`) as-is for the roster grid — it locates the date columns and the `Full Name` column dynamically (regex + relative offset), so T2's two extra leading columns (`Bus No.`, `Classroom Officers`) never touch it. Layer one small new module on top (`attendance-workbook-t2.ts`) that additionally extracts T2's row-8 date-aligned event labels — a capability T1's masthead didn't have and didn't need. A new pure classifier (`day-classifier-t2.ts`) turns those direct date→label lookups into day types via an explicit public-holiday whitelist, flagging any unmatched label for human confirmation instead of guessing. A new composer (`build-attendance-import-t2.ts`) wires roster resolution + date classification + SQL emission together, following Phase 2's exact chunked-apply-files shape (the Supabase SQL Editor's size limit fix, built in from the start this time). One orchestrator script wires DB reads + file parsing + the composer together and writes the two output artifacts — it contains no business logic itself.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-18-ay2026-t2-attendance-import-design.md` — read it before starting; every task below implements a piece of it.
- Scope is the same 22 real sections Phase 2 already covers (all of P1–P6 and S1–S4, both Global and Regular tracks) — `YS` and every `Reserved N` tab are excluded (Locked Decisions #1–2). `deriveSectionIdentity` (existing, `lib/sis/backfill/enrollment/section-identity.ts`) already implements this exclusion — reused as-is, never modified.
- Column layout is located by header label / relative offset, never a fixed column index (Locked Decision #3) — satisfied by reusing `parseSheet` as-is, which already does this.
- Day-type classification stays data-driven: a date is `school_day` if **any** roster cell anywhere is non-blank; a date where every cell across every section is blank is a holiday/no-class date (Locked Decision #4). This primary signal is computed the same way Phase 2 computed it — never touch this part of the algorithm.
- Legend labeling uses row 8 (the row directly above the date-header row) as the **only** label source for T2 — never the free-text "School Holiday"/"Important dates" summary table (Locked Decision #5). T2's parser therefore never calls Phase 2's `legend-parser.ts::parseLegendDateRange` for masthead text, though it does still reuse `resolveHeaderDate` from that same file (T2's date-column headers are still `"D-Mon"`-shaped).
- HBL / public holiday / no-class sub-classification (Locked Decision #6, exact wording from the design doc): a blank date whose label mentions `"HBL"` (case-insensitive) → `school_holiday` + `hbl_overlay=true`. A blank date whose label is **exactly** one of `Good Friday`, `Labor Day`, `Vesak Day`, `Hari Raya Haji` → `public_holiday`. Everything else → `no_class`. A blank date with a **non-empty** label that matched neither rule is additionally flagged (`needsConfirmation: true`) so a human confirms it before the apply files run; a blank date with **no** label at all is `no_class` and never flagged (there is nothing to confirm — no candidate holiday name is being silently dropped).
- `ex_reason` is always `NULL`, roster resolution is via `(levelCode, cleanName, index_number)` lookup with unresolved rows going to needs-review, `attendance_daily` has no natural unique constraint so a per-row `WHERE NOT EXISTS` guard applies, and `"-"` (the workbook's own "No Class" legend symbol) is tracked as a distinct, non-error needs-review reason — all identical to Phase 2, reused verbatim in the new composer (Locked Decision #7).
- `school_calendar` population is in scope for T2's full date range (Locked Decision #8), `on conflict (term_id, audience, date) do nothing`.
- The Supabase SQL Editor rejects one very large query (Phase 2's measured failure: a 1.18MB/16,143-row single transaction). `apply.sql` is split into multiple self-contained, idempotent chunk files from the start — target ~150KB/file, `DEFAULT_MARKS_CHUNK_SIZE = 2000` matching Phase 2's tuned value (Locked Decision #7 / design doc §5).
- No code in this plan ever writes to the database. The orchestrator only reads (for AY/roster lookups) and writes local `.sql` files.
- Reuse `lib/sis/backfill/enrollment/sql-escape.ts` (`sqlString`, `sqlStringOrNull`) as-is for every SQL string literal — the same shared utility every prior phase uses.
- Output files (`scripts/backfill/ay2026-t2-attendance-preview.sql`, `scripts/backfill/ay2026-t2-attendance-apply/*.sql`) contain real student attendance data (PII) — must be gitignored, matching Phases 1–3's pattern.
- Do not modify any Phase 1/2/3 file. Every new capability for T2 lives in a new file; existing modules are imported and reused, never edited.

---

### Task 1: T2 workbook parser (reuse Phase 2's roster parser + new row-8 label extraction)

**Files:**

- Create: `lib/sis/backfill/attendance/attendance-workbook-t2.ts`
- Test: `__tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts`

**Interfaces:**

- Consumes: `parseSheet`, `ParsedSection` from `@/lib/sis/backfill/enrollment/attendance-workbook` (existing, Phase 2 — imported and called as-is, never modified). Uses `xlsx` (`import * as XLSX from 'xlsx'`), the same library every parser in this codebase already uses.
- Produces (consumed by Task 3):

  ```ts
  export interface ParsedSectionWithLabels {
    section: ParsedSection;
    // Date-column header string (e.g. "3-Apr") -> the label printed in
    // that column on the row directly above the date-header row. Only
    // non-blank cells are included.
    dateLabels: Record<string, string>;
  }

  export function extractDateAlignedLabels(
    ws: XLSX.WorkSheet
  ): Record<string, string>;

  export function parseSheetT2(
    ws: XLSX.WorkSheet,
    sheetName: string
  ): ParsedSectionWithLabels;

  export function parseWorkbookT2(filePath: string): ParsedSectionWithLabels[];
  ```

**Why this shape:** `parseSheet` doesn't expose the header row's index or its date-column indices to callers (it only returns the resolved `dateColumns: string[]`), so `extractDateAlignedLabels` does its own small, independent re-scan of the same raw rows to find those two things — this duplicates roughly 10 lines of row/column-location logic, never the ~90-line roster-parsing loop, which stays fully owned by the reused `parseSheet`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts`:

```ts
// __tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  extractDateAlignedLabels,
  parseSheetT2,
  type ParsedSectionWithLabels,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t2';

// Mirrors the real T2 masthead shape: 5 header columns before dates begin
// (Index No | Bus No. | Leave info | Classroom Officers | Full Name),
// confirmed identical across every sampled P1-S4 section (design doc §1,
// point 1) — two more than a hypothetical bare "Index No | Full Name"
// shape, exercising Locked Decision #3 (column layout located by label /
// relative offset, never a fixed index). Row 8 (index 8, directly above
// the date-header row at index 9) carries "Good Friday" aligned under the
// "3-Apr" column and is blank everywhere else (design doc §1, point 2).
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = ['', '', '', '', '', '', ''];
  rows[1] = [
    'Legend:',
    '',
    '',
    '',
    'Attendance for the month of',
    'April 2026',
    '',
  ];
  rows[2] = [
    '-',
    'No Class',
    '',
    '',
    'Class Section',
    'P1 Patience (AM Global)',
    '',
  ];
  rows[3] = ['P', 'Present', '', '', 'Form Teacher', 'Ms. Kristel', ''];
  rows[4] = ['A', 'Absent', '', '', '', '', ''];
  rows[5] = ['EX', 'Excused', '', '', '', '', ''];
  rows[6] = ['L', 'Late', '', '', '', '', ''];
  rows[7] = ['', '', '', '', '', '', ''];
  rows[8] = ['', '', '', '', '', 'Good Friday', ''];
  rows[9] = [
    'Index \nNo',
    'Bus No.',
    'Leave info',
    'Classroom Officers',
    'Full Name',
    '3-Apr',
    '6-Apr',
  ];
  rows[10] = ['1', 'HAPI HAUS', '', '', 'ALVAREZ, Jaime III D.', '', 'P'];
  rows[11] = ['2', '', '', '', 'AMATE, Jaiden Matthew A.', '', 'P'];
  return rows;
}

describe('extractDateAlignedLabels', () => {
  it('reads the label aligned to its date column from the row directly above the header row', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    expect(extractDateAlignedLabels(ws)).toEqual({ '3-Apr': 'Good Friday' });
  });

  it('omits a date column whose row-8 cell is blank', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const labels = extractDateAlignedLabels(ws);
    expect(labels['6-Apr']).toBeUndefined();
  });

  it('returns an empty object when no date-header row is found', () => {
    const rows = buildFixtureRows();
    rows[9] = [
      'Index \nNo',
      'Bus No.',
      'Leave info',
      'Classroom Officers',
      'Full Name',
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    expect(extractDateAlignedLabels(ws)).toEqual({});
  });
});

describe('parseSheetT2', () => {
  it('combines the reused roster parser with the new date-label extraction', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result: ParsedSectionWithLabels = parseSheetT2(ws, 'P1 Patience(G)');

    // Roster/date parsing is fully delegated to parseSheet (Phase 2,
    // reused as-is) — proves the 2 extra leading columns (Bus No.,
    // Classroom Officers) don't need any T2-specific handling here.
    expect(result.section.sheetName).toBe('P1 Patience(G)');
    expect(result.section.dateColumns).toEqual(['3-Apr', '6-Apr']);
    expect(result.section.students).toEqual([
      {
        indexNo: '1',
        fullName: 'ALVAREZ, Jaime III D.',
        marks: { '3-Apr': '', '6-Apr': 'P' },
      },
      {
        indexNo: '2',
        fullName: 'AMATE, Jaiden Matthew A.',
        marks: { '3-Apr': '', '6-Apr': 'P' },
      },
    ]);

    expect(result.dateLabels).toEqual({ '3-Apr': 'Good Friday' });
  });

  it('returns an empty roster for a Reserved-tab-shaped empty sheet, independent of dateLabels', () => {
    // dateLabels extraction reads only the masthead row above the header
    // row — it doesn't depend on roster content, so it stays populated
    // even when every roster row is blank (a genuinely empty "Reserved N"
    // tab still has its own masthead).
    const rows = buildFixtureRows();
    rows[10] = ['1', '', '', '', '', '', ''];
    rows[11] = ['2', '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheetT2(ws, 'Reserved 1');

    expect(result.section.students).toEqual([]);
    expect(result.dateLabels).toEqual({ '3-Apr': 'Good Friday' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/attendance-workbook-t2'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/attendance/attendance-workbook-t2.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run Phase 2's existing attendance-workbook tests to confirm zero regression** (this task must never modify their behavior)

Run: `npx vitest run __tests__/sis/backfill/enrollment/attendance-workbook.test.ts`
Expected: PASS (7 tests, unchanged)

- [ ] **Step 6: Commit**

```bash
git add lib/sis/backfill/attendance/attendance-workbook-t2.ts __tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts
git commit -m "feat(backfill): parse AY2026 T2 attendance workbook, reusing Phase 2's roster parser"
```

---

### Task 2: T2 day-type classifier (public-holiday whitelist, no date-range parsing)

**Files:**

- Create: `lib/sis/backfill/attendance/day-classifier-t2.ts`
- Test: `__tests__/sis/backfill/attendance/day-classifier-t2.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1 (pure, standalone — the same isolation Phase 2's own `day-classifier.ts` has from its workbook parser).
- Produces (consumed by Task 3):

  ```ts
  export type DayType =
    | 'school_day'
    | 'public_holiday'
    | 'school_holiday'
    | 'no_class';

  export interface DateClassificationT2 {
    date: string;
    dayType: DayType;
    hblOverlay: boolean;
    label: string | null;
    needsConfirmation: boolean;
  }

  export const PUBLIC_HOLIDAY_WHITELIST: string[];

  export function classifyDatesT2(
    datesISO: string[],
    blankDates: Set<string>,
    labelByDate: Map<string, string>
  ): DateClassificationT2[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/day-classifier-t2.test.ts`:

```ts
// __tests__/sis/backfill/attendance/day-classifier-t2.test.ts
import { describe, expect, it } from 'vitest';

import {
  classifyDatesT2,
  PUBLIC_HOLIDAY_WHITELIST,
} from '@/lib/sis/backfill/attendance/day-classifier-t2';

describe('classifyDatesT2', () => {
  it('classifies a non-blank date as school_day, ignoring any label present', () => {
    const result = classifyDatesT2(
      ['2026-04-06'],
      new Set(),
      new Map([['2026-04-06', 'English Week']])
    );
    expect(result).toEqual([
      {
        date: '2026-04-06',
        dayType: 'school_day',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      },
    ]);
  });

  it('classifies a blank date with no label as no_class, not flagged', () => {
    const result = classifyDatesT2(
      ['2026-04-10'],
      new Set(['2026-04-10']),
      new Map()
    );
    expect(result).toEqual([
      {
        date: '2026-04-10',
        dayType: 'no_class',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      },
    ]);
  });

  it.each(PUBLIC_HOLIDAY_WHITELIST)(
    'classifies a blank date labeled exactly "%s" as public_holiday, not flagged',
    (holidayName) => {
      const result = classifyDatesT2(
        ['2026-04-03'],
        new Set(['2026-04-03']),
        new Map([['2026-04-03', holidayName]])
      );
      expect(result[0]).toEqual({
        date: '2026-04-03',
        dayType: 'public_holiday',
        hblOverlay: false,
        label: holidayName,
        needsConfirmation: false,
      });
    }
  );

  it('classifies a blank date whose label mentions HBL (case-insensitive) as school_holiday with the overlay set, not flagged', () => {
    const result = classifyDatesT2(
      ['2026-04-24'],
      new Set(['2026-04-24']),
      new Map([['2026-04-24', 'hbl - Marking Day']])
    );
    expect(result[0]).toEqual({
      date: '2026-04-24',
      dayType: 'school_holiday',
      hblOverlay: true,
      label: 'hbl - Marking Day',
      needsConfirmation: false,
    });
  });

  it('classifies a blank date with an unrecognized label as no_class AND flags it for confirmation', () => {
    const result = classifyDatesT2(
      ['2026-04-13'],
      new Set(['2026-04-13']),
      new Map([['2026-04-13', 'Student Recollection']])
    );
    expect(result[0]).toEqual({
      date: '2026-04-13',
      dayType: 'no_class',
      hblOverlay: false,
      label: 'Student Recollection',
      needsConfirmation: true,
    });
  });

  it('never guesses public_holiday from a partial/near match to the whitelist', () => {
    const result = classifyDatesT2(
      ['2026-05-01'],
      new Set(['2026-05-01']),
      new Map([['2026-05-01', 'Labor Day (in lieu)']])
    );
    expect(result[0].dayType).toBe('no_class');
    expect(result[0].needsConfirmation).toBe(true);
  });

  it('classifies a full mixed date list correctly and preserves input order', () => {
    const result = classifyDatesT2(
      ['2026-04-02', '2026-04-03', '2026-04-13', '2026-04-06'],
      new Set(['2026-04-03', '2026-04-13']),
      new Map([
        ['2026-04-03', 'Good Friday'],
        ['2026-04-13', 'Student Recollection'],
      ])
    );
    expect(result.map((r) => r.dayType)).toEqual([
      'school_day',
      'public_holiday',
      'no_class',
      'school_day',
    ]);
    expect(result.map((r) => r.needsConfirmation)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/day-classifier-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/day-classifier-t2'`

- [ ] **Step 3: Implement the classifier**

Create `lib/sis/backfill/attendance/day-classifier-t2.ts`:

```ts
// lib/sis/backfill/attendance/day-classifier-t2.ts
// Classifies each date in the AY2026 T2 term as a real school day or a
// holiday/no-class day, for populating school_calendar. Pure.
//
// Unlike Phase 2's classifier (day-classifier.ts), which resolves a blank
// date's label by checking whether any parsed date RANGE covers it, T2's
// source prints each event's label directly in the date column it falls
// on (design doc Locked Decision #5) — so this classifier takes a direct
// date -> label lookup instead of a list of ranges, and never parses
// free-text date ranges.
//
// Primary signal is unchanged from Phase 2: a date is school_day if ANY
// roster cell anywhere is non-blank on that date; the caller (see
// build-attendance-import-t2.ts) computes blankDates the same way Phase 2
// did before calling this.

export type DayType =
  | 'school_day'
  | 'public_holiday'
  | 'school_holiday'
  | 'no_class';

export interface DateClassificationT2 {
  date: string;
  dayType: DayType;
  hblOverlay: boolean;
  label: string | null;
  // True only for a blank date whose label is non-empty but matches
  // neither the HBL pattern nor the public-holiday whitelist below — the
  // fallback is still no_class (never guessed as public_holiday without a
  // positive match), but the label is unrecognized, so a human should
  // confirm it isn't an unlisted real public holiday before the apply
  // files run. Never true for a date with no label at all (nothing to
  // confirm) or for a date that matched HBL/the whitelist.
  needsConfirmation: boolean;
}

// Locked Decision #6 — the closed whitelist of genuine Singapore public
// holidays observed in the T2 term window. Every other label found in the
// real workbook (Student Recollection, General PTC, Staff Dev't Day,
// English/Science Week, fieldtrips, Term 2 Exam, Marking Day, In Lieu of
// Family Sportsfest, ...) is an operational closure, not a public
// holiday, and classifies as no_class.
export const PUBLIC_HOLIDAY_WHITELIST = [
  'Good Friday',
  'Labor Day',
  'Vesak Day',
  'Hari Raya Haji',
];

export function classifyDatesT2(
  datesISO: string[],
  blankDates: Set<string>,
  labelByDate: Map<string, string>
): DateClassificationT2[] {
  return datesISO.map((date) => {
    if (!blankDates.has(date)) {
      return {
        date,
        dayType: 'school_day',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      };
    }

    const label = labelByDate.get(date) ?? null;

    if (label && /hbl/i.test(label)) {
      return {
        date,
        dayType: 'school_holiday',
        hblOverlay: true,
        label,
        needsConfirmation: false,
      };
    }

    if (label && PUBLIC_HOLIDAY_WHITELIST.includes(label)) {
      return {
        date,
        dayType: 'public_holiday',
        hblOverlay: false,
        label,
        needsConfirmation: false,
      };
    }

    return {
      date,
      dayType: 'no_class',
      hblOverlay: false,
      label,
      needsConfirmation: label !== null,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/attendance/day-classifier-t2.test.ts`
Expected: PASS (10 tests — 6 named + 4 from the `it.each` whitelist loop)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/day-classifier-t2.ts __tests__/sis/backfill/attendance/day-classifier-t2.test.ts
git commit -m "feat(backfill): classify AY2026 T2 dates via a public-holiday whitelist"
```

---

### Task 3: Import composer (roster resolution, chunked SQL emission, confirmation flagging)

**Files:**

- Create: `lib/sis/backfill/attendance/build-attendance-import-t2.ts`
- Test: `__tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts`

**Interfaces:**

- Consumes (from Task 1): `ParsedSectionWithLabels` from `@/lib/sis/backfill/attendance/attendance-workbook-t2`.
- Consumes (from Task 2): `classifyDatesT2`, `DateClassificationT2` from `@/lib/sis/backfill/attendance/day-classifier-t2`.
- Consumes (existing, Phase 1/2, reused as-is): `deriveSectionIdentity` from `@/lib/sis/backfill/enrollment/section-identity`; `sqlString`, `sqlStringOrNull` from `@/lib/sis/backfill/enrollment/sql-escape`; `resolveHeaderDate` from `@/lib/sis/backfill/attendance/legend-parser`; `RosterLookupEntry` from `@/lib/sis/backfill/attendance/build-attendance-import` (re-exported by this task's module — same shape, no duplication).
- Produces (consumed by Task 4):

  ```ts
  export interface BuildAttendanceImportT2Input {
    sections: ParsedSectionWithLabels[];
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

  export interface BuildAttendanceImportT2Result {
    preview: string;
    applyFiles: ApplySqlFile[];
    stats: {
      schoolDays: number;
      holidays: number;
      attendanceRows: number;
      needsReview: number;
      needsConfirmation: number;
      excludedYs: string[];
      unrecognized: string[];
      skippedEmpty: string[];
      unparseableDateHeaders: string[];
    };
  }

  export function buildAttendanceImportT2(
    input: BuildAttendanceImportT2Input
  ): BuildAttendanceImportT2Result;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts`:

```ts
// __tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImportT2 } from '@/lib/sis/backfill/attendance/build-attendance-import-t2';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';
import type {
  ApplySqlFile,
  RosterLookupEntry,
} from '@/lib/sis/backfill/attendance/build-attendance-import-t2';
import type { ParsedSectionWithLabels } from '@/lib/sis/backfill/attendance/attendance-workbook-t2';

function joinApply(applyFiles: ApplySqlFile[]): string {
  return applyFiles.map((f) => f.sql).join('\n');
}

const BASE_INPUT = {
  ayCode: 'AY2026',
  termNumber: 2,
  year: 2026,
};

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

function buildSection(
  overrides: Partial<ParsedSection> = {},
  dateLabels: Record<string, string> = { '3-Apr': 'Good Friday' }
): ParsedSectionWithLabels {
  return {
    section: {
      sheetName: 'P1 Patience(G)',
      classSectionLabel: 'P1 Patience (AM Global)',
      formTeacher: 'Ms. Kristel',
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
        {
          indexNo: '2',
          fullName: 'AMATE, Jaiden Matthew A.',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
      ],
      firstDate: '2-Apr',
      lastDate: '13-Apr',
      dateColumns: ['2-Apr', '3-Apr', '13-Apr'],
      rejectedNames: [],
      legendEntries: [],
      ...overrides,
    },
    dateLabels,
  };
}

describe('buildAttendanceImportT2', () => {
  it('classifies dates via row-8 labels, builds attendance rows, and computes stats', () => {
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.schoolDays).toBe(1); // 2-Apr
    expect(result.stats.holidays).toBe(2); // 3-Apr, 13-Apr
    expect(result.stats.attendanceRows).toBe(2); // Alvarez P, Amate P on 2-Apr
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.needsConfirmation).toBe(0); // 13-Apr has no label at all

    expect(apply).toContain("'ss-alvarez-uuid'");
    expect(apply).toContain("'2026-04-02'");
    expect(apply).toContain("'public_holiday'");
    // 2026-04-03 (Good Friday) IS written to school_calendar — but never
    // as an attendance_daily mark row, since it's not a school_day.
    const holidayMarkLine = apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-04-03') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
  });

  it('flags an unresolved (section, index_number) pair as needs-review', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '99',
          fullName: 'NOBODY, Unresolved',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.needsReview).toBe(1);
    expect(apply).not.toContain('NOBODY');
  });

  it('flags an unexpected mark value as needs-review instead of writing invalid SQL', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '2-Apr': 'Q', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.needsReview).toBe(1);
    expect(apply).not.toContain("'Q'");
  });

  it('treats the workbook\'s own "-" (No Class) marker as a distinct, non-error needs-review reason', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '2-Apr': '-', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.preview).toContain('"No Class" per the workbook');
  });

  it('excludes the YS sheet from attendance import, same as Phase 2', () => {
    const section = buildSection(
      { sheetName: 'YS', dateColumns: ['2-Apr'] },
      {}
    );
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.attendanceRows).toBe(0);
    expect(apply).not.toContain('ss-alvarez-uuid');
  });

  describe('needs-confirmation flagging (Locked Decision #6)', () => {
    it('does NOT flag a blank date whose label matches the public-holiday whitelist', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()], // 3-Apr labeled "Good Friday"
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(0);
      expect(result.preview).not.toContain('NEEDS CONFIRMATION');
    });

    it('flags a blank date whose label matches neither HBL nor the whitelist, and surfaces it in preview.sql', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection({}, { '13-Apr': 'Student Recollection' })],
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(1);
      expect(result.preview).toContain('[NEEDS CONFIRMATION]');
      expect(result.preview).toContain('Dates needing confirmation (1)');
      expect(result.preview).toContain('2026-04-13: "Student Recollection"');
      // Still classified no_class, not silently guessed as a holiday.
      expect(result.preview).toContain('2026-04-13: no_class');
    });

    it('does not flag a blank date with no label at all', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection({}, {})], // no labels anywhere
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(0);
      expect(result.preview).toContain('Dates needing confirmation (0)');
      expect(result.preview).toContain('(none)');
    });
  });

  describe('apply file chunking (Supabase SQL Editor rejects one huge query)', () => {
    it('splits marks into multiple self-contained, ordered files when marksChunkSize is small', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1, // 2 attendance rows -> 2 marks chunk files
      });

      // calendar (1) + 2 marks chunks + rollups (1) = 4
      expect(result.applyFiles).toHaveLength(4);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-marks-01-of-02.sql');
      expect(result.applyFiles[2].filename).toBe('03-marks-02-of-02.sql');
      expect(result.applyFiles[3].filename).toBe('04-rollups-and-verify.sql');

      for (const f of result.applyFiles) {
        expect(f.sql).toContain('begin;');
        expect(f.sql).toContain('commit;');
      }

      const chunk1 = result.applyFiles[1].sql;
      expect(chunk1).toContain('create temp table _ay26att2_marks');
      expect(chunk1).toContain('insert into attendance_daily');
      expect(chunk1).toContain('where not exists (');

      const rollupsFile = result.applyFiles[3].sql;
      expect(rollupsFile).not.toContain('_ay26att2_marks');
      expect(rollupsFile).toContain('recompute_attendance_rollup');
    });

    it('produces one un-split marks file when the default chunk size comfortably covers all rows', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        // default marksChunkSize (2000) far exceeds this fixture's 2 rows
      });

      const marksFiles = result.applyFiles.filter((f) =>
        f.filename.includes('-marks-')
      );
      expect(marksFiles).toHaveLength(1);
      expect(marksFiles[0].filename).toBe('02-marks-01-of-01.sql');
    });

    it('lists every apply filename in run order inside preview.sql', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });

      for (const f of result.applyFiles) {
        expect(result.preview).toContain(f.filename);
      }
      const positions = result.applyFiles.map((f) =>
        result.preview.indexOf(f.filename)
      );
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/attendance/build-attendance-import-t2'`

- [ ] **Step 3: Implement the composer**

Create `lib/sis/backfill/attendance/build-attendance-import-t2.ts`:

```ts
// lib/sis/backfill/attendance/build-attendance-import-t2.ts
// Composes attendance-workbook-t2 + day-classifier-t2 (plus Phase 1's
// section-identity + sql-escape, and Phase 2's legend-parser date
// resolver) into the two SQL artifacts described by the design doc: a
// read-only preview report and a transactional, idempotent apply script,
// split into chunked files the same way Phase 2's mid-session fix
// established (built in from the start this time, per the design doc's
// §5). No I/O — takes already-parsed sections and an already-fetched
// roster lookup.
import { deriveSectionIdentity } from '../enrollment/section-identity';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import { resolveHeaderDate } from './legend-parser';
import {
  classifyDatesT2,
  type DateClassificationT2,
} from './day-classifier-t2';
import type { ParsedSectionWithLabels } from './attendance-workbook-t2';
import type { RosterLookupEntry } from './build-attendance-import';

export type { RosterLookupEntry };

export interface BuildAttendanceImportT2Input {
  sections: ParsedSectionWithLabels[];
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

export interface BuildAttendanceImportT2Result {
  preview: string;
  applyFiles: ApplySqlFile[];
  stats: {
    schoolDays: number;
    holidays: number;
    attendanceRows: number;
    needsReview: number;
    needsConfirmation: number;
    excludedYs: string[];
    unrecognized: string[];
    skippedEmpty: string[];
    unparseableDateHeaders: string[];
  };
}

const VALID_MARKS = new Set(['P', 'A', 'EX', 'L']);

// Same threshold Phase 2's mid-session fix settled on — see
// build-attendance-import.ts for the measured failure case this avoids.
const DEFAULT_MARKS_CHUNK_SIZE = 2000;

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

export function buildAttendanceImportT2(
  input: BuildAttendanceImportT2Input
): BuildAttendanceImportT2Result {
  const { sections, rosterLookup, ayCode, termNumber, year } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.cleanName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const excludedYs: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const coreSections: {
    parsed: ParsedSectionWithLabels;
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
      excludedYs.push(parsed.section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(parsed.section.sheetName);
      continue;
    }
    coreSections.push({
      parsed,
      levelCode: identity.levelCode,
      cleanName: identity.cleanName,
    });
  }

  // --- Date classification (once, across all core sections) ---
  // allDatesRaw and allDatesISO MUST stay the same length and positionally
  // aligned — every downstream loop indexes both by the same `i`, the
  // same invariant Phase 2 established (see build-attendance-import.ts).
  const allDatesRaw = coreSections[0]?.parsed.section.dateColumns ?? [];
  const allDatesISO: (string | null)[] = allDatesRaw.map((d) =>
    resolveHeaderDate(d, year)
  );
  const unparseableDateHeaders: string[] = [];
  allDatesRaw.forEach((raw, i) => {
    if (allDatesISO[i] === null) unparseableDateHeaders.push(raw);
  });

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

  // Row-8's label is section-specific in content (e.g. "P1&P2 Fieldtrip"
  // only appears on P1/P2 sheets) — take the label from whichever section
  // actually has one for that date column.
  const labelByDate = new Map<string, string>();
  for (let i = 0; i < allDatesRaw.length; i++) {
    const rawDate = allDatesRaw[i];
    const isoDate = allDatesISO[i];
    if (!isoDate || labelByDate.has(isoDate)) continue;
    for (const { parsed } of coreSections) {
      const label = (parsed.dateLabels[rawDate] ?? '').trim();
      if (label) {
        labelByDate.set(isoDate, label);
        break;
      }
    }
  }

  const validDatesISO = allDatesISO.filter((d): d is string => d !== null);
  const classifications = classifyDatesT2(
    validDatesISO,
    blankDates,
    labelByDate
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

        const mark = (student.marks[rawDate] ?? '').trim();
        if (!mark) continue;
        if (!VALID_MARKS.has(mark)) {
          const reason =
            mark === '-'
              ? `"-" ("No Class" per the workbook's own legend) on ${isoDate} — not imported; does not affect the attendance rollup`
              : `unexpected mark "${mark}" on ${isoDate}`;
          needsReview.push({
            sheetName: parsed.section.sheetName,
            indexNo: student.indexNo,
            fullName: student.fullName,
            reason,
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

  const stats: BuildAttendanceImportT2Result['stats'] = {
    schoolDays: classifications.filter((c) => c.dayType === 'school_day')
      .length,
    holidays: classifications.filter((c) => c.dayType !== 'school_day').length,
    attendanceRows: attendanceRows.length,
    needsReview: needsReview.length,
    needsConfirmation: classifications.filter((c) => c.needsConfirmation)
      .length,
    excludedYs,
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
  classifications: DateClassificationT2[],
  needsReview: NeedsReviewRow[],
  stats: BuildAttendanceImportT2Result['stats'],
  applyFiles: ApplySqlFile[]
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${termNumber} attendance import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t2-attendance.ts from the T2 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Date classification (${classifications.length} dates):`);
  for (const c of classifications) {
    const overlay = c.hblOverlay ? ' [hbl_overlay]' : '';
    const flag = c.needsConfirmation ? ' [NEEDS CONFIRMATION]' : '';
    const label = c.label ? ` "${sanitizeComment(c.label)}"` : '';
    lines.push(`--   ${c.date}: ${c.dayType}${overlay}${flag}${label}`);
  }
  lines.push('--');
  lines.push(
    `-- school_days=${stats.schoolDays} holidays=${stats.holidays} attendanceRows=${stats.attendanceRows}`
  );
  lines.push('--');
  lines.push(
    `-- Dates needing confirmation (${stats.needsConfirmation}) — classified as no_class`
  );
  lines.push(
    '-- but carry an unrecognized label; confirm none of these are an'
  );
  lines.push('-- unlisted real public holiday before running the apply files:');
  const flagged = classifications.filter((c) => c.needsConfirmation);
  if (flagged.length === 0) lines.push('--   (none)');
  for (const c of flagged) {
    lines.push(`--   ${c.date}: "${sanitizeComment(c.label ?? '')}"`);
  }
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.map(sanitizeComment).join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (Youngstarters): ${stats.excludedYs.map(sanitizeComment).join(', ') || '(none)'}`
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
    '-- Generated by gen-ay2026-t2-attendance.ts — do not hand-edit; regenerate',
    '-- instead. Split into multiple files because the combined script was too',
    '-- large for the Supabase SQL Editor to run as one query (same threshold',
    '-- Phase 2 measured). Each file is its own transaction and is safe to',
    '-- re-run (idempotent) if you need to retry.',
    '--',
  ];
}

function buildApplyFiles(
  ayCode: string,
  termNumber: number,
  classifications: DateClassificationT2[],
  markChunks: AttendanceRow[][]
): ApplySqlFile[] {
  const totalFiles = 1 + markChunks.length + 1; // calendar + marks chunks + rollups
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
    lines.push('drop table if exists _ay26att2_calendar;');
    lines.push(
      'create temp table _ay26att2_calendar (date, day_type, hbl_overlay, label) as'
    );
    lines.push('values');
    const calendarRows = classifications.map(
      (c) =>
        `  (date ${sqlString(c.date)}, ${sqlString(c.dayType)}, ${c.hblOverlay ? 'true' : 'false'}, ${sqlStringOrNull(c.label)})`
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
    lines.push('from _ay26att2_calendar c');
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
    lines.push('drop table if exists _ay26att2_marks;');
    lines.push(
      'create temp table _ay26att2_marks (section_student_id, date, status) as'
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
    lines.push('from _ay26att2_marks m');
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

Run: `npx vitest run __tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts`
Expected: PASS (11 tests — 5 named + 3 in the needs-confirmation describe block + 3 in the chunking describe block)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/attendance/build-attendance-import-t2.ts __tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts
git commit -m "feat(backfill): compose AY2026 T2 attendance import SQL, chunked from the start"
```

---

### Task 4: Orchestrator script + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t2-attendance.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseWorkbookT2` from Task 1, `buildAttendanceImportT2` + `RosterLookupEntry` from Task 3, `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks — this is the final task. Writes `scripts/backfill/ay2026-t2-attendance-preview.sql` and `scripts/backfill/ay2026-t2-attendance-apply/*.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t2-attendance.ts`:

```ts
// scripts/backfill/gen-ay2026-t2-attendance.ts
// Generates ay2026-t2-attendance-preview.sql + a chunked set of apply files
// under ay2026-t2-attendance-apply/ from HFSE's real T2 attendance
// workbook. Emits SQL for review — does NOT write to the database itself.
// See:
// docs/superpowers/specs/2026-07-18-ay2026-t2-attendance-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-attendance.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT2 } from '../../lib/sis/backfill/attendance/attendance-workbook-t2';
import { buildAttendanceImportT2 } from '../../lib/sis/backfill/attendance/build-attendance-import-t2';
import type { RosterLookupEntry } from '../../lib/sis/backfill/attendance/build-attendance-import-t2';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const YEAR = 2026;
const WORKBOOK_PATH = 'AY2026/T2/T2 Attendance Mar-May (1).xlsx';

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbookT2(WORKBOOK_PATH);

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

  const result = buildAttendanceImportT2({
    sections,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    year: YEAR,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-attendance-preview.sql',
    result.preview
  );

  const applyDir = 'scripts/backfill/ay2026-t2-attendance-apply';
  // Clear stale files from a prior run (e.g. a different chunk count) so
  // the directory never mixes filenames from two generations.
  rmSync(applyDir, { recursive: true, force: true });
  mkdirSync(applyDir, { recursive: true });
  for (const f of result.applyFiles) {
    writeFileSync(join(applyDir, f.filename), f.sql);
  }

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t2-attendance-preview.sql');
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

Modify `.gitignore` — add after the existing `scripts/backfill/ay2026-remaining-sections-subjects-*.sql` line (the current end of the "AY2026 backfill artifacts" block):

```

# AY2026 T2 attendance import output (real student PII — attendance marks
# keyed by section_student_id). Generated by gen-ay2026-t2-attendance.ts;
# apply is split into multiple chunked files under apply/ since the
# combined query is too large for the Supabase SQL Editor. Review locally,
# never commit.
scripts/backfill/ay2026-t2-attendance-preview.sql
scripts/backfill/ay2026-t2-attendance-apply/
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every prior Phase 1/2/3 test plus the 26 new tests from Tasks 1–3 (5 + 10 + 11 = 26 new), all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t2-attendance.ts .gitignore
git commit -m "feat(backfill): add AY2026 T2 attendance import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-attendance.ts`
Expected: prints a `Stats:` block with `schoolDays` + `holidays` summing to the T2 term's real date-column count, `attendanceRows` in the low tens-of-thousands (roster × school days, similar order of magnitude to Phase 2's T1 run), `needsReview` near 0, and `needsConfirmation` reporting how many blank dates carry an unrecognized label. Read `scripts/backfill/ay2026-t2-attendance-preview.sql` in full and hand-verify: (1) every `needsConfirmation` date against the real workbook — confirm none of them is actually an unlisted public holiday before running any apply file; (2) the `public_holiday` / `school_holiday` classifications match the design doc §1's list of real T2 events; (3) the apply file run order.

---

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 Locked Decisions 1–8 are each implemented — scope/exclusion (Task 3's reuse of `deriveSectionIdentity`, Global Constraints), YS deferral (Task 3, tested), column layout by label/relative-offset (Task 1's reuse of `parseSheet`, tested against the 5-leading-column T2 shape), data-driven day classification (Task 3's `blankDates` computation, unchanged from Phase 2), row-8 as the sole label source (Task 1's `extractDateAlignedLabels` + Task 3's `labelByDate`, never touching the old range-based legend path), the explicit whitelist + confirmation flagging (Task 2, tested per-holiday via `it.each` plus the unmatched/no-label distinction), `ex_reason`/roster-resolution/`"-"`-handling/chunking (Task 3, ported verbatim from Phase 2's proven shapes), `school_calendar` population (Task 3's calendar apply file). §3's algorithm and §5's SQL write plan map 1:1 onto Task 3. §6's validation plan is Task 4 Step 5 (generator run + hand read of preview.sql, including the explicit instruction to check every flagged date). §7's "reused, not retested" instruction for row-boundary/mark-validation/chunking is satisfied by literally reusing `parseSheet` (Task 1) and mirroring Phase 2's exact tested chunking shapes (Task 3) rather than re-deriving them; only the genuinely new pieces (row-8 label extraction, whitelist classification, confirmation flagging) get their own fresh test coverage.
- **Placeholder scan:** none found — every step has complete, runnable code; no "TBD"/"similar to Task N" shortcuts.
- **Type consistency:** `ParsedSectionWithLabels` (Task 1's producer) is consumed unchanged by Task 3's `BuildAttendanceImportT2Input.sections`. `RosterLookupEntry` is imported from Phase 2's `build-attendance-import.ts` (not redefined) and re-exported by Task 3's module so Task 4's orchestrator has one canonical import path. `DateClassificationT2`/`DayType` names in Task 2 match exactly what Task 3 imports and destructures (`dayType`, `hblOverlay`, `label`, `needsConfirmation`) — verified field-by-field against both the test assertions and the `buildPreviewSql`/`buildApplyFiles` consumers.
- **Ambiguity resolved during planning:** the design doc's Locked Decision #6 says an unmatched label "is additionally flagged... so a real public holiday this list doesn't yet know about is surfaced." This plan interprets "unmatched" as _label present but not recognized_ — a blank date with **no** label at all has nothing to surface (there's no candidate name being dropped) and is therefore never flagged. This is encoded directly in `classifyDatesT2`'s `needsConfirmation: label !== null` on the `no_class` fallback branch, and is explicitly tested (`'does not flag a blank date with no label at all'`).

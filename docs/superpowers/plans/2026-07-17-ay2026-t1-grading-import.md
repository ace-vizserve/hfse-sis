# AY2026 T1 Grading Sheets Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reviewable `preview.sql` / `apply.sql` files that import HFSE's real AY2026 T1 grading data (39 students × 8 subjects, Discipline 1 + Integrity 1) into `subject_configs` / `grading_sheets` / `grade_entries`, without ever writing to the database directly from this codebase.

**Architecture:** One pure parser (`grading-workbook.ts`) turns each of the 8 real subject workbooks into a subject-agnostic `ParsedSubjectSheet[]` shape by reading column layout dynamically from each sheet's own header rows (no per-subject hardcoding of slot counts). One pure composer (`build-grading-import.ts`) resolves rosters via `(section, index_number)`, computes grades via the real `lib/compute/quarterly.ts` (imported directly, never re-implemented), cross-checks against each sheet's own printed grade, and emits SQL text. One orchestrator script wires DB reads + file parsing + the composer together and writes the two output files — it contains no business logic itself.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-17-ay2026-t1-grading-import-design.md` — read it before starting; every task below implements a piece of it.
- Scope is exactly Discipline 1 (S1, 29 active students) + Integrity 1 (S2, 10 active students) × 8 subjects: Math (MATH), Science (SCI), English (ENG), Humanities (HUM), Global Perspectives (GP), Computing (COMP), Art & Design (ARTD), PE & Health (PEH).
- The orchestrator reads an explicit list of exactly these 8 files — **never** `Copy of Mathematics Grading Sheet Global Class AY2026 T1.xlsx` (confirmed corrupted: student names are `#REF!`, and its Integrity 1 tab has the wrong weights).
- Every workbook's `"DO NOT USE Literature - Sec 4 E"` tab is skipped unconditionally (matched by name prefix `"DO NOT USE"`), in every file.
- Weights/max-scores come from each sheet's own header row — **never** from `subject_configs`, `template_subject_configs`, or KD #4's documented defaults, all three of which disagree with the real data.
- Grade computation (`ww_ps`/`pt_ps`/`qa_ps`/`initial_grade`/`quarterly_grade`) is done by **importing `lib/compute/quarterly.ts`'s `computeQuarterly` directly** — never re-implemented or ported. Per Hard Rule #1/#2.
- Roster resolution is via `(levelCode, sectionName, indexNumber)` lookup against live `section_students` — unresolved rows go to needs-review, never guessed. Same pattern as Phase 2 (`lib/sis/backfill/attendance/build-attendance-import.ts`).
- `subject_configs` writes use `ON CONFLICT ... DO UPDATE` (correcting the near-empty AY2026 config). `grading_sheets` and `grade_entries` writes use `ON CONFLICT ... DO NOTHING` (idempotent — safe to rerun without clobbering any live edits made after the first run).
- Sheets are locked on import: `is_locked=true, locked_at=now(), locked_by='backfill-import'`.
- No code in this plan ever writes to the database. The orchestrator only reads (for roster/subject/level/AY/term lookups) and writes local `.sql` files.
- Reuse `lib/sis/backfill/enrollment/sql-escape.ts` (`sqlString`, `sqlStringOrNull`) as-is for every SQL string literal.
- Output files (`scripts/backfill/ay2026-t1-grading-{preview,apply}.sql`) contain real student names and scores (PII) — must be gitignored, matching Phases 1–2's pattern.

---

### Task 1: Grading workbook parser

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks (this is the first task). Uses `xlsx` (`import * as XLSX from 'xlsx'`), the same library Phase 1/2's `attendance-workbook.ts` already uses.
- Produces (consumed by Task 2):

  ```ts
  export interface GradingStudentRow {
    indexNo: string;
    fullName: string;
    wwScores: (number | null)[];
    ptScores: (number | null)[];
    examScore: number | null;
    printedInitialGrade: number | null;
    printedQuarterlyGrade: number | null;
  }

  export interface ParsedSubjectSheet {
    subjectCode: string;
    levelCode: string;
    sectionName: string;
    teacherName: string | null;
    wwWeight: number;
    ptWeight: number;
    qaWeight: number;
    wwTotals: number[];
    ptTotals: number[];
    qaTotal: number | null;
    students: GradingStudentRow[];
  }

  export function parseGradingWorkbook(
    filePath: string,
    subjectCode: string
  ): ParsedSubjectSheet[];
  ```

**Row layout this parser reads** (0-indexed, confirmed identical across all 8 real subject workbooks):

- Row 2: `"Secondary N <SECTIONWORD> <NUM>..."` (e.g. `"Secondary 1 DISCIPLINE 1 "`, `"Secondary 2 INTEGRITY 1 -"`, `"Secondary 1 DISCIPLINE 1 - ART AND DESIGN"`) → level + section identity.
- Row 3: `"Teacher: <name>"` (sometimes with a double space after the colon) → teacher name.
- Row 7: sub-column labels — contains `W1`, `W2`, `W3` (WW slots, some blank in row 8), `Total` (WW's), `PS`, `WS`, `PT1`..`PTn` (PT slots), `Total` (PT's), `PS`, `WS`, `Exam`, `PS`, `WS`, then optionally `Initial`/`Quarterly` label text back up in row 5.
- Row 8: max-score row — numeric max per WW/PT slot column (blank string = that slot isn't used this term, exclude it entirely), and each block's own `WS` percentage cell (e.g. `"40%"`) — **this is where weights are read from, not the row 5/6 label text**, because one real subject (Humanities) has a corrupted row 5 label cell. Reading weights from row 8's WS-percentage cells instead sidesteps that corruption entirely.
- Row 5: also searched (from the Exam column onward) for `"Initial"` / `"Quarterly"` label cells to locate the sheet's own printed-grade columns — Math/Science/English/Humanities/Global Perspectives/Computing print both; Art & Design/PE & Health print only `"Initial"` (their tail is 1 column shorter).
- Rows 9+: student data, until `Index No.` stops being a positive integer or `NAME` is blank (trailing empty template rows).

- [ ] **Step 1: Write the failing tests for the header-parsing helpers, using a synthetic Math-shaped fixture**

Create `__tests__/sis/backfill/grading/grading-workbook.test.ts`:

```ts
// __tests__/sis/backfill/grading/grading-workbook.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbook } from '@/lib/sis/backfill/grading/grading-workbook';

// Builds a throwaway .xlsx on disk mirroring the real HFSE grading-sheet
// masthead shape, so the parser can be exercised the same way it will run
// for real — via XLSX.readFile, not against pre-parsed in-memory rows.
function writeWorkbook(
  path: string,
  sheets: Record<string, (string | number)[][]>
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path);
}

// Real row shape from the Mathematics workbook's "Math - Sec 1 Discipline 1"
// tab (2 real WW slots of 3 nominal columns, 3 PT slots, 2 trailing printed
// grade columns) — values transcribed verbatim from the source file.
const MATH_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 '],
  ['Teacher: Ms.J'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
  ],
  [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'ASSESSMENT (20%)',
    '',
    '',
    'Grade',
    'Grade',
  ],
  [
    '',
    '',
    'W1',
    'W2',
    'W3',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
    '',
    '',
  ],
  [
    '',
    '',
    20,
    20,
    '',
    40,
    '100%',
    '40%',
    30,
    30,
    25,
    85,
    '100%',
    '40%',
    65,
    '100%',
    '20%',
    '',
    '',
  ],
  [
    1,
    'BANTA, Stephanie Louise S',
    19,
    20,
    '',
    39,
    '97.50',
    '39.00',
    30,
    19,
    25,
    74,
    '87.06',
    '34.82',
    33,
    '50.77',
    '10.15',
    '83.98',
    89,
  ],
  [
    2,
    'BARROGA, Ysrael M.',
    17,
    17,
    '',
    34,
    '85.00',
    '34.00',
    28,
    23,
    25,
    76,
    '89.41',
    '35.76',
    54,
    '83.08',
    '16.62',
    '86.38',
    91,
  ],
  // Trailing blank template rows — the real workbook has ~1000 of these;
  // 2 is enough to exercise the row-boundary detection.
  [3, ''],
  [4, ''],
];

// Real row shape from the Art and Design workbook's "Art and Design - Sec 1
// Discipli" tab — 1 real WW slot (of 3 nominal columns), 5 PT slots, and
// only ONE trailing printed-grade column (Initial only, no Quarterly).
const ARTD_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 - ART AND DESIGN'],
  ['Teacher:  Ms. Jing'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (20%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (60%)',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
  ],
  [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'ASSESSMENT (20%)',
    '',
    '',
    'Grade',
  ],
  [
    '',
    '',
    'W1',
    'W2',
    'W3',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'PT4',
    'PT5',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
    '',
  ],
  [
    '',
    '',
    20,
    '',
    '',
    20,
    '100%',
    '20%',
    20,
    20,
    20,
    20,
    20,
    100,
    '100%',
    '60%',
    20,
    '100%',
    '20%',
    '',
  ],
  [
    1,
    'BANTA, Stephanie Louise S.',
    17,
    '',
    '',
    17,
    '85.00',
    '17.00',
    16,
    18,
    18,
    18,
    15,
    85,
    '85.00',
    '51.00',
    16,
    '80.00',
    '16.00',
    '84.00',
  ],
];

describe('parseGradingWorkbook', () => {
  it('reads level/section identity, weights (from row 8 WS%, not the row 5 label), max-scores, and student rows — Math shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, {
      'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS,
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025'], ['irrelevant']],
    });

    const sheets = parseGradingWorkbook(path, 'MATH');

    // The stale tab must never appear in the output.
    expect(sheets).toHaveLength(1);

    const sheet = sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 1');
    expect(sheet.teacherName).toBe('Ms.J');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    // Only 2 real WW slots — the blank-max 3rd nominal column is excluded.
    expect(sheet.wwTotals).toEqual([20, 20]);
    expect(sheet.ptTotals).toEqual([30, 30, 25]);
    expect(sheet.qaTotal).toBe(65);

    expect(sheet.students).toHaveLength(2);
    const banta = sheet.students[0];
    expect(banta.indexNo).toBe('1');
    expect(banta.fullName).toBe('BANTA, Stephanie Louise S');
    expect(banta.wwScores).toEqual([19, 20]);
    expect(banta.ptScores).toEqual([30, 19, 25]);
    expect(banta.examScore).toBe(33);
    expect(banta.printedInitialGrade).toBeCloseTo(83.98);
    expect(banta.printedQuarterlyGrade).toBe(89);
  });

  it('reads a subject with only 1 real WW slot, 5 PT slots, and no separate printed Quarterly column — Art & Design shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'artd.xlsx');
    writeWorkbook(path, {
      'Art and Design - Sec 1 Discipli': ARTD_SEC1_ROWS,
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025']],
    });

    const sheets = parseGradingWorkbook(path, 'ARTD');
    expect(sheets).toHaveLength(1);

    const sheet = sheets[0];
    expect(sheet.wwWeight).toBeCloseTo(0.2);
    expect(sheet.ptWeight).toBeCloseTo(0.6);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    expect(sheet.wwTotals).toEqual([20]); // only 1 real slot
    expect(sheet.ptTotals).toEqual([20, 20, 20, 20, 20]);
    expect(sheet.qaTotal).toBe(20);

    const banta = sheet.students[0];
    expect(banta.wwScores).toEqual([17]);
    expect(banta.ptScores).toEqual([16, 18, 18, 18, 15]);
    expect(banta.examScore).toBe(16);
    expect(banta.printedInitialGrade).toBeCloseTo(84.0);
    // No separate "Quarterly" label in this sheet's header — must be null,
    // never guessed or derived.
    expect(banta.printedQuarterlyGrade).toBeNull();
  });

  it('skips any tab whose name starts with "DO NOT USE", regardless of position', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'two-real-tabs.xlsx');
    const sec2Rows = MATH_SEC1_ROWS.map((row) => [...row]);
    sec2Rows[2] = ['Secondary 2 INTEGRITY 1 -'];
    writeWorkbook(path, {
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025']],
      'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS,
      'Math - Sec 2 Integrity 1': sec2Rows,
    });

    const sheets = parseGradingWorkbook(path, 'MATH');
    expect(sheets).toHaveLength(2);
    expect(sheets.map((s) => s.sectionName)).toEqual([
      'Discipline 1',
      'Integrity 1',
    ]);
    expect(sheets.map((s) => s.levelCode)).toEqual(['S1', 'S2']);
  });

  it('stops reading student rows at the first blank name (trailing template rows)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'bounds.xlsx');
    writeWorkbook(path, { 'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS });

    const sheets = parseGradingWorkbook(path, 'MATH');
    // MATH_SEC1_ROWS has 2 real students (BANTA, BARROGA) then 2 rows with
    // an index number but a blank name — those must not be read as students.
    expect(sheets[0].students).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/grading/grading-workbook.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook.ts
// Parses one HFSE T1 "Global Class" grading-sheet workbook into one
// ParsedSubjectSheet per real section tab. Column positions (which columns
// hold W1/W2/.../PT1/PT2/.../Exam/Initial/Quarterly) are resolved
// dynamically from each sheet's own header rows — no per-subject
// hardcoding, since real subjects vary in WW/PT slot count. Weights are
// read from row 8's own WS% cells (not the row 5 label text), which
// sidesteps a real corrupted label cell in the Humanities workbook.
import * as XLSX from 'xlsx';

export interface GradingStudentRow {
  indexNo: string;
  fullName: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  printedInitialGrade: number | null;
  printedQuarterlyGrade: number | null;
}

export interface ParsedSubjectSheet {
  subjectCode: string;
  levelCode: string;
  sectionName: string;
  teacherName: string | null;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  students: GradingStudentRow[];
}

const ROW_LEVEL_SECTION = 2;
const ROW_TEACHER = 3;
const ROW_LABELS = 5; // where "Initial"/"Quarterly" printed-grade labels live
const ROW_SUBCOLS = 7; // "W1","W2",...,"PT1",...,"Exam",...
const ROW_MAXSCORES = 8;
const ROW_STUDENTS_START = 9;

function cell(row: unknown[] | undefined, i: number): string {
  if (!row) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

function numOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

interface ColumnLayout {
  wwCols: number[];
  ptCols: number[];
  wwTotalCol: number;
  ptTotalCol: number;
  examCol: number;
}

function findColumnLayout(subcolRow: unknown[]): ColumnLayout {
  const wwCols: number[] = [];
  const ptCols: number[] = [];
  const totalCols: number[] = [];
  let examCol = -1;
  for (let i = 2; i < subcolRow.length; i++) {
    const label = cell(subcolRow as unknown[], i);
    if (/^W\d+$/i.test(label)) wwCols.push(i);
    else if (/^PT\d+$/i.test(label)) ptCols.push(i);
    else if (/^Total$/i.test(label)) totalCols.push(i);
    else if (/^Exam$/i.test(label)) examCol = i;
  }
  const [wwTotalCol, ptTotalCol] = totalCols;
  if (wwTotalCol == null || ptTotalCol == null || examCol === -1) {
    throw new Error(
      'grading-workbook: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

function weightAt(maxRow: unknown[], totalCol: number): number {
  // Layout is always <Total>, <PS>, <WS> — the weight is 2 columns after
  // the block's own Total column.
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `grading-workbook: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

function findPrintedGradeCols(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    const label = cell(labelRow, i);
    if (/Initial/i.test(label)) initialCol = i;
    else if (/Quarterly/i.test(label)) quarterlyCol = i;
  }
  return { initialCol, quarterlyCol };
}

function parseLevelSection(
  raw: string
): { levelCode: string; sectionName: string } | null {
  const m = /Secondary\s+(\d+)\s+([A-Za-z]+)\s+(\d+)/i.exec(raw);
  if (!m) return null;
  const [, levelNum, word, sectionNum] = m;
  const capitalized =
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return {
    levelCode: `S${levelNum}`,
    sectionName: `${capitalized} ${sectionNum}`,
  };
}

function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

function parseOneSheet(
  rows: unknown[][],
  subjectCode: string
): ParsedSubjectSheet {
  const identity = parseLevelSection(cell(rows[ROW_LEVEL_SECTION], 0));
  if (!identity) {
    throw new Error(
      `grading-workbook: could not parse level/section from row ${ROW_LEVEL_SECTION}: "${cell(rows[ROW_LEVEL_SECTION], 0)}"`
    );
  }
  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));

  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  const realWwCols = layout.wwCols.filter((c) => cell(maxRow, c) !== '');
  const realPtCols = layout.ptCols.filter((c) => cell(maxRow, c) !== '');
  const wwTotals = realWwCols.map((c) => Number(cell(maxRow, c)));
  const ptTotals = realPtCols.map((c) => Number(cell(maxRow, c)));
  const qaTotalRaw = cell(maxRow, layout.examCol);
  const qaTotal = qaTotalRaw === '' ? null : Number(qaTotalRaw);

  const { initialCol, quarterlyCol } = findPrintedGradeCols(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue; // trailing template rows

    students.push({
      indexNo,
      fullName,
      wwScores: realWwCols.map((c) => numOrNull(cell(row, c))),
      ptScores: realPtCols.map((c) => numOrNull(cell(row, c))),
      examScore: numOrNull(cell(row, layout.examCol)),
      printedInitialGrade:
        initialCol == null ? null : numOrNull(cell(row, initialCol)),
      printedQuarterlyGrade:
        quarterlyCol == null ? null : numOrNull(cell(row, quarterlyCol)),
    });
  }

  return {
    subjectCode,
    levelCode: identity.levelCode,
    sectionName: identity.sectionName,
    teacherName,
    wwWeight,
    ptWeight,
    qaWeight,
    wwTotals,
    ptTotals,
    qaTotal,
    students,
  };
}

export function parseGradingWorkbook(
  filePath: string,
  subjectCode: string
): ParsedSubjectSheet[] {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith('DO NOT USE')) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    sheets.push(parseOneSheet(rows, subjectCode));
  }
  return sheets;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook.ts __tests__/sis/backfill/grading/grading-workbook.test.ts
git commit -m "feat(backfill): parse AY2026 T1 grading workbooks with dynamic column layout"
```

---

### Task 2: Import composer (roster resolution, grade computation, SQL emission)

**Files:**

- Create: `lib/sis/backfill/grading/build-grading-import.ts`
- Test: `__tests__/sis/backfill/grading/build-grading-import.test.ts`

**Interfaces:**

- Consumes (from Task 1): `ParsedSubjectSheet`, `GradingStudentRow` from `@/lib/sis/backfill/grading/grading-workbook`.
- Consumes: `sqlString`, `sqlStringOrNull` from `@/lib/sis/backfill/enrollment/sql-escape` (existing, Phase 1).
- Consumes: `computeQuarterly` from `@/lib/compute/quarterly` (existing, live app engine — imported directly, never re-implemented).
- Produces (consumed by Task 3):

  ```ts
  export interface RosterLookupEntry {
    levelCode: string;
    sectionName: string;
    indexNumber: number;
    sectionStudentId: string;
  }

  export interface BuildGradingImportInput {
    sheets: ParsedSubjectSheet[]; // flattened across every subject workbook
    rosterLookup: RosterLookupEntry[];
    ayCode: string;
    termNumber: number;
  }

  export interface BuildGradingImportResult {
    preview: string;
    apply: string;
    stats: {
      subjectConfigsWritten: number;
      gradingSheetsWritten: number;
      gradeEntriesWritten: number;
      needsReview: number;
      quarterlyMismatches: number;
    };
  }

  export function buildGradingImport(
    input: BuildGradingImportInput
  ): BuildGradingImportResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/build-grading-import.test.ts`:

```ts
// __tests__/sis/backfill/grading/build-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildGradingImport } from '@/lib/sis/backfill/grading/build-grading-import';
import type {
  ParsedSubjectSheet,
  GradingStudentRow,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type { RosterLookupEntry } from '@/lib/sis/backfill/grading/build-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 1,
    sectionStudentId: 'ss-banta-uuid',
  },
  {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 2,
    sectionStudentId: 'ss-barroga-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'BANTA, Stephanie Louise S',
    wwScores: [19, 20],
    ptScores: [30, 19, 25],
    examScore: 33,
    printedInitialGrade: 83.98,
    printedQuarterlyGrade: 89,
    ...overrides,
  };
}

function mathSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'MATH',
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    teacherName: 'Ms.J',
    wwWeight: 0.4,
    ptWeight: 0.4,
    qaWeight: 0.2,
    wwTotals: [20, 20],
    ptTotals: [30, 30, 25],
    qaTotal: 65,
    students: [student({})],
    ...overrides,
  };
}

describe('buildGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes subject_configs/grading_sheets/grade_entries', () => {
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);

    expect(result.apply).toContain("'MATH'");
    expect(result.apply).toContain("'S1'");
    expect(result.apply).toContain('0.4'); // ww_weight / pt_weight
    expect(result.apply).toContain('subject_configs');
    expect(result.apply).toContain('grading_sheets');
    expect(result.apply).toContain('grade_entries');
    expect(result.apply).toContain("'ss-banta-uuid'");
    expect(result.apply).toContain('is_locked');
    expect(result.apply).toContain('true');
    expect(result.apply).toContain("'backfill-import'");
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = mathSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(0);
    expect(result.apply).not.toContain('NOBODY');
    expect(result.preview).toContain('NOBODY');
  });

  it('flags a quarterly-grade mismatch but still writes the raw scores (they remain the transcribed truth)', () => {
    const sheet = mathSheet({
      students: [student({ printedQuarterlyGrade: 999 })], // deliberately wrong
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1); // still written
    expect(result.apply).toContain("'ss-banta-uuid'");
    expect(result.preview).toContain('quarterly');
  });

  it('cross-checks initial_grade instead when a subject has no printed Quarterly column (Art & Design shape)', () => {
    const sheet: ParsedSubjectSheet = {
      subjectCode: 'ARTD',
      levelCode: 'S1',
      sectionName: 'Discipline 1',
      teacherName: 'Ms. Jing',
      wwWeight: 0.2,
      ptWeight: 0.6,
      qaWeight: 0.2,
      wwTotals: [20],
      ptTotals: [20, 20, 20, 20, 20],
      qaTotal: 20,
      students: [
        {
          indexNo: '1',
          fullName: 'BANTA, Stephanie Louise S.',
          wwScores: [17],
          ptScores: [16, 18, 18, 18, 15],
          examScore: 16,
          printedInitialGrade: 84.0,
          printedQuarterlyGrade: null,
        },
      ],
    };
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.quarterlyMismatches).toBe(0); // matches within tolerance
    expect(result.stats.gradeEntriesWritten).toBe(1);
  });

  it('writes one subject_configs row per distinct (subject, level) pair, upserting on conflict', () => {
    const s1 = mathSheet();
    const s2 = mathSheet({
      levelCode: 'S2',
      sectionName: 'Integrity 1',
      students: [student({ fullName: 'DELFIN, Demelly Czarina L.' })],
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [s1, s2],
      rosterLookup: [
        ...ROSTER,
        {
          levelCode: 'S2',
          sectionName: 'Integrity 1',
          indexNumber: 1,
          sectionStudentId: 'ss-delfin-uuid',
        },
      ],
    });

    expect(result.stats.subjectConfigsWritten).toBe(2); // MATH/S1 and MATH/S2
    expect(result.stats.gradingSheetsWritten).toBe(2);
    expect(result.apply).toContain('on conflict');
    expect(result.apply).toMatch(/do update/i); // subject_configs
    expect(result.apply).toMatch(/do nothing/i); // grading_sheets / grade_entries
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/build-grading-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the composer**

Create `lib/sis/backfill/grading/build-grading-import.ts`:

```ts
// lib/sis/backfill/grading/build-grading-import.ts
// Composes parsed grading-sheet data (grading-workbook.ts) into the two SQL
// files described by the design doc: a read-only preview report and a
// transactional, idempotent apply script. No I/O — takes already-parsed
// sheets and an already-fetched roster lookup.
import { computeQuarterly } from '@/lib/compute/quarterly';
import { sqlString, sqlStringOrNull } from '../enrollment/sql-escape';
import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface RosterLookupEntry {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  sectionStudentId: string;
}

export interface BuildGradingImportInput {
  sheets: ParsedSubjectSheet[];
  rosterLookup: RosterLookupEntry[];
  ayCode: string;
  termNumber: number;
}

interface ResolvedEntry {
  sectionStudentId: string;
  subjectCode: string;
  levelCode: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  computed: ReturnType<typeof computeQuarterly>;
}

interface NeedsReviewRow {
  subjectCode: string;
  levelCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

interface MismatchRow {
  subjectCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  kind: 'quarterly' | 'initial';
  printed: number;
  computed: number;
}

export interface BuildGradingImportResult {
  preview: string;
  apply: string;
  stats: {
    subjectConfigsWritten: number;
    gradingSheetsWritten: number;
    gradeEntriesWritten: number;
    needsReview: number;
    quarterlyMismatches: number;
  };
}

function toFixed6(n: number | null): string {
  return n == null ? 'null' : n.toFixed(6);
}

export function buildGradingImport(
  input: BuildGradingImportInput
): BuildGradingImportResult {
  const { sheets, rosterLookup, ayCode, termNumber } = input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.sectionName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const resolved: ResolvedEntry[] = [];
  const needsReview: NeedsReviewRow[] = [];
  const mismatches: MismatchRow[] = [];

  for (const sheet of sheets) {
    for (const student of sheet.students) {
      const key = `${sheet.levelCode}::${sheet.sectionName}::${Number.parseInt(student.indexNo, 10)}`;
      const sectionStudentId = rosterMap.get(key);
      if (!sectionStudentId) {
        needsReview.push({
          subjectCode: sheet.subjectCode,
          levelCode: sheet.levelCode,
          sectionName: sheet.sectionName,
          indexNo: student.indexNo,
          fullName: student.fullName,
          reason: `no matching section_students row for index ${student.indexNo}`,
        });
        continue;
      }

      const computed = computeQuarterly({
        ww_scores: student.wwScores,
        ww_totals: sheet.wwTotals,
        pt_scores: student.ptScores,
        pt_totals: sheet.ptTotals,
        qa_score: student.examScore,
        qa_total: sheet.qaTotal,
        ww_weight: sheet.wwWeight,
        pt_weight: sheet.ptWeight,
        qa_weight: sheet.qaWeight,
      });

      checkMismatch(sheet, student, computed, mismatches);

      resolved.push({
        sectionStudentId,
        subjectCode: sheet.subjectCode,
        levelCode: sheet.levelCode,
        wwScores: student.wwScores,
        ptScores: student.ptScores,
        examScore: student.examScore,
        computed,
      });
    }
  }

  const configKey = (subjectCode: string, levelCode: string) =>
    `${subjectCode}::${levelCode}`;
  const configsByKey = new Map<string, ParsedSubjectSheet>();
  for (const sheet of sheets) {
    configsByKey.set(configKey(sheet.subjectCode, sheet.levelCode), sheet);
  }

  const stats: BuildGradingImportResult['stats'] = {
    subjectConfigsWritten: configsByKey.size,
    gradingSheetsWritten: sheets.length,
    gradeEntriesWritten: resolved.length,
    needsReview: needsReview.length,
    quarterlyMismatches: mismatches.length,
  };

  return {
    preview: buildPreviewSql(sheets, needsReview, mismatches, stats),
    apply: buildApplySql(ayCode, termNumber, sheets, resolved, configsByKey),
    stats,
  };
}

function checkMismatch(
  sheet: ParsedSubjectSheet,
  student: GradingStudentRow,
  computed: ReturnType<typeof computeQuarterly>,
  mismatches: MismatchRow[]
) {
  if (student.printedQuarterlyGrade != null) {
    if (computed.quarterly_grade !== student.printedQuarterlyGrade) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'quarterly',
        printed: student.printedQuarterlyGrade,
        computed: computed.quarterly_grade ?? NaN,
      });
    }
    return;
  }
  // No printed Quarterly column on this subject (e.g. Art & Design / PE &
  // Health) — fall back to cross-checking the Initial grade instead, so
  // these subjects still get real validation coverage.
  if (student.printedInitialGrade != null && computed.initial_grade != null) {
    if (Math.abs(computed.initial_grade - student.printedInitialGrade) > 0.01) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'initial',
        printed: student.printedInitialGrade,
        computed: computed.initial_grade,
      });
    }
  }
}

function buildPreviewSql(
  sheets: ParsedSubjectSheet[],
  needsReview: NeedsReviewRow[],
  mismatches: MismatchRow[],
  stats: BuildGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T1 grading sheets import — PREVIEW (read-only)');
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-grading.ts from the 8 "Global Class" T1 workbooks.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(
    "-- Per-subject weights & slots (read from each sheet's own header):"
  );
  for (const s of sheets) {
    lines.push(
      `--   ${s.subjectCode} ${s.levelCode} ${s.sectionName}: ww=${s.wwWeight} pt=${s.ptWeight} qa=${s.qaWeight} | wwTotals=[${s.wwTotals}] ptTotals=[${s.ptTotals}] qaTotal=${s.qaTotal}`
    );
  }
  lines.push('--');
  lines.push(
    `-- subjectConfigs=${stats.subjectConfigsWritten} gradingSheets=${stats.gradingSheetsWritten} gradeEntries=${stats.gradeEntriesWritten}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.subjectCode} ${r.levelCode} ${r.sectionName}] index ${r.indexNo} "${r.fullName}" — ${r.reason}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Quarterly/Initial grade mismatches (${mismatches.length}) — raw scores ARE still written, this is informational:`
  );
  if (mismatches.length === 0) lines.push('--   (none)');
  for (const m of mismatches) {
    lines.push(
      `--   [${m.subjectCode} ${m.sectionName}] index ${m.indexNo} "${m.fullName}" — ${m.kind}: printed=${m.printed} computed=${m.computed}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  ayCode: string,
  termNumber: number,
  sheets: ParsedSubjectSheet[],
  resolved: ResolvedEntry[],
  configsByKey: Map<string, ParsedSubjectSheet>
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T1 grading sheets import — APPLY (transactional)');
  lines.push('--');
  lines.push('-- RUN ay2026-t1-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t1-grading.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  // --- 1) subject_configs ---
  lines.push('drop table if exists _ay26grd_subject_configs;');
  lines.push(
    'create temp table _ay26grd_subject_configs (subject_code, level_code, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max) as'
  );
  lines.push('values');
  const configRows = [...configsByKey.values()].map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${s.wwWeight}, ${s.ptWeight}, ${s.qaWeight}, ${s.wwTotals.length}, ${s.ptTotals.length}, ${s.qaTotal ?? 'null'})`
  );
  lines.push(configRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into subject_configs (academic_year_id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max)'
  );
  lines.push(
    'select ay.id, sub.id, lvl.id, c.ww_weight, c.pt_weight, c.qa_weight, c.ww_max_slots, c.pt_max_slots, c.qa_max'
  );
  lines.push('from _ay26grd_subject_configs c');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push('join subjects sub on sub.code = c.subject_code');
  lines.push('join levels lvl on lvl.code = c.level_code');
  lines.push(
    'on conflict (academic_year_id, subject_id, level_id) do update set'
  );
  lines.push('  ww_weight = excluded.ww_weight,');
  lines.push('  pt_weight = excluded.pt_weight,');
  lines.push('  qa_weight = excluded.qa_weight,');
  lines.push('  ww_max_slots = excluded.ww_max_slots,');
  lines.push('  pt_max_slots = excluded.pt_max_slots,');
  lines.push('  qa_max = excluded.qa_max;');
  lines.push('');

  // --- 2) grading_sheets ---
  lines.push('drop table if exists _ay26grd_sheets;');
  lines.push(
    'create temp table _ay26grd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
  );
  lines.push('values');
  const sheetRows = sheets.map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${sqlString(s.sectionName)}, ${sqlStringOrNull(s.teacherName)}, ARRAY[${s.wwTotals.join(',')}]::numeric[], ARRAY[${s.ptTotals.join(',')}]::numeric[], ${s.qaTotal ?? 'null'})`
  );
  lines.push(sheetRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, teacher_name, ww_totals, pt_totals, qa_total, is_locked, locked_at, locked_by)'
  );
  lines.push(
    "select t.id, sec.id, sub.id, sc.id, s.teacher_name, s.ww_totals, s.pt_totals, s.qa_total, true, now(), 'backfill-import'"
  );
  lines.push('from _ay26grd_sheets s');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = s.subject_code');
  lines.push('join levels lvl on lvl.code = s.level_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.name = s.section_name'
  );
  lines.push(
    'join subject_configs sc on sc.academic_year_id = ay.id and sc.subject_id = sub.id and sc.level_id = lvl.id'
  );
  lines.push('on conflict (term_id, section_id, subject_id) do nothing;');
  lines.push('');

  // --- 3) grade_entries ---
  lines.push('drop table if exists _ay26grd_entries;');
  lines.push(
    'create temp table _ay26grd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
  );
  lines.push('values');
  const entryRows = resolved.map((e) => {
    const wwArr = `ARRAY[${e.wwScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    const ptArr = `ARRAY[${e.ptScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    return `  (${sqlString(e.sectionStudentId)}, ${sqlString(e.subjectCode)}, ${wwArr}, ${ptArr}, ${e.examScore ?? 'null'}, ${toFixed6(e.computed.ww_ps)}, ${toFixed6(e.computed.pt_ps)}, ${toFixed6(e.computed.qa_ps)}, ${toFixed6(e.computed.initial_grade)}, ${e.computed.quarterly_grade ?? 'null'})`;
  });
  lines.push(
    (entryRows.length
      ? entryRows.join(',\n')
      : "  ('00000000-0000-0000-0000-000000000000', '__NONE__', ARRAY[]::numeric[], ARRAY[]::numeric[], null, null, null, null, null, null)") +
      ';'
  );
  lines.push('');
  lines.push(
    'insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade)'
  );
  lines.push(
    'select gs.id, e.section_student_id::uuid, e.ww_scores, e.pt_scores, e.qa_score, e.ww_ps, e.pt_ps, e.qa_ps, e.initial_grade, e.quarterly_grade'
  );
  lines.push('from _ay26grd_entries e');
  lines.push('join section_students ss on ss.id = e.section_student_id::uuid');
  lines.push('join sections sec on sec.id = ss.section_id');
  lines.push(
    `join academic_years ay on ay.id = sec.academic_year_id and ay.ay_code = ${sqlString(ayCode)}`
  );
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = e.subject_code');
  lines.push(
    'join grading_sheets gs on gs.term_id = t.id and gs.section_id = sec.id and gs.subject_id = sub.id'
  );
  lines.push("where e.subject_code <> '__NONE__'");
  lines.push('on conflict (grading_sheet_id, section_student_id) do nothing;');
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select count(*) as subject_configs_rows from subject_configs sc join academic_years ay on ay.id=sc.academic_year_id where ay.ay_code=${sqlString(ayCode)};`
  );
  lines.push(
    `select count(*) as grading_sheets_rows from grading_sheets gs join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select count(*) as grade_entries_rows from grade_entries ge join grading_sheets gs on gs.id=ge.grading_sheet_id join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/build-grading-import.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/build-grading-import.ts __tests__/sis/backfill/grading/build-grading-import.test.ts
git commit -m "feat(backfill): compose AY2026 T1 grading import SQL from parsed sheets"
```

---

### Task 3: Orchestrator script + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t1-grading.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseGradingWorkbook` from Task 1, `buildGradingImport` + `RosterLookupEntry` from Task 2, `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks — this is the final task. Writes `scripts/backfill/ay2026-t1-grading-preview.sql` and `scripts/backfill/ay2026-t1-grading-apply.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t1-grading.ts`:

```ts
// scripts/backfill/gen-ay2026-t1-grading.ts
// Generates ay2026-t1-grading-{preview,apply}.sql from HFSE's real T1
// "Global Class" grading workbooks. Emits SQL for review — does NOT write
// to the database itself. See:
// docs/superpowers/specs/2026-07-17-ay2026-t1-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbook } from '../../lib/sis/backfill/grading/grading-workbook';
import { buildGradingImport } from '../../lib/sis/backfill/grading/build-grading-import';
import type { RosterLookupEntry } from '../../lib/sis/backfill/grading/build-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Lower Secondary Global Grading Sheets';

// Explicit file list — never a directory glob. "Copy of Mathematics
// Grading Sheet..." is a corrupted duplicate (broken #REF! student names,
// wrong weights on its Integrity 1 tab) and must never be read.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  {
    file: 'Art and Design Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'ARTD',
  },
  {
    file: 'Computing Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'COMP',
  },
  {
    file: 'English Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'ENG',
  },
  {
    file: 'Global Perspectives Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'GP',
  },
  {
    file: 'Humanities Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'HUM',
  },
  {
    file: 'Mathematics Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'MATH',
  },
  {
    file: 'PE and Health Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'PEH',
  },
  {
    file: 'Science Grading Sheet Global Class AY2026 T1.xlsx',
    subjectCode: 'SCI',
  },
];

const SECTION_IDS: { levelCode: string; sectionName: string }[] = [
  { levelCode: 'S1', sectionName: 'Discipline 1' },
  { levelCode: 'S2', sectionName: 'Integrity 1' },
];

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook.
  const sheets = SUBJECT_FILES.flatMap(({ file, subjectCode }) =>
    parseGradingWorkbook(join(DIR, file), subjectCode)
  );

  // 2. Build the roster lookup for Discipline 1 + Integrity 1.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: sections, error: sectionsErr } = await svc
    .from('sections')
    .select('id, name, levels!inner(code)')
    .eq('academic_year_id', (ay as any).id)
    .in(
      'name',
      SECTION_IDS.map((s) => s.sectionName)
    );
  if (sectionsErr) throw sectionsErr;

  const sectionIdsByName = new Map<string, string>();
  for (const s of sections ?? [])
    sectionIdsByName.set((s as any).name, (s as any).id);

  const rosterLookup: RosterLookupEntry[] = [];
  for (const { levelCode, sectionName } of SECTION_IDS) {
    const sectionId = sectionIdsByName.get(sectionName);
    if (!sectionId) {
      throw new Error(
        `gen-ay2026-t1-grading: section "${sectionName}" not found for ${AY_CODE}`
      );
    }
    const { data: rows, error: rowsErr } = await svc
      .from('section_students')
      .select('id, index_number')
      .eq('section_id', sectionId);
    if (rowsErr) throw rowsErr;
    for (const r of rows ?? []) {
      rosterLookup.push({
        levelCode,
        sectionName,
        indexNumber: (r as any).index_number,
        sectionStudentId: (r as any).id,
      });
    }
  }

  // 3. Compose.
  const result = buildGradingImport({
    sheets,
    rosterLookup,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-grading-preview.sql',
    result.preview
  );
  writeFileSync('scripts/backfill/ay2026-t1-grading-apply.sql', result.apply);

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t1-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the gitignore entry**

Modify `.gitignore` — add after the existing `scripts/backfill/ay2026-t1-attendance-*` block:

```
# AY2026 grading import output (real student PII — names, scores).
# Generated by gen-ay2026-t1-grading.ts; review locally, never commit.
scripts/backfill/ay2026-t1-grading-*.sql
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — all prior Phase 1/2 tests plus the 12 new tests from Tasks 1–2 (83 + 12 = 95 total)

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t1-grading.ts .gitignore
git commit -m "feat(backfill): add AY2026 T1 grading import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-grading.ts`
Expected: prints a `Stats:` block with `subjectConfigsWritten: 16, gradingSheetsWritten: 16, gradeEntriesWritten` close to 312 (minus the ~3 expected needs-review rows), `needsReview: 3`, `quarterlyMismatches` at or near 0. Read `scripts/backfill/ay2026-t1-grading-preview.sql` and hand-verify the per-subject weight table matches design doc §3 exactly, and that the 3 needs-review rows are the expected ones (Discipline 1 index 14 & 25, Integrity 1 index 2).

---

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 decisions 1–10 are each implemented — scope (Task 3's `SUBJECT_FILES`/`SECTION_IDS`), stale-tab exclusion (Task 1's `startsWith('DO NOT USE')`), header-verbatim weights (Task 1's `weightAt`), roster resolution + needs-review (Task 2), real-module grade computation (Task 2's `computeQuarterly` import), cross-check-not-direct-write (Task 2's `checkMismatch`), `subject_configs` correction via `DO UPDATE` (Task 2's `buildApplySql`), sheet locking (Task 2's `grading_sheets` insert), `teacher_name` carry-over (Task 1 + Task 2), single-file mechanism (no chunking — volume confirmed tiny). §3's per-subject table is exercised directly by Task 1's two real-data-shaped fixtures (Math 2WW/3PT/2-trailing-cols, Art & Design 1WW/5PT/1-trailing-col) — the other 6 subjects share one of these two structural shapes, so the parser's generic column-resolution logic (not per-subject branching) is what covers them, not per-subject fixtures.
- **Placeholder scan:** an earlier draft of `buildApplySql`'s `grade_entries` block had a broken placeholder (`finishApplySql` that threw, and a `where exists`/`insert_source` fragment that didn't actually resolve `grading_sheet_id`) — caught during self-review and rewritten in place as a single correct `join grading_sheets gs on ...` block (no `where exists`, no stub function). The version in Task 2 Step 3 above is the corrected, final one.
- **Type consistency:** `RosterLookupEntry`, `ParsedSubjectSheet`, `GradingStudentRow` field names match exactly between Task 1's producer and Task 2/3's consumers (verified `sectionName` not `cleanName` — deliberately renamed from Phase 2's attendance module since "section name" reads clearer for this module and there's no cross-import between the two backfill submodules to keep in sync).

**NOTE (2026-07-18):** this file was found deleted from disk (never committed) partway through Phase 5's execution — recovered verbatim from this session's own conversation context (it had been Read in full earlier the same session) and committed immediately. Root cause not confirmed; suspected a destructive git operation (e.g. `git clean`) run by a subagent or concurrent session sharing this worktree. The matching Phase 2 attendance-import plan doc was NOT recoverable the same way (its content was never read into this session's context) and remains missing pending manual reconstruction if needed — the underlying implementation code is already merged/applied to production regardless, per the earlier session summary, so this is a documentation-history gap, not a functional one.

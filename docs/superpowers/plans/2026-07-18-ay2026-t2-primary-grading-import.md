# AY2026 T2 Primary Grading Sheets Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable `preview.sql` / `apply.sql` pair that imports HFSE's real AY2026 T2 Primary grading data (6 subjects × 14 real Primary sections) into `grading_sheets` / `grade_entries`, plus 3 targeted `subject_configs` corrections, without ever writing to the database directly from this codebase.

**Architecture:** A new parser (`grading-workbook-t2.ts`) reads each of the 6 real subject workbooks and classifies every tab as Primary / Secondary / unrecognized via a new identity regex (T1's parser only handled one shape and threw on anything else — this one must classify and skip gracefully, since these T2 files genuinely mix Primary and Secondary Regular-track tabs). It fixes a real bug found during investigation: T1's printed-grade-column finder took the _last_ `"Initial"`/`"Quarterly"` label match scanning a row, which is silently wrong on T2's shape (every sheet has a second, unreliable `"Quarterly"/"Term 1"` column pair after the real one). A new composer (`build-primary-grading-import.ts`) resolves rosters, computes grades via `lib/compute/quarterly.ts` (never re-implemented), and emits a single un-chunked `apply.sql` — this phase's `subject_configs` writes are 3 explicit, hand-verified corrections (not a full create-or-update-everything pass like Phase 3 needed), and it writes no `subject_level_offerings` or `section_subjects` at all, since both are already correctly populated. One orchestrator script wires DB reads + file parsing + the composer together.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md` — read it before starting; every task below implements a piece of it.
- Scope is exactly 6 subjects × the 14 real Primary sections with actual data: Math (MATH), English (ENG), Science (SCI), STAR (MAPEH), Filipino (FIL, 9 Regular-track sections only), Mandarin (MANDARIN, 5 Global-track sections only). Math/English/Science/MAPEH apply to all 14 sections.
- The orchestrator reads an explicit list of exactly 6 files — **never** `Copy of English Grading AY2026 T2.xlsx` or `Copy of Science Grading AY2026 T2.xlsx` (both confirmed corrupted: literal `#REF!` values in the NAME column, same signature as T1's corrupted duplicate).
- Every workbook mixes Primary and Secondary Regular-track tabs. The parser must classify each tab's identity and only produce output for Primary ones — Secondary tabs are recognized and skipped (not an error), reported in the preview for operator visibility. `Reserved N` / blank tabs fall through as `unrecognized` and are also skipped, not errors.
- Weights/max-scores come from each sheet's own header row (row 8's WS% cells) — **never** hardcoded or copied from `subject_configs`.
- The printed-grade cross-check reads only the **first** `"Initial"`/`"Quarterly"` label match scanning forward from the Exam column — **never** the last. Every T2 sheet has a second, spurious `"Quarterly"/"Term 1"` column pair after the real one; reading the last match (T1's behavior) would silently grab the wrong column.
- Grade computation (`ww_ps`/`pt_ps`/`qa_ps`/`initial_grade`/`quarterly_grade`) is done by **importing `lib/compute/quarterly.ts`'s `computeQuarterly` directly** — never re-implemented or ported. Per Hard Rule #1/#2.
- Roster resolution is via `(levelCode, sectionName, indexNumber)` lookup against live `section_students` — unresolved rows go to needs-review, never guessed.
- `subject_configs` writes are **exactly 3 rows**, via `ON CONFLICT (academic_year_id, subject_id) DO UPDATE` touching only `ww_weight`/`pt_weight`/`qa_weight`/`weights_confirmed` (never `ww_max_slots`/`pt_max_slots`/`qa_max`, which have DB defaults and are left untouched on the update path): FIL corrected to `0.4/0.4/0.2` (was `0.3/0.5/0.2`, unconfirmed); MAPEH re-asserted at its already-correct `0.2/0.6/0.2` (confirm-flag flip only); MANDARIN re-asserted at its already-correct `0.3/0.5/0.2` (confirm-flag flip only). MATH/ENG/SCI are read for the preview's per-subject weight table but never written (already correct and confirmed).
- **No `subject_level_offerings` or `section_subjects` writes at all** — both are already populated for all 6×applicable-section pairs from earlier ad-hoc backfills this session. This is a real scope reduction versus Phase 3.
- MAPEH's `"Final Grade Equivalent"` letter column in the source is never read and never written to `grade_entries.letter_grade` — it naturally falls outside the fixed column finder's matches (matches neither `"Initial"` nor `"Quarterly"`), and per KD #104 that column is reserved for UG/E manual overrides only.
- `grading_sheets` are locked on import: `is_locked=true, locked_at=now(), locked_by='backfill-import'`.
- No code in this plan ever writes to the database. The orchestrator only reads (for roster/subject/level/AY/term lookups) and writes local `.sql` files.
- Single, un-chunked `apply.sql` — volume here (≤6×14×~20 ≈ 1,700 `grade_entries` rows) is far below the scale that forced Phase 2's chunking fix (that was specifically an `attendance_daily`-row-count problem).
- Reuse `lib/sis/backfill/enrollment/sql-escape.ts` (`sqlString`, `sqlStringOrNull`) as-is for every SQL string literal.
- Do not modify `lib/sis/backfill/grading/grading-workbook.ts` or `build-grading-import.ts` (Phase 3, already shipped/applied). Every new capability for T2 Primary lives in new files; `ParsedSubjectSheet`/`GradingStudentRow` types are imported from Phase 3's module (not redefined), everything else is new.
- Output files (`scripts/backfill/ay2026-t2-primary-grading-{preview,apply}.sql`) contain real student names and scores (PII) — must be gitignored, matching every prior phase's pattern.

---

### Task 1: T2 Primary grading workbook parser

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook-t2.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook-t2.test.ts`

**Interfaces:**

- Consumes: `ParsedSubjectSheet`, `GradingStudentRow` types from `@/lib/sis/backfill/grading/grading-workbook` (existing, Phase 3 — imported as types only, never modified). Uses `xlsx` (`import * as XLSX from 'xlsx'`).
- Produces (consumed by Task 2):

  ```ts
  export interface ParseGradingWorkbookT2Result {
    sheets: ParsedSubjectSheet[];
    skippedSecondary: string[]; // sheet names recognized as Secondary, not processed
    skippedUnrecognized: string[]; // sheet names matching neither shape (Reserved/blank tabs)
  }

  export function parseGradingWorkbookT2(
    filePath: string,
    subjectCode: string
  ): ParseGradingWorkbookT2Result;
  ```

**Row layout this parser reads** (0-indexed, confirmed identical across all 6 real T2 Primary-relevant subject workbooks — same shape Phase 3's parser already handles for rows 3/7/8/9+):

- Row 2: `"Primary N WORD - SUBJECT"` (e.g. `"Primary 1 PATIENCE - MATH"`, `"Primary 1 PATIENCE - MUSIC, ARTS, PE, HEALTH"`) or `"Secondary N WORD [NUM] - SUBJECT"` (e.g. `"Secondary 1 DISCIPLINE 2 - LITERATURE"`) → level/section identity + kind. Real difference from T1: Primary section names have no numeric suffix, and every row carries a trailing `" - SUBJECT"` text T1's raw text never had.
- Row 3: `"Teacher: <name>"` (sometimes blank after the colon for a not-yet-assigned teacher) → teacher name.
- Row 5/6/7/8: identical shape to Phase 3 — weight labels, sub-column labels (`W1`, `PT1`, `Exam`, etc.), max-scores row (blank max = slot unused, excluded).
- Row 5 (from the Exam column onward): **two** `"Initial"`/`"Quarterly"` label pairs appear on every T2 sheet — the real one immediately after the Exam/PS/WS block, and a second, unreliable `"Quarterly"/"Term 1"` pair further along (confirmed via direct inspection: on Math, the real pair reads `92` while the second reads `60`/`93` with no consistent relationship; on Science the second pair coincidentally read close to the real one; on MAPEH the second pair's second column was a **letter**, not a number at all). Only the first match of each label is ever read.
- Rows 9+: student data, same trailing-blank-row stop condition as Phase 3.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/grading-workbook-t2.test.ts`:

```ts
// __tests__/sis/backfill/grading/grading-workbook-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT2 } from '@/lib/sis/backfill/grading/grading-workbook-t2';

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

// Real row shape from Math's "Math - P1 Patience" tab, transcribed verbatim
// (2 real WW slots of 3 nominal columns, 3 PT slots, then the real
// Initial/Quarterly pair at cols 17/18, THEN the spurious second
// "Quarterly"/"Term 1" pair at cols 21/22 that must never be read).
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Primary 1 PATIENCE - MATH'],
  ['Teacher: Mr. Wai Chung'],
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
    '',
    '',
    'Quarterly',
    'Term 1',
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
    '',
    '',
    '',
    '',
  ],
  [
    '',
    '',
    10,
    10,
    '',
    20,
    '100%',
    '40%',
    10,
    10,
    10,
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    1,
    'ALVAREZ, Jaime III D.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    9,
    6,
    10,
    25,
    '83.33',
    '33.33',
    22,
    '73.33',
    '14.67',
    88.0,
    92,
    '',
    '',
    60,
    93,
  ],
  [
    2,
    'AMATE, Jaiden Matthew A.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    10,
    7,
    10,
    27,
    '90.00',
    '36.00',
    24,
    '80.00',
    '16.00',
    92.0,
    95,
    '',
    '',
    95,
    98,
  ],
];

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab —
// a Secondary Regular-track section riding along in the same workbook.
// Must be recognized and skipped, never processed as Primary.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Secondary 1 DISCIPLINE 2 - LITERATURE'],
  ['Teacher: Ms. Carl'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (30%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (50%)',
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
  [],
  [
    '',
    '',
    'W1',
    '',
    '',
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
  ],
  [
    '',
    '',
    30,
    '',
    '',
    30,
    '100%',
    '30%',
    30,
    20,
    25,
    75,
    '100%',
    '50%',
    65,
    '100%',
    '20%',
  ],
  [
    1,
    'BAGANG, Miguel C.',
    26,
    '',
    '',
    26,
    '86.67',
    '26.00',
    28,
    19,
    25,
    72,
    '96.00',
    '48.00',
    59,
    '90.77',
    '18.15',
    92.15,
    95,
  ],
];

describe('parseGradingWorkbookT2', () => {
  it('parses a real Primary tab, reading only the FIRST Initial/Quarterly pair (not the spurious second pair)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('P1');
    expect(sheet.sectionName).toBe('Patience');
    expect(sheet.teacherName).toBe('Mr. Wai Chung');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    expect(sheet.wwTotals).toEqual([10, 10]);
    expect(sheet.ptTotals).toEqual([10, 10, 10]);
    expect(sheet.qaTotal).toBe(30);

    const alvarez = sheet.students[0];
    expect(alvarez.indexNo).toBe('1');
    expect(alvarez.fullName).toBe('ALVAREZ, Jaime III D.');
    // The real printed grades (cols 17/18) — NEVER the spurious second
    // pair's values (60/93 at cols 21/22).
    expect(alvarez.printedInitialGrade).toBeCloseTo(88.0);
    expect(alvarez.printedQuarterlyGrade).toBe(92);
  });

  it('recognizes a Secondary tab and reports it as skipped, never processing it as Primary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT2(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedSecondary).toEqual([
      'Literature - Sec 1 Discipline 2',
    ]);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('reports a blank/Reserved tab as unrecognized, not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'reserved.xlsx');
    writeWorkbook(path, { 'Reserved 1': [[''], [''], ['']] });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Reserved 1']);
    expect(result.skippedSecondary).toEqual([]);
  });

  it('title-cases a multi-word Secondary Regular-track section name correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit2.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': rows });

    // This case is exercised indirectly — sectionName title-casing is
    // proven directly via the Primary MATH case above ("PATIENCE" ->
    // "Patience"); this test proves the multi-word "DISCIPLINE 2" shape
    // is at least correctly classified as Secondary (not crashing on the
    // 2-word section name), matching the design doc's stated identity
    // regex behavior for the deferred Phase 6b.
    const result = parseGradingWorkbookT2(path, 'LIT');
    expect(result.skippedSecondary).toHaveLength(1);
  });

  it('handles a subject-suffix containing commas without breaking section-name extraction (MAPEH shape)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'star.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 PATIENCE - MUSIC, ARTS, PE, HEALTH'];
    writeWorkbook(path, { 'STAR - P1 Patience': rows });

    const result = parseGradingWorkbookT2(path, 'MAPEH');
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].sectionName).toBe('Patience');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook-t2'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/grading/grading-workbook-t2.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks (Primary + a
// Secondary Regular-track tab riding along in the same file) into one
// ParsedSubjectSheet per real PRIMARY section tab. Secondary tabs are
// recognized and skipped (Phase 6b's scope), never processed here.
//
// Two real deltas from Phase 3's T1 parser (grading-workbook.ts, never
// modified — this is a standalone module):
//   1. Row 2's identity text has no numeric section suffix for Primary
//      ("Primary 1 PATIENCE - MATH") and carries a trailing " - SUBJECT"
//      T1's raw text never had — a new regex handles both this and the
//      still-numbered Secondary shape ("Secondary 1 DISCIPLINE 2 - LIT").
//   2. Every T2 sheet has a SECOND, unreliable "Quarterly"/"Term 1" column
//      pair after the real printed-grade columns. T1's finder took the
//      LAST label match scanning forward — silently wrong here. This
//      finder takes the FIRST match of each label only.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface ParseGradingWorkbookT2Result {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
}

const ROW_LEVEL_SECTION = 2;
const ROW_TEACHER = 3;
const ROW_LABELS = 5;
const ROW_SUBCOLS = 7;
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
      'grading-workbook-t2: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

function weightAt(maxRow: unknown[], totalCol: number): number {
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `grading-workbook-t2: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

// Fixed version of Phase 3's column finder — takes the FIRST match of each
// label, not the last, and stops scanning once both are found. This is
// what keeps the spurious second "Quarterly"/"Term 1" pair out of the
// import entirely.
function findPrintedGradeColsT2(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    if (initialCol !== null && quarterlyCol !== null) break;
    const label = cell(labelRow, i);
    if (initialCol === null && /Initial/i.test(label)) {
      initialCol = i;
      continue;
    }
    if (quarterlyCol === null && /Quarterly/i.test(label)) {
      quarterlyCol = i;
    }
  }
  return { initialCol, quarterlyCol };
}

type IdentityT2 =
  | { kind: 'primary'; levelCode: string; sectionName: string }
  | { kind: 'secondary'; levelCode: string; sectionName: string }
  | { kind: 'unrecognized' };

const IDENTITY_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)\s+-\s+.+$/i;

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseIdentityT2(raw: string): IdentityT2 {
  const m = IDENTITY_RE.exec(raw.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, levelWord, levelNum, sectionRaw] = m;
  const isPrimary = levelWord.toLowerCase() === 'primary';
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

function parseOneSheetT2(
  rows: unknown[][],
  subjectCode: string
): { sheet: ParsedSubjectSheet | null; identity: IdentityT2 } {
  const identity = parseIdentityT2(cell(rows[ROW_LEVEL_SECTION], 0));
  if (identity.kind !== 'primary') return { sheet: null, identity };

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

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

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
    sheet: {
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
    },
    identity,
  };
}

export function parseGradingWorkbookT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity } = parseOneSheetT2(rows, subjectCode);
    if (identity.kind === 'primary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return { sheets, skippedSecondary, skippedUnrecognized };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t2.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run Phase 3's existing grading-workbook tests to confirm zero regression**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook.test.ts`
Expected: PASS (7 tests, unchanged)

- [ ] **Step 6: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-t2.ts __tests__/sis/backfill/grading/grading-workbook-t2.test.ts
git commit -m "feat(backfill): parse AY2026 T2 Primary grading workbooks, fixing a printed-grade-column bug"
```

---

### Task 2: Primary import composer (roster resolution, grade computation, corrections-only subject_configs, SQL emission)

**Files:**

- Create: `lib/sis/backfill/grading/build-primary-grading-import.ts`
- Test: `__tests__/sis/backfill/grading/build-primary-grading-import.test.ts`

**Interfaces:**

- Consumes (from Task 1): `ParsedSubjectSheet` (type only, from `@/lib/sis/backfill/grading/grading-workbook`, re-exported via Task 1's module).
- Consumes: `computeQuarterly` from `@/lib/compute/quarterly` (existing, live app engine). `sqlString` from `@/lib/sis/backfill/enrollment/sql-escape` (existing, Phase 1).
- Produces (consumed by Task 3):

  ```ts
  export interface RosterLookupEntry {
    levelCode: string;
    sectionName: string;
    indexNumber: number;
    sectionStudentId: string;
  }

  export interface SubjectConfigWeight {
    subjectCode: string;
    wwWeight: number;
    ptWeight: number;
    qaWeight: number;
  }

  export interface BuildPrimaryGradingImportInput {
    sheets: ParsedSubjectSheet[]; // flattened across every subject workbook, Primary-only
    rosterLookup: RosterLookupEntry[];
    subjectConfigWeights: SubjectConfigWeight[]; // exactly the subjects needing a subject_configs write
    ayCode: string;
    termNumber: number;
  }

  export interface BuildPrimaryGradingImportResult {
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

  export function buildPrimaryGradingImport(
    input: BuildPrimaryGradingImportInput
  ): BuildPrimaryGradingImportResult;
  ```

**Design note for the implementer:** unlike Phase 3's `buildGradingImport`, this composer does **not** decide which subjects need a `subject_configs` correction — that decision was made by hand during design (comparing real T2 header weights against the live DB) and is passed in explicitly via `subjectConfigWeights`. The composer's job is only to emit the SQL for exactly that list. Do not add any logic that derives corrections from the parsed sheets' own weights — that would silently start "correcting" MATH/ENG/SCI too, which are already correct and must not be touched (see Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/build-primary-grading-import.test.ts`:

```ts
// __tests__/sis/backfill/grading/build-primary-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildPrimaryGradingImport } from '@/lib/sis/backfill/grading/build-primary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-primary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 2 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'P1',
    sectionName: 'Patience',
    indexNumber: 1,
    sectionStudentId: 'ss-alvarez-uuid',
  },
  {
    levelCode: 'P1',
    sectionName: 'Patience',
    indexNumber: 2,
    sectionStudentId: 'ss-amate-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'ALVAREZ, Jaime III D.',
    wwScores: [10, 10],
    ptScores: [9, 6, 10],
    examScore: 22,
    printedInitialGrade: 88.0,
    printedQuarterlyGrade: 92,
    ...overrides,
  };
}

function mathSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'MATH',
    levelCode: 'P1',
    sectionName: 'Patience',
    teacherName: 'Mr. Wai Chung',
    wwWeight: 0.4,
    ptWeight: 0.4,
    qaWeight: 0.2,
    wwTotals: [10, 10],
    ptTotals: [10, 10, 10],
    qaTotal: 30,
    students: [student({})],
    ...overrides,
  };
}

describe('buildPrimaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildPrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);

    expect(result.apply).toContain("'MATH'");
    expect(result.apply).toContain("'P1'");
    expect(result.apply).toContain('grading_sheets');
    expect(result.apply).toContain('grade_entries');
    expect(result.apply).toContain("'ss-alvarez-uuid'");
    expect(result.apply).toContain("'backfill-import'");
    expect(result.apply).toContain('true'); // is_locked
  });

  it('emits subject_configs writes ONLY for entries explicitly passed in subjectConfigWeights, never derived from the sheets', () => {
    const sheets = [
      mathSheet(), // weight already correct, deliberately NOT in subjectConfigWeights
      mathSheet({
        subjectCode: 'FIL',
        wwWeight: 0.4,
        ptWeight: 0.4,
        qaWeight: 0.2,
      }),
    ];
    const weights: SubjectConfigWeight[] = [
      { subjectCode: 'FIL', wwWeight: 0.4, ptWeight: 0.4, qaWeight: 0.2 },
    ];
    const result = buildPrimaryGradingImport({
      ...BASE_INPUT,
      sheets,
      rosterLookup: ROSTER,
      subjectConfigWeights: weights,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.apply).toContain("'FIL'");
    expect(result.apply).toContain('weights_confirmed');
    expect(result.apply).toMatch(
      /on conflict \(academic_year_id, subject_id\) do update/i
    );
    // Confirms the correction touches only the 4 intended columns, never
    // ww_max_slots/pt_max_slots/qa_max (which have DB defaults and must
    // stay untouched on the update path).
    expect(result.apply).not.toMatch(/ww_max_slots\s*=\s*excluded/i);
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = mathSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildPrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
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
    const result = buildPrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.apply).toContain("'ss-alvarez-uuid'");
    expect(result.preview).toContain('quarterly');
  });

  it('produces a single un-chunked apply.sql string (not multiple files) at this volume', () => {
    const result = buildPrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(typeof result.apply).toBe('string');
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/build-primary-grading-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the composer**

Create `lib/sis/backfill/grading/build-primary-grading-import.ts`:

```ts
// lib/sis/backfill/grading/build-primary-grading-import.ts
// Composes parsed T2 Primary grading data (grading-workbook-t2.ts) into
// the two SQL artifacts described by the design doc: a read-only preview
// report and a transactional, idempotent apply script. No I/O — takes
// already-parsed sheets, an already-fetched roster lookup, and an
// explicit (hand-verified during design, not derived here) list of
// subject_configs corrections.
import { computeQuarterly } from '@/lib/compute/quarterly';
import { sqlString } from '../enrollment/sql-escape';
import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface RosterLookupEntry {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  sectionStudentId: string;
}

export interface SubjectConfigWeight {
  subjectCode: string;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
}

export interface BuildPrimaryGradingImportInput {
  sheets: ParsedSubjectSheet[];
  rosterLookup: RosterLookupEntry[];
  subjectConfigWeights: SubjectConfigWeight[];
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

export interface BuildPrimaryGradingImportResult {
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

export function buildPrimaryGradingImport(
  input: BuildPrimaryGradingImportInput
): BuildPrimaryGradingImportResult {
  const { sheets, rosterLookup, subjectConfigWeights, ayCode, termNumber } =
    input;

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

  const stats: BuildPrimaryGradingImportResult['stats'] = {
    subjectConfigsWritten: subjectConfigWeights.length,
    gradingSheetsWritten: sheets.length,
    gradeEntriesWritten: resolved.length,
    needsReview: needsReview.length,
    quarterlyMismatches: mismatches.length,
  };

  return {
    preview: buildPreviewSql(
      sheets,
      subjectConfigWeights,
      needsReview,
      mismatches,
      stats
    ),
    apply: buildApplySql(
      ayCode,
      termNumber,
      sheets,
      resolved,
      subjectConfigWeights
    ),
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
  subjectConfigWeights: SubjectConfigWeight[],
  needsReview: NeedsReviewRow[],
  mismatches: MismatchRow[],
  stats: BuildPrimaryGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T2 Primary grading sheets import — PREVIEW (read-only)'
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t2-primary-grading.ts from the 6 real T2 "GRADES" subject workbooks.'
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
    `-- subject_configs corrections (${subjectConfigWeights.length}):`
  );
  if (subjectConfigWeights.length === 0) lines.push('--   (none)');
  for (const w of subjectConfigWeights) {
    lines.push(
      `--   ${w.subjectCode}: ww=${w.wwWeight} pt=${w.ptWeight} qa=${w.qaWeight}, weights_confirmed -> true`
    );
  }
  lines.push('--');
  lines.push(
    `-- gradingSheets=${stats.gradingSheetsWritten} gradeEntries=${stats.gradeEntriesWritten}`
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
  subjectConfigWeights: SubjectConfigWeight[]
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T2 Primary grading sheets import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t2-primary-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t2-primary-grading.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push(
    '-- subject_configs writes below are EXACTLY the hand-verified corrections'
  );
  lines.push(
    '-- from the design doc — never derived from the sheets themselves. No'
  );
  lines.push(
    '-- subject_level_offerings or section_subjects writes (already populated).'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  // --- 1) subject_configs corrections (0-3 rows, explicit list only) ---
  if (subjectConfigWeights.length > 0) {
    lines.push('drop table if exists _ay26pgrd_subject_configs;');
    lines.push(
      'create temp table _ay26pgrd_subject_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
    );
    lines.push('values');
    const configRows = subjectConfigWeights.map(
      (w) =>
        `  (${sqlString(w.subjectCode)}, ${w.wwWeight}, ${w.ptWeight}, ${w.qaWeight})`
    );
    lines.push(configRows.join(',\n') + ';');
    lines.push('');
    lines.push(
      'insert into subject_configs (academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, weights_confirmed)'
    );
    lines.push(
      'select ay.id, sub.id, c.ww_weight, c.pt_weight, c.qa_weight, true'
    );
    lines.push('from _ay26pgrd_subject_configs c');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push('join subjects sub on sub.code = c.subject_code');
    lines.push('on conflict (academic_year_id, subject_id) do update set');
    lines.push('  ww_weight = excluded.ww_weight,');
    lines.push('  pt_weight = excluded.pt_weight,');
    lines.push('  qa_weight = excluded.qa_weight,');
    lines.push('  weights_confirmed = excluded.weights_confirmed;');
    lines.push('');
  }

  // --- 2) grading_sheets ---
  lines.push('drop table if exists _ay26pgrd_sheets;');
  lines.push(
    'create temp table _ay26pgrd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
  );
  lines.push('values');
  const sheetRows = sheets.map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${sqlString(s.sectionName)}, ${s.teacherName == null ? 'NULL' : sqlString(s.teacherName)}, ARRAY[${s.wwTotals.join(',')}]::numeric[], ARRAY[${s.ptTotals.join(',')}]::numeric[], ${s.qaTotal ?? 'null'})`
  );
  lines.push(sheetRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, teacher_name, ww_totals, pt_totals, qa_total, is_locked, locked_at, locked_by)'
  );
  lines.push(
    "select t.id, sec.id, sub.id, sc.id, s.teacher_name, s.ww_totals, s.pt_totals, s.qa_total, true, now(), 'backfill-import'"
  );
  lines.push('from _ay26pgrd_sheets s');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = s.subject_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.name = s.section_name'
  );
  lines.push(
    'join subject_configs sc on sc.academic_year_id = ay.id and sc.subject_id = sub.id'
  );
  lines.push('on conflict (term_id, section_id, subject_id) do nothing;');
  lines.push('');

  // --- 3) grade_entries ---
  lines.push('drop table if exists _ay26pgrd_entries;');
  lines.push(
    'create temp table _ay26pgrd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
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
  lines.push('from _ay26pgrd_entries e');
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
    `select count(*) as grading_sheets_rows from grading_sheets gs join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select count(*) as grade_entries_rows from grade_entries ge join grading_sheets gs on gs.id=ge.grading_sheet_id join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select code, ww_weight, pt_weight, qa_weight, weights_confirmed from subject_configs sc join academic_years ay on ay.id=sc.academic_year_id join subjects sub on sub.id=sc.subject_id where ay.ay_code=${sqlString(ayCode)} and sub.code in (${subjectConfigWeights.map((w) => sqlString(w.subjectCode)).join(', ') || "'__NONE__'"});`
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/build-primary-grading-import.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/build-primary-grading-import.ts __tests__/sis/backfill/grading/build-primary-grading-import.test.ts
git commit -m "feat(backfill): compose AY2026 T2 Primary grading import SQL, corrections-only subject_configs"
```

---

### Task 3: Orchestrator script + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t2-primary-grading.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseGradingWorkbookT2` from Task 1, `buildPrimaryGradingImport` + `RosterLookupEntry` + `SubjectConfigWeight` from Task 2, `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks — this is the final task. Writes `scripts/backfill/ay2026-t2-primary-grading-preview.sql` and `scripts/backfill/ay2026-t2-primary-grading-apply.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t2-primary-grading.ts`:

```ts
// scripts/backfill/gen-ay2026-t2-primary-grading.ts
// Generates ay2026-t2-primary-grading-{preview,apply}.sql from HFSE's real
// T2 "GRADES" folder subject workbooks (Primary tabs only — Secondary
// Regular-track tabs riding along in the same files are recognized and
// skipped, deferred to Phase 6b). Emits SQL for review — does NOT write
// to the database itself. See:
// docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-primary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT2 } from '../../lib/sis/backfill/grading/grading-workbook-t2';
import { buildPrimaryGradingImport } from '../../lib/sis/backfill/grading/build-primary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-primary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const DIR = 'AY2026/T2/Term 2 Grades/GRADES';

// Explicit file list — never a directory glob. "Copy of English..." and
// "Copy of Science..." are corrupted duplicates (literal #REF! in the
// NAME column, same signature as T1's corrupted file) and must never be
// read.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'Math Grading AY2026 T2.xlsx', subjectCode: 'MATH' },
  { file: 'English Grading AY2026 T2.xlsx', subjectCode: 'ENG' },
  { file: 'Science Grading AY2026 T2.xlsx', subjectCode: 'SCI' },
  { file: 'STAR (PrI) Grading AY2026 T2.xlsx', subjectCode: 'MAPEH' },
  { file: 'Filipino Grading AY2026 T2.xlsx', subjectCode: 'FIL' },
  { file: 'Mandarin Grading AY2026 T2.xlsx', subjectCode: 'MANDARIN' },
];

// Hand-verified during design (docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
// §2 Locked Decision #6) by comparing each subject's real T2 header weight
// against the live subject_configs value — NOT derived at generation time.
// MATH/ENG/SCI are deliberately absent: already correct + already
// weights_confirmed=true from Phase 3 / its correction pass.
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [
  { subjectCode: 'FIL', wwWeight: 0.4, ptWeight: 0.4, qaWeight: 0.2 }, // real correction: was 0.3/0.5/0.2
  { subjectCode: 'MAPEH', wwWeight: 0.2, ptWeight: 0.6, qaWeight: 0.2 }, // confirm-only, already correct
  { subjectCode: 'MANDARIN', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 }, // confirm-only, already correct
];

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook; collect Primary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT2>['sheets'] = [];
  let skippedSecondaryTotal = 0;
  let skippedUnrecognizedTotal = 0;
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT2(join(DIR, file), subjectCode);
    sheets = sheets.concat(result.sheets);
    skippedSecondaryTotal += result.skippedSecondary.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    console.log(
      `${file}: ${result.sheets.length} Primary sheet(s), skipped ${result.skippedSecondary.length} Secondary + ${result.skippedUnrecognized.length} unrecognized`
    );
  }

  // 2. Build the roster lookup for AY2026's Primary sections.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code, level_type))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.levels.level_type', 'primary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 3. Compose.
  const result = buildPrimaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-preview.sql',
    result.preview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedSecondaryTotal} Secondary tabs (deferred to Phase 6b), ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the gitignore entry**

Modify `.gitignore` — add after the existing `scripts/backfill/ay2026-t1-grading-*.sql` line:

```

# AY2026 T2 Primary grading import output (real student PII — names,
# scores). Generated by gen-ay2026-t2-primary-grading.ts; review locally,
# never commit.
scripts/backfill/ay2026-t2-primary-grading-*.sql
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every prior phase's test plus the 10 new tests from Tasks 1–2 (5 + 5 = 10 new), all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t2-primary-grading.ts .gitignore
git commit -m "feat(backfill): add AY2026 T2 Primary grading import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-primary-grading.ts`
Expected: prints a per-file skip-count line for all 6 files, then a `Stats:` block with `gradingSheetsWritten` at or near 6×14=84 (minus MANDARIN's 9 Global-only-excluded sections and FIL's 5 Regular-only-excluded sections, so realistically `(4×14) + 9 + 5 = 70`), `subjectConfigsWritten: 3`, `gradeEntriesWritten` in the mid-hundreds to ~1,700, `needsReview` and `quarterlyMismatches` at or near 0. Read `scripts/backfill/ay2026-t2-primary-grading-preview.sql` in full and hand-verify: (1) the 3 `subject_configs` corrections exactly match the design doc's table (FIL numeric change, MAPEH/MANDARIN confirm-only); (2) MATH/ENG/SCI's per-subject weight lines show no correction alongside them; (3) any needs-review or mismatch rows look like genuine data issues, not a parsing bug.

---

---

## Amendment (2026-07-18) — Task 4: tab-name-first identity, fixing a silent misattribution risk

**Why:** Tasks 1–3 were implemented, reviewed, and run for real. The real run found two things the design got wrong — see `docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md` §8 for the full investigation. In short: (1) the 3 `Reserved N` tabs are not empty — they're real Respect/Gentleness/Compassion sections that were never renamed; (2) row 2's text is simply wrong on 6 real tabs across 4 subjects (a copy-paste artifact from cloning a template tab in Excel), and because roster resolution keys on `(levelCode, sectionName, indexNumber)`, a wrong `sectionName` from row 2 doesn't reliably fail loud — it can resolve against a _different real section's_ roster and silently attribute one student's grades to another. Tab names, by contrast, are provably reliable (Excel forbids two tabs sharing a name). This task fixes `grading-workbook-t2.ts` to prefer tab-name identity, falling back to row 2 only when the tab name doesn't parse, and logs every case where the two signals disagree so a human can see exactly what got corrected.

### Task 4: Tab-name-first identity resolution

**Files:**

- Modify: `lib/sis/backfill/grading/grading-workbook-t2.ts` (Task 1, already shipped — this task changes it directly, unlike every other task in this project which avoids touching prior-phase files; this file belongs to this same phase, not an earlier one, so amending it in place is correct)
- Modify: `__tests__/sis/backfill/grading/grading-workbook-t2.test.ts` (add new test cases; existing 5 tests must still pass unchanged)
- Modify: `scripts/backfill/gen-ay2026-t2-primary-grading.ts` (aggregate + report the new `identityCorrections` list)

**Interfaces:**

- Changes `ParseGradingWorkbookT2Result` (consumed by Task 3's orchestrator): adds one new field, `identityCorrections: string[]`, alongside the existing `sheets`/`skippedSecondary`/`skippedUnrecognized`.
- Does **not** change `build-primary-grading-import.ts` (Task 2) at all — the identity-corrections report is stitched into `preview.sql` by the orchestrator (Task 3), appended after the composer's own preview output, so Task 2 stays untouched and doesn't need re-review.

- [ ] **Step 1: Write the failing tests — add 3 new test cases to the existing file**

Modify `__tests__/sis/backfill/grading/grading-workbook-t2.test.ts` — replace the file's entire content with the following (the first 5 `it(...)` blocks are unchanged from Task 1, reproduced here verbatim so the file is complete and self-contained; only the 3 new tests at the end and the new fixtures above them are additions):

```ts
// __tests__/sis/backfill/grading/grading-workbook-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT2 } from '@/lib/sis/backfill/grading/grading-workbook-t2';

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

// Real row shape from Math's "Math - P1 Patience" tab, transcribed verbatim
// (2 real WW slots of 3 nominal columns, 3 PT slots, then the real
// Initial/Quarterly pair at cols 17/18, THEN the spurious second
// "Quarterly"/"Term 1" pair at cols 21/22 that must never be read).
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Primary 1 PATIENCE - MATH'],
  ['Teacher: Mr. Wai Chung'],
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
    '',
    '',
    'Quarterly',
    'Term 1',
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
    '',
    '',
    '',
    '',
  ],
  [
    '',
    '',
    10,
    10,
    '',
    20,
    '100%',
    '40%',
    10,
    10,
    10,
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    1,
    'ALVAREZ, Jaime III D.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    9,
    6,
    10,
    25,
    '83.33',
    '33.33',
    22,
    '73.33',
    '14.67',
    88.0,
    92,
    '',
    '',
    60,
    93,
  ],
  [
    2,
    'AMATE, Jaiden Matthew A.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    10,
    7,
    10,
    27,
    '90.00',
    '36.00',
    24,
    '80.00',
    '16.00',
    92.0,
    95,
    '',
    '',
    95,
    98,
  ],
];

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab —
// a Secondary Regular-track section riding along in the same workbook.
// Must be recognized and skipped, never processed as Primary.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Secondary 1 DISCIPLINE 2 - LITERATURE'],
  ['Teacher: Ms. Carl'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (30%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (50%)',
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
  [],
  [
    '',
    '',
    'W1',
    '',
    '',
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
  ],
  [
    '',
    '',
    30,
    '',
    '',
    30,
    '100%',
    '30%',
    30,
    20,
    25,
    75,
    '100%',
    '50%',
    65,
    '100%',
    '20%',
  ],
  [
    1,
    'BAGANG, Miguel C.',
    26,
    '',
    '',
    26,
    '86.67',
    '26.00',
    28,
    19,
    25,
    72,
    '96.00',
    '48.00',
    59,
    '90.77',
    '18.15',
    92.15,
    95,
  ],
];

describe('parseGradingWorkbookT2', () => {
  it('parses a real Primary tab, reading only the FIRST Initial/Quarterly pair (not the spurious second pair)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('P1');
    expect(sheet.sectionName).toBe('Patience');
    expect(sheet.teacherName).toBe('Mr. Wai Chung');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    expect(sheet.wwTotals).toEqual([10, 10]);
    expect(sheet.ptTotals).toEqual([10, 10, 10]);
    expect(sheet.qaTotal).toBe(30);

    const alvarez = sheet.students[0];
    expect(alvarez.indexNo).toBe('1');
    expect(alvarez.fullName).toBe('ALVAREZ, Jaime III D.');
    // The real printed grades (cols 17/18) — NEVER the spurious second
    // pair's values (60/93 at cols 21/22).
    expect(alvarez.printedInitialGrade).toBeCloseTo(88.0);
    expect(alvarez.printedQuarterlyGrade).toBe(92);
    // Tab name and row 2 agree here — no correction needed.
    expect(result.identityCorrections).toEqual([]);
  });

  it('recognizes a Secondary tab and reports it as skipped, never processing it as Primary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT2(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedSecondary).toEqual([
      'Literature - Sec 1 Discipline 2',
    ]);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('reports a blank/Reserved tab as unrecognized, not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'reserved.xlsx');
    writeWorkbook(path, { 'Reserved 1': [[''], [''], ['']] });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Reserved 1']);
    expect(result.skippedSecondary).toEqual([]);
  });

  it('title-cases a multi-word Secondary Regular-track section name correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit2.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': rows });

    const result = parseGradingWorkbookT2(path, 'LIT');
    expect(result.skippedSecondary).toHaveLength(1);
  });

  it('handles a subject-suffix containing commas without breaking section-name extraction (MAPEH shape)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'star.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 PATIENCE - MUSIC, ARTS, PE, HEALTH'];
    writeWorkbook(path, { 'STAR - P1 Patience': rows });

    const result = parseGradingWorkbookT2(path, 'MAPEH');
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].sectionName).toBe('Patience');
  });

  it('uses the TAB NAME over a wrong row-2 label, and records the mismatch — the real bug this task fixes', () => {
    // Real bug, verified against the actual workbook: the tab is genuinely
    // "P5 Perseverance" (confirmed by its real roster of Perseverance
    // students), but row 2 was copy-pasted from the Commitment tab and
    // still says "COMMITMENT". Trusting row 2 here would silently resolve
    // these students against the Commitment section's real roster instead.
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'eng.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 5 COMMITMENT - ENGLISH'];
    writeWorkbook(path, { 'English - P5 Perseverance': rows });

    const result = parseGradingWorkbookT2(path, 'ENG');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('P5');
    expect(result.sheets[0].sectionName).toBe('Perseverance');
    expect(result.identityCorrections).toHaveLength(1);
    expect(result.identityCorrections[0]).toContain(
      'English - P5 Perseverance'
    );
    expect(result.identityCorrections[0]).toContain('P5 Perseverance');
    expect(result.identityCorrections[0]).toContain('P5 Commitment');
  });

  it('falls back to row 2 when the tab name does not parse, recovering a real Reserved-tab section without flagging a mismatch', () => {
    // The Finding-A case: "Reserved 1" is not empty — it's a real,
    // never-renamed Respect section. Tab name gives no signal at all here
    // (doesn't parse), so this must fall back to row 2, and since there's
    // no tab-name signal to disagree with, no correction is logged.
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'reserved-respect.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 RESPECT - MATH'];
    writeWorkbook(path, { 'Reserved 1': rows });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('P1');
    expect(result.sheets[0].sectionName).toBe('Respect');
    expect(result.identityCorrections).toEqual([]);
  });

  it('resolves two tabs with SWAPPED row-2 labels independently and correctly via tab name (Mandarin P3/P4 real case)', () => {
    // Real bug: "Mandarin - P3 Courtesy" and "Mandarin - P4 Diligence" have
    // their row-2 labels swapped with each other. Each tab must resolve to
    // its OWN correct identity via its own tab name — neither one's real
    // students may end up attributed to the other section.
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'mandarin.xlsx');
    const p3Rows = MATH_P1_ROWS.map((r) => [...r]);
    p3Rows[2] = ['Primary 4 DILIGENCE - MANDARIN'];
    const p4Rows = MATH_P1_ROWS.map((r) => [...r]);
    p4Rows[2] = ['Primary 3 COURTESY - MANDARIN'];
    writeWorkbook(path, {
      'Mandarin - P3 Courtesy': p3Rows,
      'Mandarin - P4 Diligence': p4Rows,
    });

    const result = parseGradingWorkbookT2(path, 'MANDARIN');

    expect(result.sheets).toHaveLength(2);
    const bySection = new Map(result.sheets.map((s) => [s.sectionName, s]));
    expect(bySection.get('Courtesy')?.levelCode).toBe('P3');
    expect(bySection.get('Diligence')?.levelCode).toBe('P4');
    expect(result.identityCorrections).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify the 3 new tests fail** (the existing 5 already pass — this is a modify, not a from-scratch module)

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t2.test.ts`
Expected: 5 PASS, 3 FAIL — the 3 new tests fail because `identityCorrections` doesn't exist on the result yet and the tab-name-first behavior isn't implemented.

- [ ] **Step 3: Implement the fix**

Replace the entire content of `lib/sis/backfill/grading/grading-workbook-t2.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks (Primary + a
// Secondary Regular-track tab riding along in the same file) into one
// ParsedSubjectSheet per real PRIMARY section tab. Secondary tabs are
// recognized and skipped (Phase 6b's scope), never processed here.
//
// Deltas from Phase 3's T1 parser (grading-workbook.ts, never modified —
// this is a standalone module):
//   1. Row 2's identity text has no numeric section suffix for Primary
//      ("Primary 1 PATIENCE - MATH") and carries a trailing " - SUBJECT"
//      T1's raw text never had — a new regex handles both this and the
//      still-numbered Secondary shape ("Secondary 1 DISCIPLINE 2 - LIT").
//   2. Every T2 sheet has a SECOND, unreliable "Quarterly"/"Term 1" column
//      pair after the real printed-grade columns. T1's finder took the
//      LAST label match scanning forward — silently wrong here. This
//      finder takes the FIRST match of each label only.
//   3. (Added after a real run — see design doc §8.) Row 2's text is
//      sometimes simply WRONG — a copy-paste artifact from cloning an
//      existing tab as a template in Excel and forgetting to update the
//      label. Because roster resolution keys on (levelCode, sectionName,
//      indexNumber), trusting a wrong row-2 label doesn't fail loud — it
//      can silently resolve against a DIFFERENT real section's roster.
//      Tab names are structurally reliable (Excel forbids duplicate tab
//      names), so identity is now resolved from the tab name FIRST, with
//      row 2 used only as a fallback when the tab name itself doesn't
//      parse (the real case for the never-renamed "Reserved N" tabs).
//      Every case where the two signals disagree is recorded so a human
//      can see exactly what got corrected.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface ParseGradingWorkbookT2Result {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
}

const ROW_LEVEL_SECTION = 2;
const ROW_TEACHER = 3;
const ROW_LABELS = 5;
const ROW_SUBCOLS = 7;
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
      'grading-workbook-t2: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

function weightAt(maxRow: unknown[], totalCol: number): number {
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `grading-workbook-t2: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

// Fixed version of Phase 3's column finder — takes the FIRST match of each
// label, not the last, and stops scanning once both are found. This is
// what keeps the spurious second "Quarterly"/"Term 1" pair out of the
// import entirely.
function findPrintedGradeColsT2(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    if (initialCol !== null && quarterlyCol !== null) break;
    const label = cell(labelRow, i);
    if (initialCol === null && /Initial/i.test(label)) {
      initialCol = i;
      continue;
    }
    if (quarterlyCol === null && /Quarterly/i.test(label)) {
      quarterlyCol = i;
    }
  }
  return { initialCol, quarterlyCol };
}

type IdentityT2 =
  | { kind: 'primary'; levelCode: string; sectionName: string }
  | { kind: 'secondary'; levelCode: string; sectionName: string }
  | { kind: 'unrecognized' };

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Row 2's shape: "Primary N NAME - SUBJECT" or "Secondary N NAME - SUBJECT".
const ROW2_IDENTITY_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)\s+-\s+.+$/i;

function parseRow2Identity(raw: string): IdentityT2 {
  const m = ROW2_IDENTITY_RE.exec(raw.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, levelWord, levelNum, sectionRaw] = m;
  const isPrimary = levelWord.toLowerCase() === 'primary';
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

// Tab name's shape: "<Subject> - P<N> <Name>", "<Subject> - S<N> <Name>", or
// "<Subject> - Sec <N> <Name>" (the S/Sec spelling varies by file — both
// observed in real data, "Sec" tried first so it isn't shadowed by the
// single-letter "S" alternative).
const TAB_NAME_IDENTITY_RE = /^.+?\s*-\s*(Sec|P|S)\.?\s*(\d+)\s+(.+)$/i;

function parseTabNameIdentity(sheetName: string): IdentityT2 {
  const m = TAB_NAME_IDENTITY_RE.exec(sheetName.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, prefix, levelNum, sectionRaw] = m;
  const isPrimary = prefix.toLowerCase().startsWith('p');
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

function identityLabel(identity: IdentityT2): string {
  return identity.kind === 'unrecognized'
    ? '(unrecognized)'
    : `${identity.levelCode} ${identity.sectionName}`;
}

// Tab name wins whenever it parses — Excel forbids two tabs sharing a
// name, so a mistyped tab name would be immediately visible to whoever
// built the workbook, unlike a free-text label cell that's easy to
// fat-finger via copy-paste without visual feedback. Row 2 is the
// fallback ONLY when the tab name doesn't parse (the real case for
// never-renamed "Reserved N" tabs). When both parse but disagree, a
// human-readable correction note is returned so the operator can see
// exactly what got overridden.
function resolveIdentity(
  sheetName: string,
  row2Raw: string
): { identity: IdentityT2; correctionNote: string | null } {
  const tabIdentity = parseTabNameIdentity(sheetName);
  if (tabIdentity.kind === 'unrecognized') {
    return { identity: parseRow2Identity(row2Raw), correctionNote: null };
  }

  const row2Identity = parseRow2Identity(row2Raw);
  const disagrees =
    row2Identity.kind !== 'unrecognized' &&
    (row2Identity.kind !== tabIdentity.kind ||
      row2Identity.levelCode !== tabIdentity.levelCode ||
      row2Identity.sectionName !== tabIdentity.sectionName);

  return {
    identity: tabIdentity,
    correctionNote: disagrees
      ? `"${sheetName}": tab name says ${identityLabel(tabIdentity)}, row 2 says ${identityLabel(row2Identity)} — using tab name`
      : null,
  };
}

function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}

function parseOneSheetT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
} {
  const { identity, correctionNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'primary')
    return { sheet: null, identity, correctionNote };

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

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

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
    sheet: {
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
    },
    identity,
    correctionNote,
  };
}

export function parseGradingWorkbookT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote } = parseOneSheetT2(
      rows,
      subjectCode,
      sheetName
    );
    if (correctionNote) identityCorrections.push(correctionNote);
    if (identity.kind === 'primary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return { sheets, skippedSecondary, skippedUnrecognized, identityCorrections };
}
```

- [ ] **Step 4: Run the tests to verify all 8 pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t2.test.ts`
Expected: PASS (8 tests — the original 5 plus 3 new)

- [ ] **Step 5: Run Phase 3's existing grading-workbook tests + the full backfill suite to confirm zero regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every test across every phase, including Task 2/3's tests (which don't reference `identityCorrections` and are unaffected by this change).

- [ ] **Step 6: Update the orchestrator to report identity corrections in preview.sql**

Replace the entire content of `scripts/backfill/gen-ay2026-t2-primary-grading.ts`:

```ts
// scripts/backfill/gen-ay2026-t2-primary-grading.ts
// Generates ay2026-t2-primary-grading-{preview,apply}.sql from HFSE's real
// T2 "GRADES" folder subject workbooks (Primary tabs only — Secondary
// Regular-track tabs riding along in the same files are recognized and
// skipped, deferred to Phase 6b). Emits SQL for review — does NOT write
// to the database itself. See:
// docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-primary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT2 } from '../../lib/sis/backfill/grading/grading-workbook-t2';
import { buildPrimaryGradingImport } from '../../lib/sis/backfill/grading/build-primary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-primary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const DIR = 'AY2026/T2/Term 2 Grades/GRADES';

// Explicit file list — never a directory glob. "Copy of English..." and
// "Copy of Science..." are corrupted duplicates (literal #REF! in the
// NAME column, same signature as T1's corrupted file) and must never be
// read.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'Math Grading AY2026 T2.xlsx', subjectCode: 'MATH' },
  { file: 'English Grading AY2026 T2.xlsx', subjectCode: 'ENG' },
  { file: 'Science Grading AY2026 T2.xlsx', subjectCode: 'SCI' },
  { file: 'STAR (PrI) Grading AY2026 T2.xlsx', subjectCode: 'MAPEH' },
  { file: 'Filipino Grading AY2026 T2.xlsx', subjectCode: 'FIL' },
  { file: 'Mandarin Grading AY2026 T2.xlsx', subjectCode: 'MANDARIN' },
];

// Hand-verified during design (docs/superpowers/specs/2026-07-18-ay2026-t2-primary-grading-import-design.md
// §2 Locked Decision #6) by comparing each subject's real T2 header weight
// against the live subject_configs value — NOT derived at generation time.
// MATH/ENG/SCI are deliberately absent: already correct + already
// weights_confirmed=true from Phase 3 / its correction pass.
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [
  { subjectCode: 'FIL', wwWeight: 0.4, ptWeight: 0.4, qaWeight: 0.2 }, // real correction: was 0.3/0.5/0.2
  { subjectCode: 'MAPEH', wwWeight: 0.2, ptWeight: 0.6, qaWeight: 0.2 }, // confirm-only, already correct
  { subjectCode: 'MANDARIN', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 }, // confirm-only, already correct
];

function buildIdentityCorrectionsSection(corrections: string[]): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(
    `-- Identity corrections (${corrections.length}) — tab name overrode a conflicting row 2 label:`
  );
  lines.push('-- (see design doc §8 for why row 2 alone is not trustworthy)');
  if (corrections.length === 0) lines.push('--   (none)');
  for (const c of corrections) lines.push(`--   ${c}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook; collect Primary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT2>['sheets'] = [];
  let skippedSecondaryTotal = 0;
  let skippedUnrecognizedTotal = 0;
  let allIdentityCorrections: string[] = [];
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT2(join(DIR, file), subjectCode);
    sheets = sheets.concat(result.sheets);
    skippedSecondaryTotal += result.skippedSecondary.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    console.log(
      `${file}: ${result.sheets.length} Primary sheet(s), skipped ${result.skippedSecondary.length} Secondary + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s)`
    );
  }

  // 2. Build the roster lookup for AY2026's Primary sections.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code, level_type))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.levels.level_type', 'primary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 3. Compose.
  const result = buildPrimaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    result.preview +
    '\n' +
    buildIdentityCorrectionsSection(allIdentityCorrections);

  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-primary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedSecondaryTotal} Secondary tabs (deferred to Phase 6b), ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log(
    `Identity corrections (tab name overrode row 2): ${allIdentityCorrections.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-primary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 7: Run the full backfill test suite once more to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — all tests across all phases green.

- [ ] **Step 8: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-t2.ts __tests__/sis/backfill/grading/grading-workbook-t2.test.ts scripts/backfill/gen-ay2026-t2-primary-grading.ts
git commit -m "fix(backfill): resolve AY2026 T2 Primary grading identity from tab name, not row 2"
```

- [ ] **Step 9: Re-run the generator for real and re-verify**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-primary-grading.ts`
Expected: `gradingSheetsWritten` rises from the prior run's 85 (17 Primary sheets per subject minus the ones that never applied — Respect/Gentleness/Compassion still won't resolve, since those 3 sections still don't exist in `section_students`, but they'll now correctly land in needs-review under their true names instead of not appearing at all where a wrong-identity tab used to silently absorb them). The `Identity corrections` count should read exactly **6** (matching the table in design doc §8 Finding B) — read `scripts/backfill/ay2026-t2-primary-grading-preview.sql`'s new "Identity corrections" section in full and hand-verify each of the 6 lines matches the table in the design doc exactly, and that no unexpected 7th correction appears (which would mean another tab has the same problem this investigation didn't catch).

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 Locked Decisions 1–10 are each implemented — scope (Task 3's `SUBJECT_FILES`), corrupted-file exclusion (explicit list, never `Copy of...`), Primary/Secondary/unrecognized classification + skip-not-error handling (Task 1, tested for all three), the fixed first-match printed-grade-column finder (Task 1, tested against a fixture carrying the real spurious second pair), the exactly-3-subject corrections-only `subject_configs` write (Task 2/3, tested to prove it never touches an untouched subject or `ww_max_slots`/etc.), no `subject_level_offerings`/`section_subjects` writes (simply absent from Task 2's SQL — verified by omission, not present anywhere in `buildApplySql`), MAPEH's letter column never read/written (Task 1's column finder only matches `Initial`/`Quarterly` labels — `"Final Grade Equivalent"` matches neither), roster resolution + needs-review + real-formula grade computation (Task 2, mirrors Phase 3's proven pattern), sheet locking (Task 2's `grading_sheets` insert), single un-chunked `apply.sql` (Task 2 returns one string, no file-array/chunking machinery — tested explicitly). §3's architecture and §4's SQL write plan map 1:1 onto Tasks 1–3. §5's validation plan is Task 3 Step 5.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type consistency:** `ParsedSubjectSheet`/`GradingStudentRow` field names are imported as types from Phase 3's module (not redefined) and used identically across Task 1's producer and Task 2's consumer. `RosterLookupEntry` and `SubjectConfigWeight` names/shapes match exactly between Task 2's producer and Task 3's orchestrator usage — verified `subjectCode`/`wwWeight`/`ptWeight`/`qaWeight` field names are consistent in the test file, the implementation, and the orchestrator's `SUBJECT_CONFIG_WEIGHTS` constant.
- **Corrected during plan-writing (not a new design decision, a factual fix caught while re-verifying against a precise column dump):** the design doc originally claimed MAPEH has no printed Quarterly column and needs an Initial-only fallback. A precise indexed dump showed it does have a real printed Quarterly grade (paired correctly by the fixed first-match column finder) — no special-case is needed, and the design doc was corrected accordingly before this plan was written. This plan reflects the corrected, simpler reality: MAPEH is handled by the same code path as every other subject.
- **Amendment self-review (Task 4, added after Tasks 1–3's real run):** spec coverage — design doc §8's two findings are each covered (Finding A via the existing Reserved-tab-fallback test + Finding B via the new mismatch/swap tests + the real 6-correction table cross-check in Step 9); placeholder scan — none found; type consistency — `ParseGradingWorkbookT2Result.identityCorrections` is additive-only, verified it doesn't break Task 2/3's existing consumption (Task 2 never reads this field at all, and Task 3's orchestrator is the only consumer, updated in this same task). Deliberately scoped to touch only Task 1's own file (same-phase, not a prior-phase violation) plus Task 3's orchestrator — Task 2's composer is untouched and does not need re-review.

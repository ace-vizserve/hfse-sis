# AY2026 T1 Secondary Grading Import + T2 Filipino Secondary Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import HFSE's real T1 Secondary Regular-track grading data (Discipline 2, Integrity 2, S3 Consistency, S4 Excellence) and separately backfill T2's Secondary Filipino data that a prior phase incorrectly excluded — both as reviewable `preview.sql`/`apply.sql` pairs the user runs manually.

**Architecture:** Part A (Tasks 1–3) mirrors the proven T2-secondary-import architecture (parser → composer → orchestrator) with one addition — a `DO NOT USE` tab filter T1's source data needs but T2's never did. Part B (Task 4) is a small standalone correction script that reuses 100% of T2's existing, already-tested parser/composer code, unmodified — no new library code.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, Vitest for tests, Supabase (`@supabase/supabase-js` via `createServiceClient`) for roster lookup, raw SQL generation (no ORM) for the apply/preview artifacts.

## Global Constraints

- **Hard Rule #2:** all grade computation happens server-side, via `lib/compute/quarterly.ts::computeQuarterly` — never recompute or approximate a grade any other way.
- **Hard Rule #6:** append-only. `ON CONFLICT ... DO NOTHING` everywhere; never `UPDATE` or `DELETE` an existing `grading_sheets`/`grade_entries` row.
- **`grading_sheets` are locked on import**: `is_locked=true, locked_at=now(), locked_by='backfill-import'`.
- **Nothing ever writes to the database automatically.** Every `apply.sql` this plan produces is reviewed and run manually by the user (Mr Ace) in the Supabase SQL editor — never by an agent, a script, or a test. Any step in this plan that would invoke a generator script against the live database (roster lookup queries via `createServiceClient`) is marked **CONTROLLER-ONLY** and must NOT be run by an implementer subagent — it is performed by the human-facing controller after the task is implemented and reviewed.
- All new files are near-verbatim mirrors of already-proven siblings (`grading-workbook-secondary-t2.ts`, `grading-workbook-global-t2.ts`, `build-secondary-grading-import.ts`, `gen-ay2026-t2-secondary-grading.ts`) — this is deliberate, accepted duplication matching this project's established convention. Do not "clean up" the duplication or extract new shared abstractions beyond what already exists in `t2-masthead.ts`.
- Every real-fixture test must actually run against the real files under `AY2026/T1/Term 1 Grades/Grades/` and `AY2026/T2/Term 2 Grades/GRADES/` — the exact counts below were validated by directly running the equivalent logic during design; reproduce them, don't assume them.

---

### Task 1: T1 Secondary grading-workbook parser

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook-t1-secondary.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts`

**Interfaces:**

- Consumes: `./grading-workbook`'s `GradingStudentRow` / `ParsedSubjectSheet` types; `./t2-masthead`'s `ROW_LEVEL_SECTION`, `ROW_TEACHER`, `ROW_LABELS`, `ROW_SUBCOLS`, `ROW_MAXSCORES`, `ROW_STUDENTS_START`, `cell`, `numOrNull`, `findColumnLayout`, `weightAt`, `findPrintedGradeColsT2`, `resolveIdentity`, `parseTeacherName`, `type IdentityT2` — all unchanged, no new helpers added to `t2-masthead.ts`.
- Produces: `ParseGradingWorkbookT1SecondaryResult` (fields: `sheets: ParsedSubjectSheet[]`, `sheetNames: string[]`, `skippedPrimary: string[]`, `skippedDoNotUse: string[]`, `skippedUnrecognized: string[]`, `identityCorrections: string[]`, `truncationNotes: string[]`) and `parseGradingWorkbookT1Secondary(filePath: string, subjectCode: string): ParseGradingWorkbookT1SecondaryResult` — Task 3's orchestrator imports both.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts`:

```typescript
// __tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT1Secondary } from '@/lib/sis/backfill/grading/grading-workbook-t1-secondary';

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

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab in
// T1's Grades folder.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
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

// Real row shape from Math's "Math - P1 Patience" tab — used here to prove
// a Primary tab riding along in the same file is skipped, never processed
// as Secondary.
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
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
  ],
  [],
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
  ],
];

describe('parseGradingWorkbookT1Secondary', () => {
  it('parses a real Secondary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT1Secondary(path, 'LIT');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('LIT');
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 2');
    expect(sheet.teacherName).toBe('Ms. Carl');
    expect(sheet.wwWeight).toBeCloseTo(0.3);
    expect(sheet.ptWeight).toBeCloseTo(0.5);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    const bagang = sheet.students[0];
    expect(bagang.printedInitialGrade).toBeCloseTo(92.15);
    expect(bagang.printedQuarterlyGrade).toBe(95);
  });

  it('recognizes a Primary tab riding along in the same file and skips it, never processing it as Secondary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT1Secondary(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedPrimary).toEqual(['Math - P1 Patience']);
    expect(result.skippedUnrecognized).toEqual([]);
    expect(result.skippedDoNotUse).toEqual([]);
  });

  it('skips a "DO NOT USE" tab entirely — never in sheets, never leaking a duplicate identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'math-donotuse.xlsx');
    writeWorkbook(path, {
      'DO NOT USE Math - S4 Excellence': [['Term 1 - 2026'], ['irrelevant']],
      'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS,
    });

    const result = parseGradingWorkbookT1Secondary(path, 'LIT');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].sectionName).toBe('Discipline 2');
    expect(result.skippedDoNotUse).toEqual(['DO NOT USE Math - S4 Excellence']);
    expect(result.sheets.some((s) => s.sectionName === 'Excellence')).toBe(
      false
    );
  });

  it('resolves a truncated SS & Geo tab name via row 2, recording a truncation note (real case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'ssgeo.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    rows[2] = ['Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'];
    writeWorkbook(path, {
      'Social Studies&Geography - S3 C': rows,
    });

    const result = parseGradingWorkbookT1Secondary(path, 'SS');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('S3');
    expect(result.sheets[0].sectionName).toBe('Consistency');
    expect(result.truncationNotes).toHaveLength(1);
    expect(result.identityCorrections).toEqual([]);
  });
});

describe('parseGradingWorkbookT1Secondary (real fixture files — full 9-file sweep)', () => {
  const DIR = 'AY2026/T1/Term 1 Grades/Grades';
  const FILES: { file: string; code: string }[] = [
    { file: 'English Grading AY2026 T1.xlsx', code: 'ENG' },
    { file: 'Math Grading AY2026 T1.xlsx', code: 'MATH' },
    { file: 'Science Grading AY2026 T1.xlsx', code: 'SCI' },
    { file: 'Filipino Grading AY2026 T1.xlsx', code: 'FIL' },
    { file: 'History Grading AY2026 T1.xlsx', code: 'HIST' },
    { file: 'Literature Grading AY2026 T1.xlsx', code: 'LIT' },
    { file: 'SS & Geo Grading AY2026 T1.xlsx', code: 'SS' },
    { file: 'Contemporary Arts Grading AY2026 T1.xlsx', code: 'CA' },
    { file: 'PE (Sec) Grading AY2026 T1.xlsx', code: 'PEH' },
  ];

  it(
    'parses all 9 real files into exactly 32 sheets / 768 students total, with the exact counts confirmed during design',
    { timeout: 30000 },
    () => {
      let totalSheets = 0;
      let totalStudents = 0;
      let totalDoNotUse = 0;
      let totalPrimarySkipped = 0;
      let totalUnrecognized = 0;
      let totalIdentityCorrections = 0;
      let totalTruncationNotes = 0;
      for (const f of FILES) {
        const result = parseGradingWorkbookT1Secondary(
          `${DIR}/${f.file}`,
          f.code
        );
        totalSheets += result.sheets.length;
        totalStudents += result.sheets.reduce(
          (sum, s) => sum + s.students.length,
          0
        );
        totalDoNotUse += result.skippedDoNotUse.length;
        totalPrimarySkipped += result.skippedPrimary.length;
        totalUnrecognized += result.skippedUnrecognized.length;
        totalIdentityCorrections += result.identityCorrections.length;
        totalTruncationNotes += result.truncationNotes.length;
      }
      expect(totalSheets).toBe(32);
      expect(totalStudents).toBe(768);
      expect(totalDoNotUse).toBe(8);
      expect(totalPrimarySkipped).toBe(64);
      expect(totalUnrecognized).toBe(0);
      expect(totalIdentityCorrections).toBe(0);
      expect(totalTruncationNotes).toBe(6);
    }
  );

  it(
    'History has only Discipline 2 + Integrity 2 — no S3/S4 tabs exist in the real file',
    { timeout: 30000 },
    () => {
      const result = parseGradingWorkbookT1Secondary(
        `${DIR}/History Grading AY2026 T1.xlsx`,
        'HIST'
      );
      expect(result.sheets).toHaveLength(2);
      const sections = result.sheets.map((s) => s.sectionName).sort();
      expect(sections).toEqual(['Discipline 2', 'Integrity 2']);
    }
  );

  it(
    'SS & Geo has only S3 Consistency + S4 Excellence — no S1/S2 tabs exist — and its DO-NOT-USE tab is filtered',
    { timeout: 30000 },
    () => {
      const result = parseGradingWorkbookT1Secondary(
        `${DIR}/SS & Geo Grading AY2026 T1.xlsx`,
        'SS'
      );
      expect(result.sheets).toHaveLength(2);
      const sections = result.sheets.map((s) => s.sectionName).sort();
      expect(sections).toEqual(['Consistency', 'Excellence']);
      expect(result.skippedDoNotUse).toHaveLength(1);
    }
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook-t1-secondary'`.

- [ ] **Step 3: Read the three files this parser mirrors**

Read `lib/sis/backfill/grading/grading-workbook-secondary-t2.ts` (the direct sibling this file copies), `lib/sis/backfill/grading/grading-workbook-global-t2.ts` (source of the `DO NOT USE` filter pattern, lines with `sheetName.startsWith('DO NOT USE')`), and `lib/sis/backfill/grading/t2-masthead.ts` (the shared helpers — read only to confirm exact export names, do not modify this file).

- [ ] **Step 4: Write the implementation**

Create `lib/sis/backfill/grading/grading-workbook-t1-secondary.ts`:

```typescript
// lib/sis/backfill/grading/grading-workbook-t1-secondary.ts
// Parses HFSE's real T1 "GRADES" folder (AY2026/T1/Term 1 Grades/Grades/)
// subject workbooks into one ParsedSubjectSheet per real SECONDARY
// (Regular-track) section tab — the counterpart to
// grading-workbook-t1-primary.ts, which processes the Primary tabs in
// these same files.
//
// Near-verbatim mirror of grading-workbook-secondary-t2.ts, PLUS one
// addition: T1's Secondary tabs carry "DO NOT USE" duplicate tabs that
// T2's never had (confirmed via design-time inspection of all 9 relevant
// files — every file with an S4 Excellence tab has exactly one DO-NOT-USE
// duplicate resolving to the identical identity). Reusing
// grading-workbook-secondary-t2.ts unmodified would let both the
// DO-NOT-USE tab and the real tab reach the composer as separate rows
// sharing one (term_id, section_id, subject_id) key — an order-dependent
// silent-corruption risk. The fix mirrors grading-workbook-global-t2.ts's
// exact DO-NOT-USE filter: skip immediately, before identity resolution
// ever runs.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';
import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  numOrNull,
  findColumnLayout,
  weightAt,
  findPrintedGradeColsT2,
  resolveIdentity,
  parseTeacherName,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookT1SecondaryResult {
  sheets: ParsedSubjectSheet[];
  sheetNames: string[];
  skippedPrimary: string[];
  skippedDoNotUse: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetT1Secondary(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const { identity, correctionNote, truncationNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'secondary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  // numOrNull (not a bare !== '' check) — a real sheet can use "-" for an
  // unused slot's max score. See grading-workbook-t2.ts's identical fix.
  const realWwCols = layout.wwCols.filter(
    (c) => numOrNull(cell(maxRow, c)) !== null
  );
  const realPtCols = layout.ptCols.filter(
    (c) => numOrNull(cell(maxRow, c)) !== null
  );
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
    truncationNote,
  };
}

export function parseGradingWorkbookT1Secondary(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT1SecondaryResult {
  const wb = XLSX.readFile(filePath);
  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  const skippedPrimary: string[] = [];
  const skippedDoNotUse: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith('DO NOT USE')) {
      skippedDoNotUse.push(sheetName);
      continue;
    }
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetT1Secondary(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      candidates.push({ sheetName, sheet });
    } else if (identity.kind === 'primary') {
      skippedPrimary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets: candidates.map((c) => c.sheet),
    sheetNames: candidates.map((c) => c.sheetName),
    skippedPrimary,
    skippedDoNotUse,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts`
Expected: PASS — all tests green, including the real-fixture sweep (may take a few seconds to read all 9 real `.xlsx` files).

- [ ] **Step 6: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-t1-secondary.ts __tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts
git commit -m "feat(backfill): parse AY2026 T1 Secondary grading workbooks"
```

---

### Task 2: T1 Secondary grading import composer

**Files:**

- Create: `lib/sis/backfill/grading/build-t1-secondary-grading-import.ts`
- Test: `__tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts`

**Interfaces:**

- Consumes: `./grading-workbook`'s `GradingStudentRow` / `ParsedSubjectSheet` types; `@/lib/compute/quarterly`'s `computeQuarterly`; `../enrollment/sql-escape`'s `sqlString`. Does NOT consume anything from Task 1 directly (this composer takes already-parsed `ParsedSubjectSheet[]` as input — decoupled from the parser, matching every sibling composer).
- Produces: `RosterLookupEntry` (fields: `levelCode: string`, `sectionName: string`, `indexNumber: number`, `sectionStudentId: string`), `SubjectConfigWeight` (fields: `subjectCode: string`, `wwWeight: number`, `ptWeight: number`, `qaWeight: number`), `BuildT1SecondaryGradingImportInput` (fields: `sheets: ParsedSubjectSheet[]`, `rosterLookup: RosterLookupEntry[]`, `subjectConfigWeights: SubjectConfigWeight[]`, `ayCode: string`, `termNumber: number`), `BuildT1SecondaryGradingImportResult` (fields: `preview: string`, `apply: string`, `stats: { subjectConfigsWritten: number; gradingSheetsWritten: number; gradeEntriesWritten: number; needsReview: number; quarterlyMismatches: number }`), and `buildT1SecondaryGradingImport(input: BuildT1SecondaryGradingImportInput): BuildT1SecondaryGradingImportResult` — Task 3's orchestrator imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts`:

```typescript
// __tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildT1SecondaryGradingImport } from '@/lib/sis/backfill/grading/build-t1-secondary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-t1-secondary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    indexNumber: 1,
    sectionStudentId: 'ss-bagang-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'BAGANG, Miguel C.',
    wwScores: [26],
    ptScores: [28, 19, 25],
    examScore: 59,
    printedInitialGrade: 92.15,
    printedQuarterlyGrade: 95,
    ...overrides,
  };
}

function litSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'LIT',
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    teacherName: 'Ms. Carl',
    wwWeight: 0.3,
    ptWeight: 0.5,
    qaWeight: 0.2,
    wwTotals: [30],
    ptTotals: [30, 20, 25],
    qaTotal: 65,
    students: [student({})],
    ...overrides,
  };
}

describe('buildT1SecondaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);
    expect(result.apply).toContain("'LIT'");
    expect(result.apply).toContain("'S1'");
    expect(result.apply).toContain("'ss-bagang-uuid'");
    expect(result.apply).toContain("'backfill-import'");
  });

  it('renders "(none)" and emits no subject_configs block at all when subjectConfigWeights is empty — the real behavior this phase needs (T1 Secondary needs zero corrections)', () => {
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.subjectConfigsWritten).toBe(0);
    expect(result.preview).toContain('subject_configs corrections (0)');
    expect(result.preview).toContain('(none)');
    expect(result.apply).not.toContain('insert into subject_configs');
    expect(result.apply).not.toMatch(/create temp table _\w*_subject_configs/);
  });

  it('emits subject_configs writes ONLY for entries explicitly passed in subjectConfigWeights, never derived from the sheets', () => {
    const sheets = [
      litSheet(),
      litSheet({
        subjectCode: 'HIST',
        wwWeight: 0.3,
        ptWeight: 0.5,
        qaWeight: 0.2,
      }),
    ];
    const weights: SubjectConfigWeight[] = [
      { subjectCode: 'HIST', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 },
    ];
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets,
      rosterLookup: ROSTER,
      subjectConfigWeights: weights,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.apply).toContain("'HIST'");
    expect(result.apply).toContain('weights_confirmed');
    expect(result.apply).toMatch(
      /on conflict \(academic_year_id, subject_id\) do update/i
    );
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = litSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildT1SecondaryGradingImport({
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
    const sheet = litSheet({
      students: [student({ printedQuarterlyGrade: 999 })],
    });
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.preview).toContain('quarterly');
  });

  it('produces a single un-chunked apply.sql string (not multiple files) at this volume', () => {
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
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

Run: `npx vitest run __tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/build-t1-secondary-grading-import'`.

- [ ] **Step 3: Read the file this composer mirrors**

Read `lib/sis/backfill/grading/build-secondary-grading-import.ts` directly from disk — this new file only changes title strings ("T2 Secondary" → "T1 Secondary") and internal temp-table name prefixes (`_ay26sgrd_` → `_ay26t1sgrd_`, so a real run of both scripts in the same Supabase SQL editor session never collides on a temp table name). Every other line — `checkMismatch`, `buildPreviewSql`'s structure, `buildApplySql`'s structure, the `toFixed6` helper, the `on conflict` clauses — is identical.

- [ ] **Step 4: Write the implementation**

Create `lib/sis/backfill/grading/build-t1-secondary-grading-import.ts`:

```typescript
// lib/sis/backfill/grading/build-t1-secondary-grading-import.ts
// Composes parsed T1 Secondary Regular-track grading data
// (grading-workbook-t1-secondary.ts) into the two SQL artifacts described
// by the design doc: a read-only preview report and a transactional,
// idempotent apply script. No I/O.
//
// Near-verbatim mirror of build-secondary-grading-import.ts (Phase 6b) —
// deliberate duplication, only title strings and temp-table name prefixes
// differ, matching the same "accepted duplication" convention already
// used between every prior pair of term-specific composers.
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

export interface BuildT1SecondaryGradingImportInput {
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

export interface BuildT1SecondaryGradingImportResult {
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

export function buildT1SecondaryGradingImport(
  input: BuildT1SecondaryGradingImportInput
): BuildT1SecondaryGradingImportResult {
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

  const stats: BuildT1SecondaryGradingImportResult['stats'] = {
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
  stats: BuildT1SecondaryGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T1 Secondary grading sheets import — PREVIEW (read-only)'
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-secondary-grading.ts from the Regular-track'
  );
  lines.push(
    '-- "Grades" subject workbooks. Global-track Discipline 1/Integrity 1 are'
  );
  lines.push('-- already imported by Phase 3, untouched here.');
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
    '-- AY2026 T1 Secondary grading sheets import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t1-secondary-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t1-secondary-grading.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push(
    '-- subject_configs writes below (if any) are EXACTLY the hand-verified'
  );
  lines.push(
    '-- corrections from the design doc — never derived from the sheets'
  );
  lines.push(
    '-- themselves. No subject_level_offerings or section_subjects writes'
  );
  lines.push('-- (already populated).');
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  if (subjectConfigWeights.length > 0) {
    lines.push('drop table if exists _ay26t1sgrd_subject_configs;');
    lines.push(
      'create temp table _ay26t1sgrd_subject_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
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
    lines.push('from _ay26t1sgrd_subject_configs c');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push('join subjects sub on sub.code = c.subject_code');
    lines.push('on conflict (academic_year_id, subject_id) do update set');
    lines.push('  ww_weight = excluded.ww_weight,');
    lines.push('  pt_weight = excluded.pt_weight,');
    lines.push('  qa_weight = excluded.qa_weight,');
    lines.push('  weights_confirmed = excluded.weights_confirmed;');
    lines.push('');
  }

  lines.push('drop table if exists _ay26t1sgrd_sheets;');
  lines.push(
    'create temp table _ay26t1sgrd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
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
  lines.push('from _ay26t1sgrd_sheets s');
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

  lines.push('drop table if exists _ay26t1sgrd_entries;');
  lines.push(
    'create temp table _ay26t1sgrd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
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
  lines.push('from _ay26t1sgrd_entries e');
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
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/sis/backfill/grading/build-t1-secondary-grading-import.ts __tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts
git commit -m "feat(backfill): compose AY2026 T1 Secondary grading import SQL"
```

---

### Task 3: T1 Secondary grading import orchestrator

**Files:**

- Create: `scripts/backfill/gen-ay2026-t1-secondary-grading.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Task 1's `parseGradingWorkbookT1Secondary` and `ParseGradingWorkbookT1SecondaryResult`; Task 2's `buildT1SecondaryGradingImport`, `RosterLookupEntry`, `SubjectConfigWeight`; `lib/supabase/service`'s `createServiceClient`.
- Produces: `scripts/backfill/ay2026-t1-secondary-grading-preview.sql` and `scripts/backfill/ay2026-t1-secondary-grading-apply.sql` on disk (gitignored, never committed).

- [ ] **Step 1: Confirm the real filenames**

Run: `ls "AY2026/T1/Term 1 Grades/Grades/"`
Expected output includes exactly these 11 files (9 are relevant here; Mandarin and STAR MAPEH have zero Secondary tabs and are correctly excluded from this orchestrator):

```
Contemporary Arts Grading AY2026 T1.xlsx
English Grading AY2026 T1.xlsx
Filipino Grading AY2026 T1.xlsx
History Grading AY2026 T1.xlsx
Literature Grading AY2026 T1.xlsx
Mandarin Grading AY2026 T1.xlsx
Math Grading AY2026 T1.xlsx
PE (Sec) Grading AY2026 T1.xlsx
Science Grading AY2026 T1.xlsx
SS & Geo Grading AY2026 T1.xlsx
STAR MAPEH (PrI) Grading AY2026 T1.xlsx
```

If any filename differs from what's written in Step 3 below, correct the `SUBJECT_FILES` list to match reality exactly before proceeding.

- [ ] **Step 2: Read the orchestrator this one mirrors**

Read `scripts/backfill/gen-ay2026-t2-secondary-grading.ts` directly from disk (the Regular-track half of it is the direct precedent) and `scripts/backfill/gen-ay2026-t1-primary-grading.ts` (the more recent, more directly structurally analogous sibling — same AY, same source folder, same roster-query shape, just Primary vs Secondary).

- [ ] **Step 3: Write the implementation**

Create `scripts/backfill/gen-ay2026-t1-secondary-grading.ts`:

```typescript
// scripts/backfill/gen-ay2026-t1-secondary-grading.ts
// Generates ay2026-t1-secondary-grading-{preview,apply}.sql from HFSE's
// real T1 "Grades" folder subject workbooks (Secondary Regular-track tabs
// only — Discipline 2, Integrity 2, S3 Consistency, S4 Excellence).
// Global-track Discipline 1/Integrity 1 are already imported by Phase 3,
// untouched here. Emits SQL for review — does NOT write to the database
// itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-secondary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT1Secondary } from '../../lib/sis/backfill/grading/grading-workbook-t1-secondary';
import { buildT1SecondaryGradingImport } from '../../lib/sis/backfill/grading/build-t1-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-t1-secondary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Grades';

// Explicit file list — never a directory glob. History has no S3/S4 tabs
// (genuinely absent from the real file); SS & Geo has no S1/S2 tabs (same).
// Mandarin and STAR MAPEH have zero Secondary tabs at all — not listed.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'English Grading AY2026 T1.xlsx', subjectCode: 'ENG' },
  { file: 'Math Grading AY2026 T1.xlsx', subjectCode: 'MATH' },
  { file: 'Science Grading AY2026 T1.xlsx', subjectCode: 'SCI' },
  { file: 'Filipino Grading AY2026 T1.xlsx', subjectCode: 'FIL' },
  { file: 'History Grading AY2026 T1.xlsx', subjectCode: 'HIST' },
  { file: 'Literature Grading AY2026 T1.xlsx', subjectCode: 'LIT' },
  { file: 'SS & Geo Grading AY2026 T1.xlsx', subjectCode: 'SS' },
  { file: 'Contemporary Arts Grading AY2026 T1.xlsx', subjectCode: 'CA' },
  { file: 'PE (Sec) Grading AY2026 T1.xlsx', subjectCode: 'PEH' },
];

// Design doc §1.2 point 3: every one of the 9 subjects' T1 Secondary
// header weights already matches the live, corrected subject_configs —
// verified directly this session. Empty on purpose — NOT derived at
// generation time, and NOT simply omitted from the composer call (the
// composer must correctly handle this empty-but-real input, per Task 2).
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

function buildNotesSection(heading: string, notes: string[]): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(`-- ${heading} (${notes.length}):`);
  if (notes.length === 0) lines.push('--   (none)');
  for (const n of notes) lines.push(`--   ${n}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  // 1. Parse every real workbook; collect Secondary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT1Secondary>['sheets'] = [];
  let skippedPrimaryTotal = 0;
  let skippedDoNotUseTotal = 0;
  let skippedUnrecognizedTotal = 0;
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT1Secondary(
      join(DIR, file),
      subjectCode
    );
    sheets = sheets.concat(result.sheets);
    skippedPrimaryTotal += result.skippedPrimary.length;
    skippedDoNotUseTotal += result.skippedDoNotUse.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedDoNotUse.length} DO-NOT-USE + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
    );
  }

  // 2. Build the roster lookup for AY2026's Secondary sections.
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
    .eq('sections.levels.level_type', 'secondary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 3. Compose.
  const result = buildT1SecondaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    result.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      allIdentityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      allTruncationNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t1-secondary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-secondary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedPrimaryTotal} Primary tabs (owned by sub-phase 1), ${skippedDoNotUseTotal} DO-NOT-USE tabs, ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t1-secondary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-secondary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 4: Add the `.gitignore` entry**

Read the current `.gitignore` and find this existing block:

```
# AY2026 T1 Primary grading import output (real student PII — names,
# scores). Generated by gen-ay2026-t1-primary-grading.ts; review locally,
# never commit.
scripts/backfill/ay2026-t1-primary-grading-*.sql
```

Immediately after that block (before the blank line that precedes the next `# AY2026 T2 Primary grading import output ...` block), insert:

```

# AY2026 T1 Secondary grading import output (real student PII — names,
# scores). Generated by gen-ay2026-t1-secondary-grading.ts; review
# locally, never commit.
scripts/backfill/ay2026-t1-secondary-grading-*.sql
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — same total test count as before this task plus the new tests from Tasks 1 and 2, zero failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill/gen-ay2026-t1-secondary-grading.ts .gitignore
git commit -m "feat(backfill): add AY2026 T1 Secondary grading import orchestrator"
```

**Do NOT run this script against the live database as part of this task.** Running `gen-ay2026-t1-secondary-grading.ts` requires `--env-file=.env.local` and calls `createServiceClient()`, which uses the production Supabase service-role key — per this project's standing rule, that step is **CONTROLLER-ONLY**, performed by the human-facing controller after this task is implemented and reviewed, not by the implementer subagent. Confirming the file compiles (`tsc --noEmit`) and the full test suite still passes is sufficient to mark this task done.

---

### Task 4: T2 Secondary Filipino backfill orchestrator

**Files:**

- Create: `scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: the EXISTING, UNMODIFIED `parseGradingWorkbookSecondaryT2` from `lib/sis/backfill/grading/grading-workbook-secondary-t2.ts`, and the EXISTING, UNMODIFIED `buildSecondaryGradingImport`, `RosterLookupEntry`, `SubjectConfigWeight` from `lib/sis/backfill/grading/build-secondary-grading-import.ts` — no code from Tasks 1–3. `lib/supabase/service`'s `createServiceClient`.
- Produces: `scripts/backfill/ay2026-t2-filipino-secondary-backfill-preview.sql` and `scripts/backfill/ay2026-t2-filipino-secondary-backfill-apply.sql` on disk (gitignored, never committed) — deliberately new filenames, never overwriting `scripts/backfill/ay2026-t2-secondary-grading-{preview,apply}.sql` (Phase 6b's original artifacts).

This task has no dedicated test file — it is 100% reuse of already-tested, unmodified library code (design doc §2.4, matching every prior phase's "no orchestrator test" convention). Its correctness is verified by Step 5 below (real parse, no DB write) plus the standard typecheck/regression steps — not by a new unit test.

- [ ] **Step 1: Read the two files this orchestrator reuses**

Read `lib/sis/backfill/grading/grading-workbook-secondary-t2.ts` and `lib/sis/backfill/grading/build-secondary-grading-import.ts` directly from disk to confirm their exact current export names and signatures (`parseGradingWorkbookSecondaryT2(filePath: string, subjectCode: string)`, `buildSecondaryGradingImport(input: BuildSecondaryGradingImportInput)`). Do not modify either file — this task imports them as-is.

- [ ] **Step 2: Confirm the real filename**

Run: `ls "AY2026/T2/Term 2 Grades/GRADES/" | grep -i Filipino`
Expected output: `Filipino Grading AY2026 T2.xlsx`

- [ ] **Step 3: Write the implementation**

Create `scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts`:

```typescript
// scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
// Generates ay2026-t2-filipino-secondary-backfill-{preview,apply}.sql — a
// standalone correction closing a real gap: Phase 6b's T2 Secondary import
// excluded Filipino entirely, citing tabs it claimed were "structurally
// incomplete." Direct inspection during this design proved that claim
// false — the real file has complete WW/PT/QA data for all 4 Secondary
// sections. This script backfills exactly that one subject, for T2 only,
// using the EXISTING, UNMODIFIED T2 Secondary parser/composer — no new
// library code, since T2's Filipino Secondary tabs have no DO-NOT-USE
// duplicates (confirmed during design). Deliberately writes to its OWN
// preview/apply filenames, never touching Phase 6b's original
// ay2026-t2-secondary-grading-{preview,apply}.sql artifacts. Emits SQL for
// review — does NOT write to the database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';
import { buildSecondaryGradingImport } from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-secondary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const DIR = 'AY2026/T2/Term 2 Grades/GRADES';
const FILE = 'Filipino Grading AY2026 T2.xlsx';
const SUBJECT_CODE = 'FIL';

// Design doc §2.2 point 4: FIL's T2 header (0.3/0.5/0.2) already matches
// the live subject_configs row exactly — the same row already verified
// this session for Primary FIL/GP weights. Empty on purpose, same
// convention as every sibling orchestrator.
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

function buildNotesSection(heading: string, notes: string[]): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(`-- ${heading} (${notes.length}):`);
  if (notes.length === 0) lines.push('--   (none)');
  for (const n of notes) lines.push(`--   ${n}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  // 1. Parse the one real workbook via the existing T2 Secondary parser —
  //    no new library code; T2's Filipino Secondary tabs have no
  //    DO-NOT-USE duplicates.
  const result = parseGradingWorkbookSecondaryT2(join(DIR, FILE), SUBJECT_CODE);
  console.log(
    `${FILE}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
  );

  // 2. Build the roster lookup for AY2026's Secondary sections.
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
    .eq('sections.levels.level_type', 'secondary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 3. Compose via the existing, unmodified T2 Secondary composer.
  const composed = buildSecondaryGradingImport({
    sheets: result.sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    composed.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      result.identityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      result.truncationNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t2-filipino-secondary-backfill-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-filipino-secondary-backfill-apply.sql',
    composed.apply
  );

  console.log('Stats:', JSON.stringify(composed.stats, null, 2));
  console.log(
    `Identity corrections: ${result.identityCorrections.length}, truncation notes: ${result.truncationNotes.length}`
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-filipino-secondary-backfill-preview.sql'
  );
  console.log(
    'Wrote scripts/backfill/ay2026-t2-filipino-secondary-backfill-apply.sql'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 4: Add the `.gitignore` entry**

Read the current `.gitignore` and find this existing block:

```
# AY2026 T2 Filipino + Global Perspectives weight correction output (real
# student PII — names, scores). Generated by
# gen-ay2026-t2-fil-gp-weight-correction.ts; review locally, never commit.
scripts/backfill/ay2026-t2-fil-gp-weight-correction-*.sql
```

Immediately after that block, insert:

```

# AY2026 T2 Filipino Secondary grading backfill output (real student PII —
# names, scores). Generated by gen-ay2026-t2-filipino-secondary-backfill.ts;
# review locally, never commit. Deliberately separate from
# ay2026-t2-secondary-grading-*.sql — Phase 6b's original artifacts stay
# untouched.
scripts/backfill/ay2026-t2-filipino-secondary-backfill-*.sql
```

- [ ] **Step 5: Verify the real parse counts without touching the database**

This step exercises only the pure, DB-free parsing half of the script to confirm the design's validated numbers before the task is considered done. Create a throwaway file `scripts/backfill/_verify-t2-fil-sec.ts`:

```typescript
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';

const result = parseGradingWorkbookSecondaryT2(
  'AY2026/T2/Term 2 Grades/GRADES/Filipino Grading AY2026 T2.xlsx',
  'FIL'
);
const total = result.sheets.reduce((a, s) => a + s.students.length, 0);
console.log('sheets:', result.sheets.length);
console.log('total students (raw):', total);
console.log('unrecognized:', result.skippedUnrecognized.length);
console.log('truncationNotes:', result.truncationNotes.length);
console.log('identityCorrections:', result.identityCorrections.length);
if (result.sheets.length !== 4) throw new Error('expected 4 sheets');
if (total !== 94) throw new Error('expected 94 raw students');
if (result.skippedUnrecognized.length !== 0)
  throw new Error('expected 0 unrecognized');
if (result.truncationNotes.length !== 0)
  throw new Error('expected 0 truncation notes');
if (result.identityCorrections.length !== 2)
  throw new Error('expected 2 identity corrections');
console.log('OK — matches design-time validated numbers');
```

Run: `npx tsx scripts/backfill/_verify-t2-fil-sec.ts`
Expected output: `sheets: 4`, `total students (raw): 94`, `unrecognized: 0`, `truncationNotes: 0`, `identityCorrections: 2`, then `OK — matches design-time validated numbers`.

Then delete the throwaway file: `rm scripts/backfill/_verify-t2-fil-sec.ts` (it is not part of this task's deliverable — it exists only to prove the numbers before committing).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — same total test count as after Task 3, zero failures (this task adds no new test file).

- [ ] **Step 8: Commit**

```bash
git add scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts .gitignore
git commit -m "fix(backfill): backfill AY2026 T2 Secondary Filipino grades (was wrongly excluded)"
```

**Do NOT run `gen-ay2026-t2-filipino-secondary-backfill.ts` (the full script, with `--env-file=.env.local`) against the live database as part of this task.** Step 5 above deliberately exercises only the DB-free parsing half via a throwaway script to validate the real numbers — the full script's roster-lookup query uses `createServiceClient()` with the production Supabase service-role key, and per this project's standing rule, invoking it is **CONTROLLER-ONLY**, performed by the human-facing controller after this task is implemented and reviewed.

---

## Post-implementation (controller-only, after all 4 tasks are reviewed)

Once every task above is implemented and reviewed, the controller (not a subagent) runs both generators against the live database and reviews the output before handing `preview.sql`/`apply.sql` to the user:

```bash
npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-secondary-grading.ts
npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
```

Confirm each run's console stats match the design doc's validated expectations (Task 1's 32-sheet/768-student parse totals should reappear unchanged; the exact `gradeEntriesWritten`/`needsReview` split depends on live roster resolution and is observed at run time, not pre-asserted). Read both `preview.sql` files, spot-check a few students against the real workbooks, then hand both `apply.sql` files to the user (Mr Ace) to review and run manually in the Supabase SQL editor — one at a time, each in its own connection/session, per Global Constraints.

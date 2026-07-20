# AY2026 T1 Primary Grading Import (Sub-Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse HFSE's real T1 Primary grading workbooks and produce a reviewable `preview.sql` / `apply.sql` pair that imports Primary grading sheets + grade entries for T1 — no code in this phase ever writes to the database directly.

**Architecture:** A near-verbatim mirror of the already-proven Phase 6a (T2 Primary) architecture: parser → pure composer → orchestrator. The parser reuses the shared `t2-masthead.ts` module unchanged (row layout confirmed byte-identical between T1 and T2's Grades folders) and the same `EXCLUDED_PRIMARY_SECTIONS` set. The composer is a near-identical duplicate of `build-primary-grading-import.ts`, differing only in title strings — the established, deliberate duplication pattern this codebase already uses twice (Primary vs Secondary T2 composers).

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, Supabase service client for the DB read, Vitest for tests.

## Global Constraints

- Never write to the database directly — every DB mutation goes through the generated, human-reviewed `apply.sql`.
- `SUBJECT_CONFIG_WEIGHTS` for this phase is an empty array — every one of the 6 subjects' T1 header weights already matches the live, corrected `subject_configs` (verified directly this session, including the Filipino weight correction already applied). The composer must correctly handle an empty array: the preview's "subject_configs corrections" section renders `(none)`, and the apply.sql's `subject_configs` block is skipped entirely (not emitted as a no-op statement).
- Identity resolution reuses `t2-masthead.ts::resolveIdentity` unchanged (tab-name-first, row-2 fallback) — no new identity logic for this phase.
- `EXCLUDED_PRIMARY_SECTIONS` (Respect, Gentleness, Compassion) is reused verbatim from `grading-workbook-t2.ts`.
- `grading_sheets` rows are locked on import: `is_locked=true, locked_at=now(), locked_by='backfill-import'`.
- Grades are computed via `lib/compute/quarterly.ts::computeQuarterly` (Hard Rule #1/#2) — never re-implemented.
- Roster resolution is `(levelCode, sectionName, indexNumber)` against live `section_students`, scoped to `academic_years.ay_code = 'AY2026'` and `levels.level_type = 'primary'`. Unresolved rows go to needs-review, never guessed.
- Real validated numbers from running the existing T2 parser against these exact T1 files this session (must match on a real run; material drift means investigate before trusting the output): 71 total sheets across 6 subjects (ENG=14, MATH=14, SCI=14, FIL=10, MANDARIN=5, MAPEH=14), 1279 total student rows (ENG=256, MATH=256, SCI=256, FIL=200, MANDARIN=56, MAPEH=255). Per-file skip counts: ENG/MATH/SCI/FIL all show `skippedSecondary=5, skippedExcludedSection=3`; MANDARIN shows `skippedSecondary=0, skippedExcludedSection=0` (Mandarin-track sections don't include Respect/Gentleness/Compassion); MAPEH shows `skippedSecondary=0, skippedExcludedSection=3`. Exactly one identity correction across all 6 files: MAPEH's `"MAPEH - P5 Perseverance"` tab (row 2 wrongly says `"Primary 5 COMMITMENT"`). Exactly 3 truncation notes (ENG, SCI, FIL each have one `"DO NOT USE ... S4 Excelle..."` tab whose truncated tab name falls back to row 2's fuller `"S4 Excellence"` text) — these are harmless for this Primary-only parser since the resolved identity is `secondary` kind either way, bucketed into `skippedSecondary`.

---

### Task 1: Parser — `grading-workbook-t1-primary.ts`

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook-t1-primary.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook-t1-primary.test.ts`

**Interfaces:**

- Consumes: `GradingStudentRow`, `ParsedSubjectSheet` from `./grading-workbook` (existing); `ROW_LEVEL_SECTION`, `ROW_TEACHER`, `ROW_LABELS`, `ROW_SUBCOLS`, `ROW_MAXSCORES`, `ROW_STUDENTS_START`, `cell`, `numOrNull`, `findColumnLayout`, `weightAt`, `findPrintedGradeColsT2`, `resolveIdentity`, `parseTeacherName`, `dedupeByIdentityPreferringScored`, `type IdentityT2` from `./t2-masthead` (existing, unmodified).
- Produces:

  ```typescript
  export interface ParseGradingWorkbookT1PrimaryResult {
    sheets: ParsedSubjectSheet[];
    skippedSecondary: string[];
    skippedUnrecognized: string[];
    skippedExcludedSection: string[];
    identityCorrections: string[];
    truncationNotes: string[];
    duplicateIdentityNotes: string[];
  }
  export function parseGradingWorkbookT1Primary(
    filePath: string,
    subjectCode: string
  ): ParseGradingWorkbookT1PrimaryResult;
  ```

  Task 2's composer consumes `ParsedSubjectSheet[]` (from `./grading-workbook`, unchanged) and Task 3's orchestrator consumes `parseGradingWorkbookT1Primary` and `ParseGradingWorkbookT1PrimaryResult` by these exact names.

- [ ] **Step 1: Write the failing test file**

```typescript
// __tests__/sis/backfill/grading/grading-workbook-t1-primary.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT1Primary } from '@/lib/sis/backfill/grading/grading-workbook-t1-primary';

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

// Real row shape from T1's "Math - P1 Patience" tab, transcribed verbatim.
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
    'PT4',
    'PT5',
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
    10,
    10,
    '',
    20,
    '100%',
    '40%',
    10,
    10,
    10,
    '',
    '',
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
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
    6,
    10,
    10,
    '',
    '',
    26,
    '86.67',
    '34.67',
    22,
    '73.33',
    '14.67',
    89.33,
    93,
  ],
];

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab —
// a Secondary Regular-track section riding along in the same T1 workbook.
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

describe('parseGradingWorkbookT1Primary', () => {
  it('parses a real Primary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT1Primary(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('P1');
    expect(sheet.sectionName).toBe('Patience');
    expect(sheet.teacherName).toBe('Mr. Wai Chung');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);

    const alvarez = sheet.students[0];
    expect(alvarez.indexNo).toBe('1');
    expect(alvarez.fullName).toBe('ALVAREZ, Jaime III D.');
    expect(alvarez.printedInitialGrade).toBeCloseTo(89.33);
    expect(alvarez.printedQuarterlyGrade).toBe(93);
    expect(result.identityCorrections).toEqual([]);
  });

  it('recognizes a Secondary tab and reports it as skipped, never processing it as Primary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT1Primary(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedSecondary).toEqual([
      'Literature - Sec 1 Discipline 2',
    ]);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('falls back to row 2 to correctly identify a Reserved-tab section, then excludes it — Respect/Gentleness/Compassion stay out of scope (same decision as T2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'reserved-respect.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 RESPECT - MATH'];
    writeWorkbook(path, { 'Reserved 1': rows });

    const result = parseGradingWorkbookT1Primary(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedExcludedSection).toEqual(['Reserved 1']);
    expect(result.identityCorrections).toEqual([]);
  });

  it('uses the TAB NAME over a wrong row-2 label, and records the mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'eng.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 5 COMMITMENT - ENGLISH'];
    writeWorkbook(path, { 'English - P5 Perseverance': rows });

    const result = parseGradingWorkbookT1Primary(path, 'ENG');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('P5');
    expect(result.sheets[0].sectionName).toBe('Perseverance');
    expect(result.identityCorrections).toHaveLength(1);
    expect(result.identityCorrections[0]).toContain(
      'English - P5 Perseverance'
    );
  });
});

describe('parseGradingWorkbookT1Primary (real fixture files — full 6-subject sweep)', () => {
  const DIR = 'AY2026/T1/Term 1 Grades/Grades';
  const FILES: { file: string; code: string }[] = [
    { file: 'English Grading AY2026 T1.xlsx', code: 'ENG' },
    { file: 'Math Grading AY2026 T1.xlsx', code: 'MATH' },
    { file: 'Science Grading AY2026 T1.xlsx', code: 'SCI' },
    { file: 'Filipino Grading AY2026 T1.xlsx', code: 'FIL' },
    { file: 'Mandarin Grading AY2026 T1.xlsx', code: 'MANDARIN' },
    { file: 'STAR MAPEH (PrI) Grading AY2026 T1.xlsx', code: 'MAPEH' },
  ];

  it('parses all 6 real files into exactly 71 sheets / 1279 students total, with the exact per-subject counts confirmed during design', () => {
    let totalSheets = 0;
    let totalStudents = 0;
    let totalIdentityCorrections = 0;
    let totalTruncationNotes = 0;
    for (const f of FILES) {
      const result = parseGradingWorkbookT1Primary(`${DIR}/${f.file}`, f.code);
      totalSheets += result.sheets.length;
      totalStudents += result.sheets.reduce(
        (sum, s) => sum + s.students.length,
        0
      );
      totalIdentityCorrections += result.identityCorrections.length;
      totalTruncationNotes += result.truncationNotes.length;
    }
    expect(totalSheets).toBe(71);
    expect(totalStudents).toBe(1279);
    expect(totalIdentityCorrections).toBe(1);
    expect(totalTruncationNotes).toBe(3);
  });

  it('excludes Respect/Gentleness/Compassion consistently across every file that has them', () => {
    for (const f of FILES) {
      const result = parseGradingWorkbookT1Primary(`${DIR}/${f.file}`, f.code);
      if (f.code === 'MANDARIN') {
        expect(result.skippedExcludedSection).toHaveLength(0);
      } else {
        expect(result.skippedExcludedSection).toHaveLength(3);
      }
    }
  });

  it('records exactly the one known MAPEH identity correction by name', () => {
    const result = parseGradingWorkbookT1Primary(
      `${DIR}/STAR MAPEH (PrI) Grading AY2026 T1.xlsx`,
      'MAPEH'
    );
    expect(result.identityCorrections).toHaveLength(1);
    expect(result.identityCorrections[0]).toContain('MAPEH - P5 Perseverance');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t1-primary.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook-t1-primary'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/grading/grading-workbook-t1-primary.ts
// Parses HFSE's real T1 "GRADES" folder (AY2026/T1/Term 1 Grades/Grades/)
// subject workbooks into one ParsedSubjectSheet per real PRIMARY section
// tab. Secondary tabs riding along in the same files are recognized and
// skipped — a later, separate sub-phase covers T1 Secondary Regular-track.
//
// Near-verbatim mirror of grading-workbook-t2.ts (Phase 6a) — the masthead
// layout, EXCLUDED_PRIMARY_SECTIONS set, and identity-resolution logic
// were verified byte-identical to T2's Primary GRADES folder during
// design (docs/superpowers/specs/2026-07-20-ay2026-t1-primary-grading-import-design.md).
// Reuses ./t2-masthead unchanged — the row layout matched exactly, no new
// identity logic needed.
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
  dedupeByIdentityPreferringScored,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookT1PrimaryResult {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  skippedExcludedSection: string[];
  identityCorrections: string[];
  truncationNotes: string[];
  duplicateIdentityNotes: string[];
}

// Same 3 sections excluded from T2's Primary import, for the same reason —
// hidden in HFSE's own Consolidated Form, confirmed present in T1's files
// as the same never-renamed "Reserved N" tabs (2026-07-20 decision,
// reused verbatim from grading-workbook-t2.ts).
const EXCLUDED_PRIMARY_SECTIONS = new Set([
  'Respect',
  'Gentleness',
  'Compassion',
]);

function parseOneSheetT1Primary(
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
  if (identity.kind !== 'primary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  // numOrNull (not a bare !== '' check) — see grading-workbook-t2.ts's
  // identical fix for the real "-" max-score cell bug.
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

export function parseGradingWorkbookT1Primary(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT1PrimaryResult {
  const wb = XLSX.readFile(filePath);
  const candidates: { sheetName: string; sheet: ParsedSubjectSheet }[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const skippedExcludedSection: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetT1Primary(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (
      identity.kind === 'primary' &&
      sheet &&
      EXCLUDED_PRIMARY_SECTIONS.has(identity.sectionName)
    ) {
      skippedExcludedSection.push(sheetName);
    } else if (identity.kind === 'primary' && sheet) {
      candidates.push({ sheetName, sheet });
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  const { kept, duplicateNotes } = dedupeByIdentityPreferringScored(candidates);

  return {
    sheets: kept,
    skippedSecondary,
    skippedUnrecognized,
    skippedExcludedSection,
    identityCorrections,
    truncationNotes,
    duplicateIdentityNotes: duplicateNotes,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t1-primary.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-t1-primary.ts __tests__/sis/backfill/grading/grading-workbook-t1-primary.test.ts
git commit -m "feat(backfill): parse AY2026 T1 Primary grading workbooks"
```

---

### Task 2: Composer — `build-t1-primary-grading-import.ts`

**Files:**

- Create: `lib/sis/backfill/grading/build-t1-primary-grading-import.ts`
- Test: `__tests__/sis/backfill/grading/build-t1-primary-grading-import.test.ts`

**Interfaces:**

- Consumes: `GradingStudentRow`, `ParsedSubjectSheet` from `./grading-workbook` (existing, unchanged); `sqlString` from `../enrollment/sql-escape` (existing); `computeQuarterly` from `@/lib/compute/quarterly` (existing).
- Produces:

  ```typescript
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
  export interface BuildT1PrimaryGradingImportInput {
    sheets: ParsedSubjectSheet[];
    rosterLookup: RosterLookupEntry[];
    subjectConfigWeights: SubjectConfigWeight[];
    ayCode: string;
    termNumber: number;
  }
  export interface BuildT1PrimaryGradingImportResult {
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
  export function buildT1PrimaryGradingImport(
    input: BuildT1PrimaryGradingImportInput
  ): BuildT1PrimaryGradingImportResult;
  ```

  Task 3's orchestrator consumes `buildT1PrimaryGradingImport`, `RosterLookupEntry`, `SubjectConfigWeight` by these exact names.

- [ ] **Step 1: Write the failing test file**

```typescript
// __tests__/sis/backfill/grading/build-t1-primary-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildT1PrimaryGradingImport } from '@/lib/sis/backfill/grading/build-t1-primary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-t1-primary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

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
    ptScores: [6, 10, 10],
    examScore: 22,
    printedInitialGrade: 89.33,
    printedQuarterlyGrade: 93,
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

describe('buildT1PrimaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildT1PrimaryGradingImport({
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
  });

  it('renders "(none)" and emits no subject_configs block at all when subjectConfigWeights is empty — the real behavior this phase needs (T1 needs zero corrections, unlike T2 Phase 6a)', () => {
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
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
      mathSheet(),
      mathSheet({
        subjectCode: 'FIL',
        wwWeight: 0.3,
        ptWeight: 0.5,
        qaWeight: 0.2,
      }),
    ];
    const weights: SubjectConfigWeight[] = [
      { subjectCode: 'FIL', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 },
    ];
    const result = buildT1PrimaryGradingImport({
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
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = mathSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildT1PrimaryGradingImport({
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
      students: [student({ printedQuarterlyGrade: 999 })],
    });
    const result = buildT1PrimaryGradingImport({
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
    const result = buildT1PrimaryGradingImport({
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/grading/build-t1-primary-grading-import.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/build-t1-primary-grading-import'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/grading/build-t1-primary-grading-import.ts
// Composes parsed T1 Primary grading data (grading-workbook-t1-primary.ts)
// into the two SQL artifacts described by the design doc: a read-only
// preview report and a transactional, idempotent apply script. No I/O.
//
// Near-verbatim mirror of build-primary-grading-import.ts (Phase 6a) —
// deliberate duplication, only title strings differ, matching the same
// "accepted duplication" convention already used between the T2 Primary
// and Secondary composers. The one real behavioral point this phase
// exercises that Phase 6a's own tests never isolated: an EMPTY
// subjectConfigWeights array must skip the whole subject_configs block
// entirely, not just no-op it.
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

export interface BuildT1PrimaryGradingImportInput {
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

export interface BuildT1PrimaryGradingImportResult {
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

export function buildT1PrimaryGradingImport(
  input: BuildT1PrimaryGradingImportInput
): BuildT1PrimaryGradingImportResult {
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

  const stats: BuildT1PrimaryGradingImportResult['stats'] = {
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
  stats: BuildT1PrimaryGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T1 Primary grading sheets import — PREVIEW (read-only)'
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-primary-grading.ts from the 6 real T1 "Grades" subject workbooks.'
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
    '-- AY2026 T1 Primary grading sheets import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t1-primary-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t1-primary-grading.ts — do not hand-edit; regenerate instead.'
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

  // --- 1) subject_configs corrections (empty for this phase — Locked
  //     Decision #3, but the composer must handle a non-empty list too,
  //     for the shared shape with every sibling composer) ---
  if (subjectConfigWeights.length > 0) {
    lines.push('drop table if exists _ay26t1pgrd_subject_configs;');
    lines.push(
      'create temp table _ay26t1pgrd_subject_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
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
    lines.push('from _ay26t1pgrd_subject_configs c');
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
  lines.push('drop table if exists _ay26t1pgrd_sheets;');
  lines.push(
    'create temp table _ay26t1pgrd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
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
  lines.push('from _ay26t1pgrd_sheets s');
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
  lines.push('drop table if exists _ay26t1pgrd_entries;');
  lines.push(
    'create temp table _ay26t1pgrd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
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
  lines.push('from _ay26t1pgrd_entries e');
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/grading/build-t1-primary-grading-import.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/build-t1-primary-grading-import.ts __tests__/sis/backfill/grading/build-t1-primary-grading-import.test.ts
git commit -m "feat(backfill): compose AY2026 T1 Primary grading import SQL"
```

---

### Task 3: Orchestrator + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t1-primary-grading.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseGradingWorkbookT1Primary` (Task 1), `buildT1PrimaryGradingImport`, `RosterLookupEntry`, `SubjectConfigWeight` (Task 2).

- [ ] **Step 1: Write the orchestrator script**

```typescript
// scripts/backfill/gen-ay2026-t1-primary-grading.ts
// Generates ay2026-t1-primary-grading-{preview,apply}.sql from HFSE's real
// T1 "Grades" folder subject workbooks (Primary tabs only — Secondary
// Regular-track tabs riding along in the same files are recognized and
// skipped, deferred to a later sub-phase). Emits SQL for review — does NOT
// write to the database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t1-primary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-primary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookT1Primary } from '../../lib/sis/backfill/grading/grading-workbook-t1-primary';
import { buildT1PrimaryGradingImport } from '../../lib/sis/backfill/grading/build-t1-primary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-t1-primary-grading-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const DIR = 'AY2026/T1/Term 1 Grades/Grades';

// Explicit file list — never a directory glob. This folder also has
// Secondary-only subject files (History, Literature, SS & Geo,
// Contemporary Arts, PE (Sec)) that don't apply to Primary at all — not
// listed here, out of scope for this Primary-only phase.
const SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'English Grading AY2026 T1.xlsx', subjectCode: 'ENG' },
  { file: 'Math Grading AY2026 T1.xlsx', subjectCode: 'MATH' },
  { file: 'Science Grading AY2026 T1.xlsx', subjectCode: 'SCI' },
  { file: 'Filipino Grading AY2026 T1.xlsx', subjectCode: 'FIL' },
  { file: 'Mandarin Grading AY2026 T1.xlsx', subjectCode: 'MANDARIN' },
  {
    file: 'STAR MAPEH (PrI) Grading AY2026 T1.xlsx',
    subjectCode: 'MAPEH',
  },
];

// Locked Decision #3 (design doc): every one of the 6 subjects' T1 header
// weights already matches the live, corrected subject_configs — verified
// directly this session. Empty on purpose — NOT derived at generation
// time, and NOT simply omitted from the composer call (the composer must
// correctly handle this empty-but-real input, per Task 2).
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

  // 1. Parse every real workbook; collect Primary sheets + skip counts.
  let sheets: ReturnType<typeof parseGradingWorkbookT1Primary>['sheets'] = [];
  let skippedSecondaryTotal = 0;
  let skippedExcludedSectionTotal = 0;
  let skippedUnrecognizedTotal = 0;
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];
  for (const { file, subjectCode } of SUBJECT_FILES) {
    const result = parseGradingWorkbookT1Primary(join(DIR, file), subjectCode);
    sheets = sheets.concat(result.sheets);
    skippedSecondaryTotal += result.skippedSecondary.length;
    skippedExcludedSectionTotal += result.skippedExcludedSection.length;
    skippedUnrecognizedTotal += result.skippedUnrecognized.length;
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `${file}: ${result.sheets.length} Primary sheet(s), skipped ${result.skippedSecondary.length} Secondary + ${result.skippedExcludedSection.length} excluded-section + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} identity correction(s), ${result.truncationNotes.length} truncation note(s)`
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
  const result = buildT1PrimaryGradingImport({
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
    'scripts/backfill/ay2026-t1-primary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-primary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Skipped across all files: ${skippedSecondaryTotal} Secondary tabs (deferred to a later sub-phase), ${skippedExcludedSectionTotal} excluded-section tabs (Respect/Gentleness/Compassion), ${skippedUnrecognizedTotal} unrecognized tabs`
  );
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t1-primary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-primary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the `.gitignore` entry**

Find this block in `.gitignore` (the T1 grading entry, currently around line 95-98):

```
# AY2026 grading import output (real student PII — names, scores).
# Generated by gen-ay2026-t1-grading.ts; review locally, never commit.
scripts/backfill/ay2026-t1-grading-*.sql
```

Add immediately after it:

```
# AY2026 T1 Primary grading import output (real student PII — names,
# scores). Generated by gen-ay2026-t1-primary-grading.ts; review locally,
# never commit.
scripts/backfill/ay2026-t1-primary-grading-*.sql
```

- [ ] **Step 3: Run the full test suite regression**

Run: `npx vitest run`
Expected: PASS — every existing test still passes, plus the 7 + 6 new tests from Tasks 1–2.

- [ ] **Step 4: Run the generator against the real file and verify the console output**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-primary-grading.ts`
Expected: exits 0; console shows `71` total Primary sheets across the 6 files (matching the per-file counts in Global Constraints: ENG=14, MATH=14, SCI=14, FIL=10, MANDARIN=5, MAPEH=14), `1279` total students resolved+needs-review combined, `1` identity correction (MAPEH P5 Perseverance), `3` truncation notes; `scripts/backfill/ay2026-t1-primary-grading-preview.sql` and `-apply.sql` are written (gitignored, confirmed via `git status --short scripts/backfill/` showing nothing new tracked).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill/gen-ay2026-t1-primary-grading.ts .gitignore
git commit -m "feat(backfill): add AY2026 T1 Primary grading import orchestrator"
```

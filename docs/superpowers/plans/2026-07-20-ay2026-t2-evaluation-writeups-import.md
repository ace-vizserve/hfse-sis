# AY2026 T2 Evaluation Write-ups Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable `preview.sql` / `apply.sql` pair that imports HFSE's real AY2026 T2 form-class-adviser write-ups from `AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx` into `evaluation_writeups`, without ever writing to the database directly from this codebase.

**Architecture:** Simpler than every prior grading-import phase — one source file with 23 clean sheets (one per real section, no Reserved/DO-NOT-USE/corrupted-duplicate noise), so no dedup logic is needed anywhere. A parser (`parse-consolidated-writeups.ts`) reads the single workbook and resolves each sheet's identity directly from its (already-clean) sheet name, extracting column 15's ("Student Evaluation") text per student row. A pure composer (`build-writeups-import.ts`) resolves each row against the live, active (non-withdrawn) roster and emits the two SQL artifacts. One orchestrator (`gen-ay2026-t2-writeups.ts`) wires it together, including a defensive "no two sheets claim the same section" assertion the multi-round grading-import Reserved-tab bug earned for free.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-20-ay2026-t2-evaluation-writeups-import-design.md` — read it before starting; every task below implements a piece of it.
- **Source file**: `AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx` — 23 sheets, every one a clean real-section name (no glob, explicit iteration over `wb.SheetNames`).
- **Column 15 ("Student Evaluation") is the only content column this phase reads.** Columns 2–9 (subject grades) and 10–12 (attendance) are out of scope (covered by earlier phases). Columns 13–14 ("Remarks"/"Notes/Comment") are an unrelated attendance-verification workflow — never read.
- **Sheet identity resolves directly from the sheet name** via `/^([PS])(\d+)\s*-?\s*(.+?)(?:\s*\(G\))?$/i` — the `(G)` Global-track marker is stripped (not part of the real `sections.name`). No row-2/tab-name fallback logic is needed — this file has no truncation or mislabeling failure mode.
- **Student rows start at 0-indexed row 8** (`index_number` at column 0, `NAME` at column 1, write-up text at column 15). A row is a real student row iff column 0 matches `/^\d+$/` and column 1 is non-empty.
- **Blank write-up cells are skipped, not errors** — no row is emitted for a student whose column-15 cell is empty. This is indistinguishable from "adviser hasn't written one yet," a valid existing state.
- **Roster resolution MUST exclude withdrawn students** — `section_students.enrollment_status != 'withdrawn'` — per KD #120 (write-ups must resolve to a student's current active section, never a stale one).
- **Field mapping** (exact, from design doc §5): `term_id` = AY2026's T2 term; `student_id`/`section_id` = from the roster row (not re-derived from the sheet); `writeup` = the trimmed cell text; `submitted` = `true`; `submitted_at` = the term's `end_date` (`2026-05-28`); `created_by` = `NULL`.
- **SQL escaping** goes through the existing `lib/sis/backfill/enrollment/sql-escape.ts::sqlString` helper — never a new escaping scheme.
- `evaluation_writeups` write uses `on conflict (term_id, student_id) do nothing` — the standing safe default (Hard Rule #6, append-only).
- Single, un-chunked `apply.sql` — this phase's volume (≈390 rows) is well under any chunking threshold.
- No code in this plan ever writes to the database. The orchestrator only reads (for roster/term lookups) and writes local `.sql` files.
- Output files (`scripts/backfill/ay2026-t2-writeups-{preview,apply}.sql`) contain real student names and free-text content (PII) — must be gitignored.

---

### Task 1: Parser — `parse-consolidated-writeups.ts`

**Files:**

- Create: `lib/sis/backfill/evaluation/parse-consolidated-writeups.ts`
- Test: `__tests__/sis/backfill/evaluation/parse-consolidated-writeups.test.ts`

**Interfaces:**

- Produces (consumed by Task 3's orchestrator):

  ```ts
  export interface IdentityResult {
    levelCode: string;
    sectionName: string;
  }
  export function parseSheetIdentity(sheetName: string): IdentityResult | null;

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
  export function parseConsolidatedWriteups(
    filePath: string
  ): ParseConsolidatedWriteupsResult;
  ```

- [ ] **Step 1: Write the failing tests for `parseSheetIdentity`**

Create `__tests__/sis/backfill/evaluation/parse-consolidated-writeups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseSheetIdentity,
  parseConsolidatedWriteups,
} from '@/lib/sis/backfill/evaluation/parse-consolidated-writeups';

const REAL_FILE = 'AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx';

describe('parseSheetIdentity', () => {
  it('parses a plain Primary sheet name', () => {
    expect(parseSheetIdentity('P1-Patience')).toEqual({
      levelCode: 'P1',
      sectionName: 'Patience',
    });
  });

  it('parses a Primary sheet name with a space separator instead of a hyphen', () => {
    expect(parseSheetIdentity('P6 Grit')).toEqual({
      levelCode: 'P6',
      sectionName: 'Grit',
    });
  });

  it('parses a Secondary Regular-track sheet name', () => {
    expect(parseSheetIdentity('S1-Discipline 2')).toEqual({
      levelCode: 'S1',
      sectionName: 'Discipline 2',
    });
  });

  it('parses a Secondary Global-track sheet name and strips the (G) marker', () => {
    expect(parseSheetIdentity('S1-Discipline 1 (G)')).toEqual({
      levelCode: 'S1',
      sectionName: 'Discipline 1',
    });
  });

  it('parses a hyphen-with-spaces separator', () => {
    expect(parseSheetIdentity('S4 - Excellence')).toEqual({
      levelCode: 'S4',
      sectionName: 'Excellence',
    });
  });

  it('returns null for a name that does not match the pattern', () => {
    expect(parseSheetIdentity('Cover Page')).toBeNull();
  });
});

describe('parseConsolidatedWriteups (real fixture file)', () => {
  it('parses the real consolidated form into exactly 390 non-blank write-up rows across 23 recognized sheets, 0 unrecognized', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    expect(result.rows.length).toBe(390);
    expect(result.blankCounts.length).toBe(23);
    expect(result.unrecognizedSheets).toEqual([]);
  });

  it('reports the exact blank-cell count for the three ex-Reserved Primary sections', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    const find = (levelCode: string, sectionName: string) =>
      result.blankCounts.find(
        (b) => b.levelCode === levelCode && b.sectionName === sectionName
      );
    expect(find('P1', 'Respect')?.blankCount).toBe(12);
    expect(find('P2', 'Gentleness')?.blankCount).toBe(10);
    expect(find('P4', 'Compassion')?.blankCount).toBe(21);
  });

  it('extracts a real, known write-up verbatim', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'S1' &&
        r.sectionName === 'Discipline 1' &&
        r.indexNo === '1'
    );
    expect(row?.fullName).toBe('BANTA, Stephanie Louise S.');
    expect(row?.writeup).toBe(
      'Stephanie shows consideration for others and is respectful in daily interactions. She approaches learning tasks with commitment and can be trusted to follow instructions carefully.'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/evaluation/parse-consolidated-writeups.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/sis/backfill/evaluation/parse-consolidated-writeups.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/evaluation/parse-consolidated-writeups.test.ts`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/evaluation/parse-consolidated-writeups.ts __tests__/sis/backfill/evaluation/parse-consolidated-writeups.test.ts
git commit -m "feat(backfill): parse the AY2026 T2 evaluation write-ups consolidated form"
```

---

### Task 2: Composer — `build-writeups-import.ts`

**Files:**

- Create: `lib/sis/backfill/evaluation/build-writeups-import.ts`
- Test: `__tests__/sis/backfill/evaluation/build-writeups-import.test.ts`

**Interfaces:**

- Consumes: `ParsedWriteupRow` (Task 1's `lib/sis/backfill/evaluation/parse-consolidated-writeups.ts`).
- Produces (consumed by Task 3's orchestrator):

  ```ts
  export interface RosterLookupEntry {
    levelCode: string;
    sectionName: string;
    indexNumber: number;
    studentId: string;
    sectionId: string;
  }
  export interface BuildWriteupsImportInput {
    rows: ParsedWriteupRow[];
    rosterLookup: RosterLookupEntry[];
    termId: string;
    submittedAt: string;
  }
  export interface BuildWriteupsImportResult {
    preview: string;
    apply: string;
    stats: { writeupsWritten: number; needsReview: number };
  }
  export function buildWriteupsImport(
    input: BuildWriteupsImportInput
  ): BuildWriteupsImportResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/evaluation/build-writeups-import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildWriteupsImport } from '@/lib/sis/backfill/evaluation/build-writeups-import';
import type { ParsedWriteupRow } from '@/lib/sis/backfill/evaluation/parse-consolidated-writeups';
import type { RosterLookupEntry } from '@/lib/sis/backfill/evaluation/build-writeups-import';

const TERM_ID = '11111111-1111-1111-1111-111111111111';
const SUBMITTED_AT = '2026-05-28';

function row(overrides: Partial<ParsedWriteupRow> = {}): ParsedWriteupRow {
  return {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNo: '1',
    fullName: 'BANTA, Stephanie Louise S.',
    writeup: 'A real write-up paragraph.',
    ...overrides,
  };
}

function rosterEntry(
  overrides: Partial<RosterLookupEntry> = {}
): RosterLookupEntry {
  return {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 1,
    studentId: '22222222-2222-2222-2222-222222222222',
    sectionId: '33333333-3333-3333-3333-333333333333',
    ...overrides,
  };
}

describe('buildWriteupsImport', () => {
  it('resolves a matching row and writes it', () => {
    const result = buildWriteupsImport({
      rows: [row()],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 1, needsReview: 0 });
    expect(result.apply).toContain(
      'insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)'
    );
    expect(result.apply).toContain('true');
    expect(result.apply).toContain("'2026-05-28'");
    expect(result.apply).toContain(
      'on conflict (term_id, student_id) do nothing'
    );
  });

  it('flags an unresolvable row as needs-review instead of writing it', () => {
    const result = buildWriteupsImport({
      rows: [row({ indexNo: '99' })],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 1 });
    expect(result.preview).toContain('index 99');
    expect(result.preview).toContain('no matching active section_students row');
  });

  it('never emits created_by — the column is always left NULL by omission', () => {
    const result = buildWriteupsImport({
      rows: [row()],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).not.toContain('created_by');
  });

  it('escapes a single quote in the write-up text', () => {
    const result = buildWriteupsImport({
      rows: [row({ writeup: "Student's progress is strong." })],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).toContain("Student''s progress is strong.");
  });

  it('handles an empty rows array without throwing', () => {
    const result = buildWriteupsImport({
      rows: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 0 });
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/evaluation/build-writeups-import.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/sis/backfill/evaluation/build-writeups-import.ts`:

```ts
// lib/sis/backfill/evaluation/build-writeups-import.ts
// Composes parsed T2 evaluation write-up rows into the two SQL artifacts
// described by the design doc: a read-only preview report and a
// transactional, idempotent apply script. No I/O. See:
// docs/superpowers/specs/2026-07-20-ay2026-t2-evaluation-writeups-import-design.md
import { sqlString } from '../enrollment/sql-escape';
import type { ParsedWriteupRow } from './parse-consolidated-writeups';

export interface RosterLookupEntry {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  studentId: string;
  sectionId: string;
}

export interface BuildWriteupsImportInput {
  rows: ParsedWriteupRow[];
  rosterLookup: RosterLookupEntry[];
  termId: string;
  submittedAt: string;
}

interface ResolvedWriteup {
  studentId: string;
  sectionId: string;
  writeup: string;
}

interface NeedsReviewRow {
  levelCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

export interface BuildWriteupsImportResult {
  preview: string;
  apply: string;
  stats: {
    writeupsWritten: number;
    needsReview: number;
  };
}

export function buildWriteupsImport(
  input: BuildWriteupsImportInput
): BuildWriteupsImportResult {
  const { rows, rosterLookup, termId, submittedAt } = input;

  const rosterMap = new Map<string, RosterLookupEntry>();
  for (const r of rosterLookup) {
    rosterMap.set(`${r.levelCode}::${r.sectionName}::${r.indexNumber}`, r);
  }

  const resolved: ResolvedWriteup[] = [];
  const needsReview: NeedsReviewRow[] = [];

  for (const row of rows) {
    const key = `${row.levelCode}::${row.sectionName}::${Number.parseInt(row.indexNo, 10)}`;
    const entry = rosterMap.get(key);
    if (!entry) {
      needsReview.push({
        levelCode: row.levelCode,
        sectionName: row.sectionName,
        indexNo: row.indexNo,
        fullName: row.fullName,
        reason: `no matching active section_students row for index ${row.indexNo}`,
      });
      continue;
    }
    resolved.push({
      studentId: entry.studentId,
      sectionId: entry.sectionId,
      writeup: row.writeup,
    });
  }

  const stats: BuildWriteupsImportResult['stats'] = {
    writeupsWritten: resolved.length,
    needsReview: needsReview.length,
  };

  return {
    preview: buildPreviewSql(needsReview, stats),
    apply: buildApplySql(termId, submittedAt, resolved),
    stats,
  };
}

function buildPreviewSql(
  needsReview: NeedsReviewRow[],
  stats: BuildWriteupsImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push('-- AY2026 T2 evaluation write-ups import — PREVIEW (read-only)');
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t2-writeups.ts from the Term 2 Consolidated Form.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- writeups=${stats.writeupsWritten}`);
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.levelCode} ${r.sectionName}] index ${r.indexNo} "${r.fullName}" — ${r.reason}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  termId: string,
  submittedAt: string,
  resolved: ResolvedWriteup[]
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T2 evaluation write-ups import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t2-writeups-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t2-writeups.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  lines.push('drop table if exists _ay26writeup_rows;');
  lines.push(
    'create temp table _ay26writeup_rows (student_id, section_id, writeup) as'
  );
  lines.push('values');
  const valueRows = resolved.map(
    (r) =>
      `  (${sqlString(r.studentId)}::uuid, ${sqlString(r.sectionId)}::uuid, ${sqlString(r.writeup)})`
  );
  lines.push(
    (valueRows.length
      ? valueRows.join(',\n')
      : "  ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, '__NONE__')") +
      ';'
  );
  lines.push('');
  lines.push(
    'insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)'
  );
  lines.push(
    `select ${sqlString(termId)}::uuid, r.student_id, r.section_id, r.writeup, true, ${sqlString(submittedAt)}::timestamptz`
  );
  lines.push('from _ay26writeup_rows r');
  lines.push("where r.writeup <> '__NONE__'");
  lines.push('on conflict (term_id, student_id) do nothing;');
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select count(*) as evaluation_writeups_rows from evaluation_writeups where term_id = ${sqlString(termId)}::uuid;`
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/evaluation/build-writeups-import.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/evaluation/build-writeups-import.ts __tests__/sis/backfill/evaluation/build-writeups-import.test.ts
git commit -m "feat(backfill): compose AY2026 T2 evaluation write-ups import SQL"
```

---

### Task 3: Orchestrator script + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t2-writeups.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseConsolidatedWriteups` (Task 1), `buildWriteupsImport` + `RosterLookupEntry` (Task 2), `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks. Writes `scripts/backfill/ay2026-t2-writeups-preview.sql` and `scripts/backfill/ay2026-t2-writeups-apply.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t2-writeups.ts`:

```ts
// scripts/backfill/gen-ay2026-t2-writeups.ts
// Generates ay2026-t2-writeups-{preview,apply}.sql from HFSE's real T2
// Consolidated Form. Emits SQL for review — does NOT write to the
// database itself. See:
// docs/superpowers/specs/2026-07-20-ay2026-t2-evaluation-writeups-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-writeups.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseConsolidatedWriteups } from '../../lib/sis/backfill/evaluation/parse-consolidated-writeups';
import { buildWriteupsImport } from '../../lib/sis/backfill/evaluation/build-writeups-import';
import type { RosterLookupEntry } from '../../lib/sis/backfill/evaluation/build-writeups-import';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;
const SOURCE_FILE = 'AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx';

async function main() {
  const svc = createServiceClient();

  const parsed = parseConsolidatedWriteups(SOURCE_FILE);
  console.log(
    `Parsed: ${parsed.rows.length} write-up row(s) across ${parsed.blankCounts.length} recognized sheet(s), ${parsed.unrecognizedSheets.length} unrecognized sheet(s)`
  );
  for (const b of parsed.blankCounts) {
    console.log(
      `  ${b.levelCode} ${b.sectionName}: ${b.blankCount} blank cell(s)`
    );
  }
  if (parsed.unrecognizedSheets.length > 0) {
    console.log('  Unrecognized sheets:', parsed.unrecognizedSheets.join(', '));
  }

  // Defensive check (design doc §9): every sheet must resolve to a
  // DISTINCT identity — no two sheets in this file should ever claim the
  // same section. This file has no known collision risk (unlike the
  // grading workbooks' multi-file Reserved-tab bug), but the assertion is
  // free insurance earned by that bug's three fix rounds.
  const seen = new Set<string>();
  for (const b of parsed.blankCounts) {
    const key = `${b.levelCode}::${b.sectionName}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate section identity "${key}" across sheets — investigate before proceeding.`
      );
    }
    seen.add(key);
  }
  console.log(`Distinct section identities: ${seen.size}`);

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: termErr } = await svc
    .from('terms')
    .select('id, end_date')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (termErr) throw termErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'student_id, section_id, index_number, sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .neq('enrollment_status', 'withdrawn');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    studentId: r.student_id,
    sectionId: r.section_id,
  }));

  const result = buildWriteupsImport({
    rows: parsed.rows,
    rosterLookup,
    termId: (term as any).id,
    submittedAt: (term as any).end_date,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t2-writeups-preview.sql',
    result.preview
  );
  writeFileSync('scripts/backfill/ay2026-t2-writeups-apply.sql', result.apply);

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t2-writeups-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-writeups-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the gitignore entry**

Modify `.gitignore` — add after the existing `scripts/backfill/ay2026-t2-science-discipline1-correction-*.sql` line:

```

# AY2026 T2 evaluation write-ups import output (real student PII — names,
# free-text write-up content). Generated by gen-ay2026-t2-writeups.ts;
# review locally, never commit.
scripts/backfill/ay2026-t2-writeups-*.sql
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every prior phase's test plus the 14 new tests from Tasks 1–2 (9 + 5), all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t2-writeups.ts .gitignore
git commit -m "feat(backfill): add AY2026 T2 evaluation write-ups import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-writeups.ts`
Expected: prints per-sheet blank counts for all 23 sheets, `Distinct section identities: 23`, then a `Stats:` block with `writeupsWritten` at or near 390 (may differ slightly from the design doc's hand-counted figure if a handful of students have since transferred/withdrawn — any gap must show up as a matching `needsReview` count, not silently vanish) and `needsReview` near 0. Read `scripts/backfill/ay2026-t2-writeups-preview.sql` in full and hand-verify: (1) any needs-review entries correspond to genuinely withdrawn/transferred students, not a roster-query bug; (2) the writeups count is in the expected range; (3) spot-check `ay2026-t2-writeups-apply.sql` for a couple of real write-up paragraphs — they should read as intact, unmangled text with correctly-escaped apostrophes.

---

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 (source data + column identification) → Task 1's parser + its real-fixture tests. §3 (identity resolution) → Task 1's `parseSheetIdentity` + its 6 dedicated tests covering every real naming variant found (hyphen, space, Global-track `(G)` marker, unrecognized). §4 (roster resolution excluding withdrawn) → Task 3's orchestrator query (`neq('enrollment_status', 'withdrawn')`) — this lives in the orchestrator, not the composer, matching every prior phase's pattern where the composer stays pure/DB-agnostic and the orchestrator owns the actual query. §5 (field mapping) → Task 2's `buildApplySql`, verified by the composer's own tests (submitted=true literal, submitted_at from input, created_by never emitted = NULL by column omission). §6 (SQL emission, on-conflict-do-nothing, sqlString reuse) → Task 2. §7 (three-file architecture) → Tasks 1–3 map directly. §8 (testing) → both lib tasks have real-fixture + synthetic tests respectively; no orchestrator test file, consistent with every prior phase. §9 (validation plan, distinct-identity assertion) → Task 3 Step 1's `seen` Set check + Step 5's controller checklist.
- **Placeholder scan:** none found — every step has complete, runnable code with real hand-verified numbers (390 total rows, exact per-sheet blank counts for the three ex-Reserved sections) rather than approximate figures.
- **Type consistency:** `ParsedWriteupRow` is defined once in Task 1 and imported (never redefined) by Task 2's composer and Task 3's orchestrator. `RosterLookupEntry` is defined once in Task 2 and imported by Task 3. Field names (`levelCode`/`sectionName`/`indexNo`/`fullName`/`writeup` on parsed rows; `levelCode`/`sectionName`/`indexNumber`/`studentId`/`sectionId` on roster entries) are used identically across every file that touches them — verified against the test files, the implementations, and the orchestrator's usage.
